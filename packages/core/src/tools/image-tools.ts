import { mkdir, writeFile, readFile, stat } from 'node:fs/promises'
import { join, isAbsolute, extname } from 'node:path'
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import type { BackgroundTaskManager, ImageOutput } from '../background-tasks.js'
import type { ImageModelConfig } from '../images/image-config.js'
import { ImageApiClient, type OutputFormat } from '../images/image-api-client.js'
import { resolveOutputSize, clampCompression, QUALITY_OPTIONS, FORMAT_OPTIONS } from '../images/image-presets.js'

const MAX_INPUT_IMAGES = 4
const MAX_INPUT_BYTES = 4 * 1024 * 1024
const PER_JOB_CONCURRENCY = 3

export interface ImageToolDeps {
  getImageConfig: () => ImageModelConfig | null
  backgroundTasks: BackgroundTaskManager
  onImageGenerated?: (taskId: string, images: ImageOutput[], error?: string) => void
  /** inject for testing */
  runImageJob?: (params: RunImageJobParams) => Promise<void>
}

export interface RunImageJobParams {
  taskId: string
  cfg: ImageModelConfig
  prompt: string
  size: string
  quality: string
  format: OutputFormat
  compression: number
  count: number
  outputDir: string
  imageDataUrls: string[]
  backgroundTasks: BackgroundTaskManager
  onImageGenerated?: (taskId: string, images: ImageOutput[], error?: string) => void
}

function timestamp(): string {
  const now = new Date()
  const pad = (v: number, n = 2) => String(v).padStart(n, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}_${pad(now.getMilliseconds(), 3)}`
}

function mimeFromExt(p: string): string {
  const ext = extname(p).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  return 'image/png'
}

function resolveDir(cwd: string, outputPath?: string): string {
  if (!outputPath || !outputPath.trim()) return cwd
  const p = outputPath.trim()
  return isAbsolute(p) ? p : join(cwd, p)
}

async function runLimited(tasks: Array<() => Promise<void>>, concurrency: number): Promise<void> {
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const current = cursor
      cursor += 1
      try { await tasks[current]() } catch { /* single image failure doesn't stop others */ }
    }
  })
  await Promise.all(workers)
}

async function defaultRunImageJob(params: RunImageJobParams): Promise<void> {
  const { taskId, cfg, prompt, size, quality, format, compression, count, outputDir, imageDataUrls, backgroundTasks, onImageGenerated } = params
  try {
    const client = new ImageApiClient(cfg.baseUrl, cfg.apiKey)
    await mkdir(outputDir, { recursive: true })
    const outputs: ImageOutput[] = []

    const errors: string[] = []

    const tasks = Array.from({ length: count }, (_, index) => async () => {
      try {
        const result = await client.generate({
          prompt,
          size,
          quality,
          model: cfg.model,
          outputFormat: format,
          compression,
          imageDataUrls: imageDataUrls.length ? imageDataUrls : undefined,
        })
        if (!result) {
          errors.push(`[#${index + 1}] API 返回成功但无图片数据，请检查 API 响应格式是否包含 b64_json / url 字段`)
          return
        }
        if (result.type === 'remote_url') {
          if (result.downloadError) {
            errors.push(`[#${index + 1}] 远程图片下载失败：${result.downloadError}`)
          }
          outputs.push({ path: result.url, bytes: 0, format, downloadError: result.downloadError })
          return
        }
        const raw = Buffer.from(result.base64, 'base64')
        const filename = `img_${timestamp()}_${index + 1}.${format}`
        const full = join(outputDir, filename)
        await writeFile(full, raw)
        outputs.push({ path: full, bytes: raw.byteLength, format })
      } catch (err) {
        errors.push(`[#${index + 1}] ${err instanceof Error ? err.message : String(err)}`)
      }
    })

    await runLimited(tasks, PER_JOB_CONCURRENCY)

    if (outputs.length === 0) {
      const detail = errors.length ? `：\n${errors.join('\n')}` : '（API 未返回图片数据，请检查 API Key 和 baseUrl 是否正确，端点是否能正常访问）'
      const msg = `生成失败（${errors.length}/${count} 张全部失败）${detail}`
      backgroundTasks.failImage(taskId, msg)
      onImageGenerated?.(taskId, [], msg)
      return
    }
    if (errors.length > 0) {
      // Partial success — push success with error notes
      outputs.push({ path: '', bytes: 0, format: '',
        downloadError: `${errors.length} 张失败：\n${errors.slice(0, 5).join('\n')}` })
    }
    backgroundTasks.completeImage(taskId, { images: outputs })
    onImageGenerated?.(taskId, outputs)
  } catch (error) {
    backgroundTasks.failImage(taskId, error instanceof Error ? error.message : String(error))
  }
}

interface NormalizedParams {
  prompt: string
  size: string
  quality: string
  format: OutputFormat
  compression: number
  count: number
  outputDir: string
}

function normalizeParams(input: Record<string, unknown>, cwd: string): NormalizedParams {
  const prompt = String(input.prompt ?? '').trim()
  if (!prompt) throw new Error('prompt 不能为空')

  const size = String(input.size ?? 'auto').trim() || 'auto'
  resolveOutputSize(size) // throws on invalid

  const quality = QUALITY_OPTIONS.includes(input.quality as any) ? String(input.quality) : 'auto'
  let format: OutputFormat = (FORMAT_OPTIONS.includes(input.format as any) ? input.format : 'png') as OutputFormat
  const compression = clampCompression(typeof input.compression === 'number' ? input.compression : 100)
  const count = Math.min(10, Math.max(1, Math.floor(Number(input.count ?? 1)) || 1))
  const outputDir = resolveDir(cwd, input.output_path as string | undefined)
  return { prompt, size, quality, format, compression, count, outputDir }
}

async function readInputImages(images: unknown, cwd: string): Promise<string[]> {
  if (!Array.isArray(images) || images.length === 0) return []
  if (images.length > MAX_INPUT_IMAGES) throw new Error(`最多 ${MAX_INPUT_IMAGES} 张输入图片`)
  const urls: string[] = []
  for (const item of images) {
    const p = String(item)
    const full = isAbsolute(p) ? p : join(cwd, p)
    const info = await stat(full).catch(() => null)
    if (!info) throw new Error(`输入图片不存在: ${p}`)
    if (info.size > MAX_INPUT_BYTES) throw new Error(`输入图片过大 (${(info.size / 1024 / 1024).toFixed(1)}MB)，需 < 4MB: ${p}`)
    const data = await readFile(full)
    urls.push(`data:${mimeFromExt(full)};base64,${data.toString('base64')}`)
  }
  return urls
}

const SHARED_PROPS: Record<string, any> = {
  prompt: { type: 'string', description: '图像生成或编辑的描述指令（英文更稳定）。描述越具体效果越好：主体、风格、构图、光线、色调等。' },
  size: { type: 'string', description: '输出尺寸，默认 auto（模型自动选择）。\n常用预设：1024x1024(1K方1:1) / 1792x1008(1K横16:9) / 2048x1152(2K横16:9) / 2560x1440(2.5K横16:9) / 3072x1728(3K横16:9) / 3840x2160(4K横16:9) / 1008x1792(1K竖9:16) / 1152x2048(2K竖9:16) / 2160x3840(4K竖9:16) / 1536x1024(3:2横) / 1024x1536(2:3竖) / 2048x2048(2K方)。\n用户说"4K"或"4K横屏"→3840x2160，"4K竖屏"→2160x3840，"方图"→1024x1024。\n自定义格式：宽x高（如 1920x1080），宽高必须都是 16 的倍数，比例不超过 3:1。' },
  quality: { type: 'string', enum: ['auto', 'low', 'medium', 'high'], description: '图像质量。auto 由模型决定；low 更快；high 更精细。默认 auto。' },
  format: { type: 'string', enum: ['png', 'jpeg', 'webp'], description: '输出图片格式，默认 png。png：无损、适合图标/UI；jpeg：有损、适合照片、文件小；webp：现代格式、兼顾质量与体积。' },
  compression: { type: 'number', description: '压缩级别 0-100，仅对 jpeg 和 webp 生效（png 无损忽略此参数）。100=最高质量/最大文件，值越小压缩率越高。默认 100。' },
  output_path: { type: 'string', description: '图片输出目录。默认当前项目根目录。相对路径相对于项目根解析；也可传绝对路径。文件名自动生成为 img_时间戳_序号.格式。' },
  count: { type: 'number', description: '一次生成几张图，默认 1，最大 10。生成多张时每张使用相同 prompt 和参数，适合要多个变体供选择。' },
}

const ASYNC_NOTE = '\n\n后台异步执行：调用后立即返回 task_id，生成完成会收到 <task-notification> 通知（含每张图的落盘路径、尺寸、格式）。生成耗时可能较长（数十秒到几分钟），不要反复调用或轮询同一请求。可以同时发起多个任务。'

export function createImageTools(deps: ImageToolDeps): ToolHandler[] {
  const runJob = deps.runImageJob ?? defaultRunImageJob

  const start = async (
    input: Record<string, unknown>,
    context: ToolContext,
    imagesParam: unknown,
  ): Promise<ToolResult> => {
    const cfg = deps.getImageConfig()
    if (!cfg) return { content: '图像模型未配置。请在 设置 → 图像 中配置 baseUrl / apiKey / model 并启用。', isError: true }
    let params: NormalizedParams
    let imageDataUrls: string[]
    try {
      params = normalizeParams(input, context.cwd)
      imageDataUrls = await readInputImages(imagesParam, context.cwd)
    } catch (err) {
      return { content: `参数错误：${err instanceof Error ? err.message : String(err)}`, isError: true }
    }
    const task = deps.backgroundTasks.registerImage(params.prompt)
    void runJob({
      taskId: task.id, cfg, prompt: params.prompt, size: params.size, quality: params.quality,
      format: params.format, compression: params.compression,
      count: params.count, outputDir: params.outputDir, imageDataUrls,
      backgroundTasks: deps.backgroundTasks, onImageGenerated: deps.onImageGenerated,
    })
    return { content: `图像生成已在后台启动 (task_id=${task.id})，将生成 ${params.count} 张到 ${params.outputDir}。完成后会通知你，不要轮询。` }
  }

  const generateImageTool: ToolHandler = {
    definition: {
      name: 'GenerateImage',
      description: '文生图：根据 prompt 生成图片。' + ASYNC_NOTE,
      inputSchema: { type: 'object', properties: { ...SHARED_PROPS }, required: ['prompt'] },
    },
    execute: (input, context) => start(input, context, undefined),
  }

  const editImageTool: ToolHandler = {
    definition: {
      name: 'EditImage',
      description: '图生图/编辑：基于参考图片按 prompt 生成新图或修改。images 为本地图片文件路径，支持三种来源：①之前生成的图的落盘路径（从 <task-notification> 获取）②项目里已有的图（相对路径）③用户在输入框发的参考图（自动落盘到 .jdc-image-input/，消息中有路径）。最多 4 张，单张 < 4MB。使用场景：风格迁移、局部修改、基于参考图生成变体、多图合成。' + ASYNC_NOTE,
      inputSchema: {
        type: 'object',
        properties: {
          ...SHARED_PROPS,
          images: { type: 'array', items: { type: 'string' }, description: '输入参考图片的本地路径数组。最大 4 张，单张文件不超过 4MB。支持相对路径和绝对路径。' },
        },
        required: ['prompt', 'images'],
      },
    },
    execute: (input, context) => start(input, context, input.images),
  }

  return [generateImageTool, editImageTool]
}

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
  onImageGenerated?: (taskId: string, images: ImageOutput[]) => void
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
  onImageGenerated?: (taskId: string, images: ImageOutput[]) => void
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
      backgroundTasks.failImage(taskId, `生成失败（${errors.length}/${count} 张全部失败）${detail}`)
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
  prompt: { type: 'string', description: '图像描述（生成或编辑指令）' },
  size: { type: 'string', description: '尺寸。常用预设：1024x1024(1K方) / 1536x1024(3:2) / 3840x2160(4K横16:9) / 2160x3840(4K竖9:16) / 2048x1152(2K横) / auto(模型自动)。自定义须为 宽x高、宽高均为16倍数、比例≤3:1。默认 auto。用户说"4K横屏"传 3840x2160，"4K竖屏"传 2160x3840。' },
  quality: { type: 'string', enum: ['auto', 'low', 'medium', 'high'], description: '质量，默认 auto' },
  format: { type: 'string', enum: ['png', 'jpeg', 'webp'], description: '输出格式，默认 png。' },
  compression: { type: 'number', description: '压缩 0-100，仅 jpeg/webp 生效，默认 100' },
  output_path: { type: 'string', description: '输出目录。默认当前项目根目录。相对路径相对项目根解析；也可传绝对路径。' },
  count: { type: 'number', description: '生成张数，默认 1，最多 10' },
}

const ASYNC_NOTE = '\n\n这是后台异步执行：调用后立即返回 task_id，生成完成会收到 <task-notification>（含落盘路径）。不要轮询。生成可能耗时较久。不限制同时发起多个生成任务。'

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
      description: '图生图/编辑：基于一张或多张参考图（最多4张，单张<4MB）按 prompt 生成/修改。images 传图片路径，可引用：①之前生成的图的落盘路径 ②项目里已有的图（相对路径）③用户在输入框发的参考图（已落盘的路径）。' + ASYNC_NOTE,
      inputSchema: {
        type: 'object',
        properties: {
          ...SHARED_PROPS,
          images: { type: 'array', items: { type: 'string' }, description: '输入图片路径数组，最多 4 张，单张 < 4MB' },
        },
        required: ['prompt', 'images'],
      },
    },
    execute: (input, context) => start(input, context, input.images),
  }

  return [generateImageTool, editImageTool]
}

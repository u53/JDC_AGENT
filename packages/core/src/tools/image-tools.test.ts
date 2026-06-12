import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { createImageTools } from './image-tools.js'
import { BackgroundTaskManager } from '../background-tasks.js'
import type { ImageModelConfig } from '../images/image-config.js'

const cfg: ImageModelConfig = { enabled: true, baseUrl: 'https://x', apiKey: 'k', model: 'gpt-image-2' }
function setup(getConfig: () => ImageModelConfig | null = () => cfg) {
  const backgroundTasks = new BackgroundTaskManager(mkdtempSync(join(tmpdir(), 'imgtool-')))
  const runImageJob = vi.fn(async (_params: any) => {})
  const [gen, edit] = createImageTools({ getImageConfig: getConfig, backgroundTasks, runImageJob })
  return { gen, edit, runImageJob, backgroundTasks }
}
const ctx = { cwd: process.cwd() } as any

describe('GenerateImage', () => {
  it('未配置时报错', async () => {
    const { gen } = setup(() => null)
    const r = await gen.execute({ prompt: 'cat' }, ctx)
    expect(r.isError).toBe(true)
    expect(r.content).toContain('未配置')
  })
  it('成功启动后台任务并返回 task_id', async () => {
    const { gen, runImageJob } = setup()
    const r = await gen.execute({ prompt: 'cat' }, ctx)
    expect(r.isError).toBeFalsy()
    expect(r.content).toMatch(/task_id=/)
    expect(runImageJob).toHaveBeenCalledOnce()
  })
  it('非法尺寸报错', async () => {
    const { gen } = setup()
    const r = await gen.execute({ prompt: 'x', size: '1000x1000' }, ctx)
    expect(r.isError).toBe(true)
    expect(r.content).toContain('16 的倍数')
  })
  it('count 越界被夹紧到 10', async () => {
    const { gen, runImageJob } = setup()
    await gen.execute({ prompt: 'x', count: 99 }, ctx)
    expect(runImageJob.mock.calls[0][0].count).toBe(10)
  })
  it('count 0 被夹紧到 1', async () => {
    const { gen, runImageJob } = setup()
    await gen.execute({ prompt: 'x', count: 0 }, ctx)
    expect(runImageJob.mock.calls[0][0].count).toBe(1)
  })
  it('空 prompt 报错', async () => {
    const { gen } = setup()
    const r = await gen.execute({ prompt: '  ' }, ctx)
    expect(r.isError).toBe(true)
    expect(r.content).toContain('prompt')
  })
  it('size=auto 时 size 传 auto', async () => {
    const { gen, runImageJob } = setup()
    await gen.execute({ prompt: 'x', size: 'auto' }, ctx)
    expect(runImageJob.mock.calls[0][0].size).toBe('auto')
  })
  it('合法尺寸通过', async () => {
    const { gen, runImageJob } = setup()
    await gen.execute({ prompt: 'x', size: '3840x2160' }, ctx)
    expect(runImageJob.mock.calls[0][0].size).toBe('3840x2160')
  })
  it('默认 count=1', async () => {
    const { gen, runImageJob } = setup()
    await gen.execute({ prompt: 'x' }, ctx)
    expect(runImageJob.mock.calls[0][0].count).toBe(1)
  })
})

describe('EditImage', () => {
  it('输入图不存在报错', async () => {
    const { edit } = setup()
    const r = await edit.execute({ prompt: 'x', images: ['nope.png'] }, ctx)
    expect(r.isError).toBe(true)
    expect(r.content).toContain('不存在')
  })
  it('>4 张报错', async () => {
    const { edit } = setup()
    const r = await edit.execute({ prompt: 'x', images: ['a', 'b', 'c', 'd', 'e'] }, ctx)
    expect(r.isError).toBe(true)
    expect(r.content).toContain('最多 4')
  })
  it('合法输入图启动任务', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'imginput-'))
    const p = join(dir, 'ref.png')
    writeFileSync(p, Buffer.from('hello'))
    const { edit, runImageJob } = setup()
    const r = await edit.execute({ prompt: 'x', images: [p] }, { cwd: dir } as any)
    expect(r.isError).toBeFalsy()
    expect(runImageJob.mock.calls[0][0].imageDataUrls[0]).toMatch(/^data:image\/png;base64,/)
  })
  it('相对路径解析', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'imginput2-'))
    writeFileSync(join(dir, 'test.jpg'), Buffer.from('hello'))
    const { edit, runImageJob } = setup()
    await edit.execute({ prompt: 'x', images: ['test.jpg'] }, { cwd: dir } as any)
    expect(runImageJob.mock.calls[0][0].imageDataUrls[0]).toMatch(/^data:image\/jpeg;base64,/)
  })
})

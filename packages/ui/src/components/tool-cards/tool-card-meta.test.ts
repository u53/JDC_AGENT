import { describe, expect, it } from 'vitest'
import { formatToolLabel, getToolCardKind, getToolFamily, shouldShowToolRail } from './tool-card-meta'

describe('tool card metadata', () => {
  it('recognizes the current JDC context engine tool names', () => {
    const tools = [
      'JdcContext',
      'JdcSearch',
      'JdcNode',
      'JdcCallers',
      'JdcCallees',
      'JdcImpact',
      'JdcTrace',
      'JdcExplore',
      'JdcFiles',
      'JdcMemorySearch',
      'JdcMemoryWrite',
      'JdcContextInspect',
      'JdcContextRefresh',
    ]

    for (const toolName of tools) {
      expect(getToolFamily(toolName)).toBe('jdc')
      expect(getToolCardKind(toolName)).toBe('jdc')
      expect(shouldShowToolRail(toolName, 'done')).toBe(false)
    }
  })

  it('routes edit-class tools to dedicated mutation cards', () => {
    expect(getToolCardKind('Edit')).toBe('edit')
    expect(getToolCardKind('Write')).toBe('write')
    expect(getToolCardKind('MultiEdit')).toBe('multi-edit')
    expect(getToolCardKind('NotebookEdit')).toBe('notebook-edit')
  })

  it('renders retired SaveMemory history through the generic legacy path', () => {
    expect(getToolFamily('SaveMemory')).toBe('generic')
    expect(getToolCardKind('SaveMemory')).toBe('generic')
    expect(formatToolLabel('SaveMemory')).toBe('旧记忆工具（已退役）')
  })

  it('keeps the rail only for meaningful emphasis states', () => {
    expect(shouldShowToolRail('Read', 'done')).toBe(false)
    expect(shouldShowToolRail('Grep', 'done')).toBe(false)
    expect(shouldShowToolRail('WebSearch', 'done')).toBe(false)

    expect(shouldShowToolRail('Edit', 'done')).toBe(true)
    expect(shouldShowToolRail('MultiEdit', 'done')).toBe(true)
    expect(shouldShowToolRail('NotebookEdit', 'done')).toBe(true)
    expect(shouldShowToolRail('JdcContext', 'running')).toBe(true)
    expect(shouldShowToolRail('JdcContext', 'error')).toBe(true)
    expect(shouldShowToolRail('Bash', 'running')).toBe(true)
    expect(shouldShowToolRail('Read', 'error')).toBe(true)
    expect(shouldShowToolRail('Agent', 'running')).toBe(true)
    expect(shouldShowToolRail('Agent', 'done')).toBe(false)
  })
})

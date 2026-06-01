import { describe, expect, it } from 'vitest'
import { getToolCardKind, getToolFamily, shouldShowToolRail } from './tool-card-meta'

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
    ]

    for (const toolName of tools) {
      expect(getToolFamily(toolName)).toBe('jdc')
      expect(getToolCardKind(toolName)).toBe('jdc')
      expect(shouldShowToolRail(toolName, 'done')).toBe(true)
    }
  })

  it('routes edit-class tools to dedicated mutation cards', () => {
    expect(getToolCardKind('Edit')).toBe('edit')
    expect(getToolCardKind('Write')).toBe('write')
    expect(getToolCardKind('MultiEdit')).toBe('multi-edit')
    expect(getToolCardKind('NotebookEdit')).toBe('notebook-edit')
  })

  it('keeps the rail only for meaningful emphasis states', () => {
    expect(shouldShowToolRail('Read', 'done')).toBe(false)
    expect(shouldShowToolRail('Grep', 'done')).toBe(false)
    expect(shouldShowToolRail('WebSearch', 'done')).toBe(false)

    expect(shouldShowToolRail('Edit', 'done')).toBe(true)
    expect(shouldShowToolRail('MultiEdit', 'done')).toBe(true)
    expect(shouldShowToolRail('NotebookEdit', 'done')).toBe(true)
    expect(shouldShowToolRail('Bash', 'running')).toBe(true)
    expect(shouldShowToolRail('Read', 'error')).toBe(true)
    expect(shouldShowToolRail('Agent', 'running')).toBe(true)
    expect(shouldShowToolRail('Agent', 'done')).toBe(false)
  })
})

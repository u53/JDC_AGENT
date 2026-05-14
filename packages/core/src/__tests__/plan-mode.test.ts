import { describe, it, expect } from 'vitest'
import { isPlanModeToolAllowed } from '../tools/enter-plan-mode.js'

describe('plan-mode tool restrictions', () => {
  it('allows file_read', () => {
    expect(isPlanModeToolAllowed('file_read', {})).toBe(true)
  })
  it('allows grep', () => {
    expect(isPlanModeToolAllowed('grep', {})).toBe(true)
  })
  it('allows glob', () => {
    expect(isPlanModeToolAllowed('glob', {})).toBe(true)
  })
  it('allows ls', () => {
    expect(isPlanModeToolAllowed('ls', {})).toBe(true)
  })
  it('allows tree', () => {
    expect(isPlanModeToolAllowed('tree', {})).toBe(true)
  })
  it('allows lsp', () => {
    expect(isPlanModeToolAllowed('lsp', {})).toBe(true)
  })
  it('allows exit_plan_mode', () => {
    expect(isPlanModeToolAllowed('exit_plan_mode', {})).toBe(true)
  })
  it('allows task_create', () => {
    expect(isPlanModeToolAllowed('task_create', {})).toBe(true)
  })
  it('allows file_write to .jdcagnet/plans/', () => {
    expect(isPlanModeToolAllowed('file_write', { file_path: '/project/.jdcagnet/plans/plan.md' }, '/project')).toBe(true)
  })
  it('rejects file_write to other paths', () => {
    expect(isPlanModeToolAllowed('file_write', { file_path: '/project/src/index.ts' }, '/project')).toBe(false)
  })
  it('allows Agent with type explore', () => {
    expect(isPlanModeToolAllowed('Agent', { type: 'explore' })).toBe(true)
  })
  it('rejects Agent with type general', () => {
    expect(isPlanModeToolAllowed('Agent', { type: 'general' })).toBe(false)
  })
  it('rejects bash', () => {
    expect(isPlanModeToolAllowed('bash', {})).toBe(false)
  })
  it('rejects file_edit', () => {
    expect(isPlanModeToolAllowed('file_edit', {})).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import { isPlanModeToolAllowed } from '../tools/enter-plan-mode.js'

describe('plan-mode tool restrictions', () => {
  // Read-only tools: always allowed
  it('allows Read', () => {
    expect(isPlanModeToolAllowed('Read', {})).toBe(true)
  })
  it('allows Grep', () => {
    expect(isPlanModeToolAllowed('Grep', {})).toBe(true)
  })
  it('allows Glob', () => {
    expect(isPlanModeToolAllowed('Glob', {})).toBe(true)
  })
  it('allows LS', () => {
    expect(isPlanModeToolAllowed('LS', {})).toBe(true)
  })
  it('allows Tree', () => {
    expect(isPlanModeToolAllowed('Tree', {})).toBe(true)
  })
  it('allows LSP', () => {
    expect(isPlanModeToolAllowed('LSP', {})).toBe(true)
  })

  // Bash: allowed for exploration
  it('allows Bash', () => {
    expect(isPlanModeToolAllowed('Bash', { command: 'grep -rn "foo" src/' })).toBe(true)
  })

  // Write/Edit: only to plan files
  it('allows Write to .jdcagnet/plans/', () => {
    expect(isPlanModeToolAllowed('Write', { file_path: '/project/.jdcagnet/plans/plan.md' }, '/project')).toBe(true)
  })
  it('rejects Write to other paths', () => {
    expect(isPlanModeToolAllowed('Write', { file_path: '/project/src/index.ts' }, '/project')).toBe(false)
  })
  it('allows Edit to .jdcagnet/plans/', () => {
    expect(isPlanModeToolAllowed('Edit', { file_path: '/project/.jdcagnet/plans/plan.md' }, '/project')).toBe(true)
  })
  it('rejects Edit to other paths', () => {
    expect(isPlanModeToolAllowed('Edit', { file_path: '/project/src/index.ts' }, '/project')).toBe(false)
  })

  // Agent: all types allowed
  it('allows Agent with type explore', () => {
    expect(isPlanModeToolAllowed('Agent', { type: 'explore' })).toBe(true)
  })
  it('allows Agent with type general', () => {
    expect(isPlanModeToolAllowed('Agent', { type: 'general' })).toBe(true)
  })

  // Skill: allowed
  it('allows Skill', () => {
    expect(isPlanModeToolAllowed('Skill', { name: 'brainstorming' })).toBe(true)
  })

  // MCP tools: allowed
  it('allows mcp__ prefixed tools', () => {
    expect(isPlanModeToolAllowed('mcp__codegraph__search', {})).toBe(true)
  })

  // Web tools: allowed
  it('allows WebSearch', () => {
    expect(isPlanModeToolAllowed('WebSearch', {})).toBe(true)
  })
  it('allows WebFetch', () => {
    expect(isPlanModeToolAllowed('WebFetch', {})).toBe(true)
  })

  // Task tools: allowed
  it('allows TaskCreate', () => {
    expect(isPlanModeToolAllowed('TaskCreate', {})).toBe(true)
  })
  it('allows ExitPlanMode', () => {
    expect(isPlanModeToolAllowed('ExitPlanMode', {})).toBe(true)
  })

  // Unknown tools: rejected
  it('rejects unknown tools', () => {
    expect(isPlanModeToolAllowed('SomeRandomTool', {})).toBe(false)
  })
})

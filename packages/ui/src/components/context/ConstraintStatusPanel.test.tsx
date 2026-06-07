import type { ConstraintObservabilitySnapshot } from '@jdcagnet/core'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ConstraintStatusPanel } from './ConstraintStatusPanel'

function snapshot(overrides: Partial<ConstraintObservabilitySnapshot> = {}): ConstraintObservabilitySnapshot {
  return {
    status: 'needs_verification',
    inspectedAt: 1_700_000_000_000,
    cwd: '/repo',
    intent: 'code_edit',
    objective: 'Fix login bug',
    modelProfile: { id: 'strict_tool_grounding', evidenceStrictness: 'strict', maxParallelToolCalls: 2 },
    summary: { primary: '修改等待验证', secondary: '1 个文件需要验证。' },
    evidence: { status: 'not_required', missing: [] },
    blockedActions: [],
    verification: {
      status: 'pending',
      changedFiles: [{ filePath: 'src/app.ts', changedByToolUseId: 'edit_1', changedAt: 1, status: 'pending', updatedAt: 1 }],
      requirements: [{ id: 'verify_test', kind: 'test', command: 'pnpm test', status: 'pending', files: ['src/app.ts'], reason: 'covers edit', coveredChangedAt: 1 }],
      commands: [],
    },
    contextHealth: { status: 'available', latestBundleId: 'ctx_1', providerCount: 3, unhealthyProviderCount: 1, diagnostics: [] },
    policyEvents: [],
    ...overrides,
  }
}

describe('ConstraintStatusPanel', () => {
  it('renders Chinese-first primary constraint status', () => {
    const html = renderToStaticMarkup(<ConstraintStatusPanel snapshot={snapshot()} loading={false} error={null} advancedVisible={false} />)

    expect(html).toContain('约束状态')
    expect(html).toContain('修改等待验证')
    expect(html).toContain('任务意图')
    expect(html).toContain('code_edit')
    expect(html).toContain('src/app.ts')
    expect(html).toContain('strict_tool_grounding')
  })

  it('renders blocked actions without requiring advanced mode', () => {
    const html = renderToStaticMarkup(<ConstraintStatusPanel snapshot={snapshot({
      status: 'blocked',
      summary: { primary: '有操作被约束拦截', secondary: '模型需要先补齐文件证据或调整工具调用。' },
      blockedActions: [{ id: 'policy_1', phase: 'pre_tool_use', source: 'FileMutationPolicy', decision: 'block', toolName: 'Edit', toolUseId: 'edit_1', cwd: '/repo', reason: 'File must be read first.', createdAt: 1 }],
    })} loading={false} error={null} advancedVisible={false} />)

    expect(html).toContain('被拦截的操作')
    expect(html).toContain('Edit')
    expect(html).toContain('File must be read first.')
  })

  it('shows raw policy events only in advanced mode', () => {
    const data = snapshot({
      policyEvents: [{ id: 'policy_1', phase: 'post_tool_use', source: 'VerificationLedger', decision: 'record', toolName: 'Bash', toolUseId: 'bash_1', cwd: '/repo', createdAt: 1 }],
    })
    const normal = renderToStaticMarkup(<ConstraintStatusPanel snapshot={data} loading={false} error={null} advancedVisible={false} />)
    const advanced = renderToStaticMarkup(<ConstraintStatusPanel snapshot={data} loading={false} error={null} advancedVisible />)

    expect(normal).not.toContain('原始策略事件')
    expect(advanced).toContain('原始策略事件')
    expect(advanced).toContain('VerificationLedger')
  })
})

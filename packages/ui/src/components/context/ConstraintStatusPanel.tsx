import type { ConstraintObservabilitySnapshot } from '@jdcagnet/core'
import { Badge, formatDate, Metric, PanelFrame, PanelState, statusLabel, statusTone } from './ContextPanelPrimitives'

export function ConstraintStatusPanel({ snapshot, loading, error, advancedVisible = false }: {
  snapshot: ConstraintObservabilitySnapshot | null
  loading: boolean
  error: string | null
  advancedVisible?: boolean
}) {
  if (loading) return <PanelState title="正在读取约束状态" message="正在读取证据、拦截和验证状态。" />
  if (error) return <PanelState title="约束状态暂不可用" message={error} />
  if (!snapshot) return <PanelState title="暂无约束状态" message="等待当前会话产生约束运行状态。" />

  return (
    <PanelFrame title="约束状态" subtitle={`最近读取 ${formatDate(snapshot.inspectedAt)}`}>
      <section className="rounded-[8px] border border-[color-mix(in_srgb,var(--accent)_12%,var(--border))] bg-[color-mix(in_srgb,var(--surface-2)_46%,transparent)] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge tone={statusTone(snapshot.status)}>{constraintStatusLabel(snapshot.status)}</Badge>
          {snapshot.modelProfile && <Badge tone="accent">{snapshot.modelProfile.id}</Badge>}
        </div>
        <div className="mt-2 whitespace-normal break-words text-[13px] font-medium text-[var(--text)] [overflow-wrap:anywhere]">{snapshot.summary.primary}</div>
        <div className="mt-1 whitespace-normal break-words text-[11px] text-[var(--muted)] [overflow-wrap:anywhere]">{snapshot.summary.secondary}</div>
      </section>

      <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(120px,1fr))]">
        <Metric label="任务意图" value={snapshot.intent ?? '未报告'} />
        <Metric label="证据状态" value={evidenceLabel(snapshot.evidence.status)} />
        <Metric label="验证状态" value={verificationLabel(snapshot.verification.status)} />
        <Metric label="上下文健康" value={contextHealthLabel(snapshot)} />
      </div>

      {snapshot.objective && (
        <section className="rounded-[8px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-2)_46%,transparent)] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
          <div className="font-mono text-[10px] uppercase text-[var(--muted)]">当前目标</div>
          <div className="mt-1 whitespace-normal break-words text-[12px] text-[var(--text)] [overflow-wrap:anywhere]">{snapshot.objective}</div>
        </section>
      )}

      {snapshot.evidence.missing.length > 0 && (
        <section className="space-y-2">
          <div className="font-mono text-[10px] uppercase text-[var(--muted)]">缺少的证据</div>
          {snapshot.evidence.missing.map((item, index) => (
            <div key={`${item.kind}_${index}`} className="rounded-[7px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-2)_46%,transparent)] px-3 py-2">
              <div className="font-mono text-[11px] text-[var(--text)]">{item.kind}</div>
              <div className="mt-1 whitespace-normal break-words text-[11px] text-[var(--muted)] [overflow-wrap:anywhere]">{item.reason}</div>
            </div>
          ))}
        </section>
      )}

      {snapshot.blockedActions.length > 0 && (
        <section className="space-y-2">
          <div className="font-mono text-[10px] uppercase text-[var(--muted)]">被拦截的操作</div>
          {snapshot.blockedActions.map((event) => (
            <div key={event.id} className="rounded-[7px] border border-[color-mix(in_srgb,var(--bad)_24%,var(--border))] bg-[color-mix(in_srgb,var(--bad)_6%,var(--surface-2))] px-3 py-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Badge tone="bad">{event.toolName}</Badge>
                <span className="font-mono text-[10px] text-[var(--muted)]">{event.toolUseId || 'unknown'}</span>
              </div>
              {event.reason && <div className="mt-1 whitespace-normal break-words text-[11px] text-[var(--text)] [overflow-wrap:anywhere]">{event.reason}</div>}
            </div>
          ))}
        </section>
      )}

      {snapshot.verification.requirements.filter(isActionableRequirement).length > 0 && (
        <section className="space-y-2">
          <div className="font-mono text-[10px] uppercase text-[var(--muted)]">需要验证</div>
          {snapshot.verification.requirements.filter(isActionableRequirement).map((requirement) => (
            <div key={requirement.id} className="rounded-[7px] border border-[color-mix(in_srgb,var(--warn)_22%,var(--border))] bg-[color-mix(in_srgb,var(--warn)_6%,var(--surface-2))] px-3 py-2">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge tone={requirement.status === 'failed' ? 'bad' : 'warn'}>{verificationRequirementKindLabel(requirement.kind)}</Badge>
                  <Badge tone={requirement.status === 'failed' ? 'bad' : 'warn'}>{verificationRequirementStatusLabel(requirement.status)}</Badge>
                </div>
                {requirement.command && <span className="min-w-0 whitespace-normal break-words font-mono text-[11px] text-[var(--text)] [overflow-wrap:anywhere]">{requirement.command}</span>}
              </div>
              {requirement.reason && <div className="mt-1 whitespace-normal break-words text-[11px] text-[var(--muted)] [overflow-wrap:anywhere]">{requirement.reason}</div>}
              {requirement.files.length > 0 && (
                <div className="mt-1 whitespace-normal break-words font-mono text-[10px] text-[var(--muted)] [overflow-wrap:anywhere]">
                  {requirement.files.join(', ')}
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      {snapshot.verification.changedFiles.length > 0 && (
        <section className="space-y-2">
          <div className="font-mono text-[10px] uppercase text-[var(--muted)]">已修改文件</div>
          {snapshot.verification.changedFiles.map((file) => (
            <div key={file.filePath} className="rounded-[7px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-2)_46%,transparent)] px-3 py-2">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 whitespace-normal break-words font-mono text-[11px] text-[var(--text)] [overflow-wrap:anywhere]">{file.filePath}</span>
                <Badge tone={file.status === 'verified' ? 'good' : file.status === 'failed' ? 'bad' : 'warn'}>{changedFileStatusLabel(file.status)}</Badge>
              </div>
              {file.verificationFailure && <div className="mt-1 whitespace-normal break-words text-[11px] text-[var(--bad)] [overflow-wrap:anywhere]">{file.verificationFailure}</div>}
            </div>
          ))}
        </section>
      )}

      {advancedVisible && snapshot.policyEvents.length > 0 && (
        <section className="space-y-2">
          <div className="font-mono text-[10px] uppercase text-[var(--muted)]">原始策略事件</div>
          {snapshot.policyEvents.map((event) => (
            <div key={event.id} className="rounded-[7px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-2)_38%,transparent)] px-3 py-2 font-mono text-[10px] text-[var(--muted)]">
              {event.phase} · {event.source} · {event.decision} · {event.toolName}
            </div>
          ))}
        </section>
      )}
    </PanelFrame>
  )
}

function constraintStatusLabel(status: ConstraintObservabilitySnapshot['status']): string {
  const labels: Record<ConstraintObservabilitySnapshot['status'], string> = {
    idle: '正常',
    checking: '检查中',
    blocked: '已拦截',
    needs_evidence: '缺少证据',
    needs_verification: '等待验证',
    verified: '已验证',
    failed: '验证失败',
    unavailable: '不可用',
  }
  return labels[status]
}

function evidenceLabel(status: ConstraintObservabilitySnapshot['evidence']['status']): string {
  if (status === 'missing') return '缺少证据'
  if (status === 'satisfied') return '已满足'
  return '无需额外证据'
}

function verificationLabel(status: ConstraintObservabilitySnapshot['verification']['status']): string {
  if (status === 'not_required') return '无需验证'
  return statusLabel(status)
}

function contextHealthLabel(snapshot: ConstraintObservabilitySnapshot): string {
  if (snapshot.contextHealth.providerCount === 0) return statusLabel(snapshot.contextHealth.status)
  return `${snapshot.contextHealth.providerCount - snapshot.contextHealth.unhealthyProviderCount}/${snapshot.contextHealth.providerCount}`
}

function isActionableRequirement(requirement: ConstraintObservabilitySnapshot['verification']['requirements'][number]): boolean {
  return requirement.status === 'pending' || requirement.status === 'failed' || requirement.status === 'unavailable'
}

function verificationRequirementKindLabel(kind: string): string {
  if (kind === 'test') return '测试'
  if (kind === 'build') return '构建'
  if (kind === 'lint') return '检查'
  if (kind === 'typecheck') return '类型检查'
  if (kind === 'manual') return '手动检查'
  if (kind === 'diff' || kind === 'diff_check') return '差异检查'
  return kind
}

function verificationRequirementStatusLabel(status: string): string {
  if (status === 'pending') return '待验证'
  if (status === 'failed') return '验证失败'
  if (status === 'unavailable') return '不可用'
  return status
}

function changedFileStatusLabel(status: string): string {
  if (status === 'verified') return '已验证'
  if (status === 'failed') return '验证失败'
  return '待验证'
}

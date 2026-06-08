import type { ContextInspectPayload } from '@jdcagnet/core'
import { Badge, ContextMarkdown, formatDate, formatPercent, formatTokens, freshnessLabel, kindLabel, Metric, PanelFrame, PanelState, statusTone } from './ContextPanelPrimitives'

type InspectableSection = NonNullable<ContextInspectPayload['bundle']>['sections'][number]

export function ContextCurrentPanel({ payload, loading, error }: {
  payload: ContextInspectPayload | null
  loading: boolean
  error: string | null
}) {
  if (loading) return <PanelState title="正在读取当前上下文" message="正在读取最近一次注入的上下文包。" />
  if (error) return <PanelState title="当前上下文暂不可用" message={error} />
  if (!payload) return <PanelState title="尚未读取当前上下文" message="等待会话上下文快照。" />
  if (payload.status === 'disabled') return <PanelState title="上下文引擎已关闭" message="聊天继续运行，当前不会注入项目上下文。" />
  if (payload.status === 'unavailable') return <PanelState title="当前上下文暂不可用" message={payload.diagnostics[0]?.message ?? '上下文快照无法读取。'} />
  if (!payload.bundle) return <PanelState title="暂无当前上下文" message="这个会话还没有可展示的注入上下文。" />

  const bundle = payload.bundle
  const suppressedCount = payload.droppedSections.length

  return (
    <PanelFrame title="当前上下文" subtitle={`上下文包 ${bundle.id} · ${formatDate(payload.inspectedAt)}`}>
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(120px,1fr))]">
        <Metric label="段落" value={bundle.sections.length} />
        <Metric label="已使用" value={formatTokens(bundle.budget.usedTokens)} />
        <Metric label="已抑制" value={suppressedCount} />
      </div>

      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="whitespace-normal break-words text-[11px] font-medium text-[var(--text)] [overflow-wrap:anywhere]">本轮注入</div>
        <div className="whitespace-normal break-words text-[11px] text-[var(--muted)] [overflow-wrap:anywhere]">已抑制 {suppressedCount}</div>
      </div>

      {bundle.sections.length === 0 ? (
        <PanelState title="暂无上下文段落" message="最近一次上下文包没有注入段落。" />
      ) : (
        <div className="space-y-2">
          {bundle.sections.map((section) => (
            <article key={section.id} className="min-w-0 space-y-2 rounded-[8px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-2)_42%,transparent)] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="whitespace-normal break-words text-[12px] font-medium text-[var(--text)] [overflow-wrap:anywhere]">{section.title}</div>
                  <div className="mt-0.5 whitespace-normal break-words font-mono text-[10px] uppercase text-[var(--muted)] [overflow-wrap:anywhere]">
                    {kindLabel(section.kind)}
                  </div>
                </div>
                <Badge tone={statusTone(section.freshness)}>{freshnessLabel(section.freshness)}</Badge>
              </div>

              {section.content && <ContextMarkdown content={section.content} />}

              <div className="grid gap-1.5 [grid-template-columns:repeat(auto-fit,minmax(110px,1fr))]">
                <Metric label="来源" value={section.sourceProvider} />
                <Metric label="置信度" value={formatPercent(section.confidence)} />
                <Metric label="新鲜度" value={freshnessLabel(section.freshness)} />
                <Metric label="令牌" value={formatTokens(section.tokenCost.tokenEstimate)} />
                <Metric label="注入原因" value={injectionReason(section)} />
              </div>

              {(section.tokenCost.source || section.tokenCost.droppedTokens) && (
                <div className="whitespace-normal break-words text-[10px] text-[var(--muted)] [overflow-wrap:anywhere]">
                  {section.tokenCost.source ? `估算 ${section.tokenCost.source}` : ''}
                  {section.tokenCost.source && section.tokenCost.droppedTokens ? ' · ' : ''}
                  {section.tokenCost.droppedTokens ? `已裁剪 ${section.tokenCost.droppedTokens}` : ''}
                </div>
              )}

              <CitationList citations={section.citations} />
            </article>
          ))}
        </div>
      )}

      {suppressedCount > 0 && (
        <div className="min-w-0 rounded-[8px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-2)_46%,transparent)] px-3 py-2.5">
          <div className="whitespace-normal break-words text-[11px] font-medium text-[var(--text)] [overflow-wrap:anywhere]">未注入</div>
          <div className="mt-1 whitespace-normal break-words text-[10px] text-[var(--muted)] [overflow-wrap:anywhere]">
            {payload.droppedSections.length} 条上下文被预算或规划器抑制。
          </div>
          <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
            {payload.droppedSections.map((item) => (
              <Badge key={item.section.id} tone="muted">{item.reason}</Badge>
            ))}
          </div>
        </div>
      )}
    </PanelFrame>
  )
}

function CitationList({ citations }: { citations: InspectableSection['citations'] }) {
  if (citations.length === 0) {
    return <div className="text-[10px] text-[var(--muted)]">引用 0</div>
  }

  return (
    <div className="space-y-1">
      <div className="font-mono text-[10px] uppercase text-[var(--muted)]">引用</div>
      <div className="flex flex-wrap gap-1.5">
        {citations.map((citation) => (
          <span key={citation.id} className="max-w-full whitespace-normal break-words rounded-[5px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-3)_45%,transparent)] px-1.5 py-1 font-mono text-[10px] text-[var(--muted)] [overflow-wrap:anywhere]">
            {citation.ref}{citation.line ? `:${citation.line}` : ''}
          </span>
        ))}
      </div>
    </div>
  )
}

function injectionReason(section: InspectableSection): string {
  if (section.kind === 'memory') return '项目事实命中'
  if (section.kind === 'project_profile') return '项目画像匹配'
  if (section.kind === 'relevant_code') return '相关代码匹配'
  if (section.kind === 'repo_wiki') return '仓库 Wiki 命中'
  if (section.kind === 'runtime_state') return '运行状态相关'
  if (section.kind === 'ide_state') return '编辑器状态相关'
  if (section.kind === 'git_state') return 'Git 状态相关'
  if (section.kind === 'user_intent') return '当前目标相关'
  if (section.kind === 'conversation_state') return '对话状态相关'
  if (section.kind === 'diagnostics') return '诊断相关'
  return '上下文规划命中'
}

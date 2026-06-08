import type { ContextMemoryReview } from '../../stores/context-store'
import { useContextStore } from '../../stores/context-store'
import { Badge, ContextMarkdown, DiagnosticsList, formatDate, formatPercent, freshnessLabel, kindLabel, Metric, PanelFrame, PanelState, scopeLabel, statusLabel, unknownPreview } from './ContextPanelPrimitives'

export function MemoryReviewPanel({ review, loading, error }: {
  review: ContextMemoryReview | null
  loading: boolean
  error: string | null
}) {
  if (loading) return <PanelState title="正在读取记忆诊断" message="正在读取已接受记忆和候选失败记录。" />
  if (error) return <PanelState title="记忆诊断暂不可用" message={error} />
  if (!review) return <PanelState title="尚未读取记忆诊断" message="等待诊断缓存。" />

  const accepted = review.accepted?.results ?? []

  return (
    <PanelFrame title="记忆诊断" subtitle={`${accepted.length} 条已接受记忆 · ${review.rejected.length} 条候选记录`}>
      <div className="whitespace-normal break-words rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2 text-[11px] text-[var(--muted)] [overflow-wrap:anywhere]">
        已接受记忆来自项目记忆查询；候选记录显示持久化前的验证结果。
      </div>

      <section className="space-y-2">
        <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted)]">已接受记忆</div>
        {review.accepted?.status === 'unavailable' ? (
          <PanelState title="已接受记忆暂不可用" message={review.accepted.diagnostics[0]?.message ?? '持久记忆搜索失败。'} />
        ) : accepted.length === 0 ? (
          <PanelState title="暂无已接受记忆" message={review.accepted ? '当前查询没有命中的已接受记忆。' : '已接受记忆尚未读取。'} />
        ) : (
          <div className="space-y-2">
            {accepted.map((memory) => (
              <article key={memory.id} className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="whitespace-normal break-words text-[12px] font-medium text-[var(--text)] [overflow-wrap:anywhere]">{kindLabel(memory.kind)}</div>
                    <div className="mt-0.5 whitespace-normal break-words text-[10px] uppercase tracking-[0.08em] text-[var(--muted)] [overflow-wrap:anywhere]">{scopeLabel(memory.scope)} · {memory.sourceProvider}</div>
                  </div>
                  <Badge tone="good">已接受</Badge>
                </div>

                <ContextMarkdown content={memory.content} />

                <div className="grid gap-1.5 [grid-template-columns:repeat(auto-fit,minmax(90px,1fr))]">
                  <Metric label="置信度" value={formatPercent(memory.confidence)} />
                  <Metric label="新鲜度" value={freshnessLabel(memory.freshness)} />
                  <Metric label="过期" value={memory.expiresAt ? formatDate(memory.expiresAt) : '无过期'} />
                </div>

                <div className="space-y-1">
                  <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted)]">引用</div>
                  {memory.citations.length === 0 ? (
                    <div className="text-[10px] text-[var(--bad)]">引用 0</div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {memory.citations.map((citation) => (
                        <span key={citation.id} className="max-w-full whitespace-normal break-words rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-1 text-[10px] font-mono text-[var(--muted)] [overflow-wrap:anywhere]">
                          {citation.ref}{citation.line ? `:${citation.line}` : ''}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
        {review.accepted && <DiagnosticsList diagnostics={review.accepted.diagnostics} />}
      </section>

      <section className="space-y-2">
        <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted)]">候选记录</div>
        {review.rejected.length === 0 ? (
          <PanelState title="暂无候选记录" message="当前会话没有保留的候选诊断。" />
        ) : (
          <div className="space-y-2">
            {review.rejected.map((candidate) => (
              <article key={candidate.id} className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="whitespace-normal break-words text-[12px] font-medium text-[var(--text)] [overflow-wrap:anywhere]">{candidate.id}</div>
                    <div className="mt-0.5 whitespace-normal break-words text-[10px] uppercase tracking-[0.08em] text-[var(--muted)] [overflow-wrap:anywhere]">会话 {candidate.sessionId}</div>
                  </div>
                  <Badge tone="bad">{statusLabel(candidate.status)}</Badge>
                </div>

                <div className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2 text-[11px]">
                  <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted)]">拒绝原因</div>
                  <div className="mt-1 whitespace-normal break-words text-[var(--text)] [overflow-wrap:anywhere]">{candidate.rejectionReason}</div>
                </div>

                {candidate.validationErrors.length > 0 && (
                  <ul className="space-y-1">
                    {candidate.validationErrors.map((validationError) => (
                      <li key={validationError} className="whitespace-normal break-words text-[11px] text-[var(--bad)] [overflow-wrap:anywhere]">{validationError}</li>
                    ))}
                  </ul>
                )}

                <pre className="max-h-32 min-w-0 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-2 text-[10px] font-mono text-[var(--muted)] [overflow-wrap:anywhere]">
                  {unknownPreview(candidate.candidate)}
                </pre>

                <div className="flex min-w-0 flex-wrap justify-between gap-2 text-[10px] text-[var(--muted)]">
                  <span>创建 {formatDate(candidate.createdAt)}</span>
                  <span>过期 {formatDate(candidate.expiresAt)}</span>
                </div>

                {candidate.status === 'pending_review' && (
                  <div className="flex min-w-0 flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      className="min-w-0 whitespace-normal break-words rounded-md border border-[var(--good)] bg-[var(--good)]/10 px-2.5 py-1 text-[10px] font-medium text-[var(--good)] transition-colors [overflow-wrap:anywhere] hover:bg-[var(--good)]/20"
                      onClick={() => useContextStore.getState().acceptMemoryCandidate(candidate.id, candidate.sessionId)}
                    >接受</button>
                    <button
                      type="button"
                      className="min-w-0 whitespace-normal break-words rounded-md border border-[var(--bad)] bg-[var(--bad)]/10 px-2.5 py-1 text-[10px] font-medium text-[var(--bad)] transition-colors [overflow-wrap:anywhere] hover:bg-[var(--bad)]/20"
                      onClick={() => useContextStore.getState().rejectMemoryCandidate(candidate.id, candidate.sessionId)}
                    >拒绝</button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </PanelFrame>
  )
}

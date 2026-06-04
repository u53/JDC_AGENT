import type { CompactNoticeStatus } from '../lib/compact-notice'

interface Props {
  status: CompactNoticeStatus
  originalCount?: number
  summarizedCount?: number
  keptRecent?: number
  messageCount?: number
  reason?: string
  message?: string
}

const statusCopy: Record<CompactNoticeStatus, { title: string; detail: string; tone: string; chip: string }> = {
  running: {
    title: '正在压缩上下文',
    detail: 'JDC 正在把早期对话整理成可继续执行的恢复摘要',
    tone: 'plan',
    chip: '压缩中',
  },
  complete: {
    title: '上下文已压缩',
    detail: '后续请求将基于压缩后的历史继续执行',
    tone: 'accent',
    chip: '已完成',
  },
  skipped: {
    title: '本次无需压缩',
    detail: '当前对话还不需要整理，历史没有被修改',
    tone: 'warn',
    chip: '已跳过',
  },
  failed: {
    title: '上下文压缩失败',
    detail: '历史没有被修改，可以继续当前对话',
    tone: 'bad',
    chip: '失败',
  },
}

export function CompactStatusCard({
  status,
  originalCount,
  summarizedCount,
  keptRecent,
  messageCount,
  reason,
  message,
}: Props) {
  const copy = statusCopy[status]
  const metrics = [
    typeof summarizedCount === 'number' ? `已摘要 ${summarizedCount} 条` : null,
    typeof keptRecent === 'number' ? `保留最近 ${keptRecent} 条` : null,
    typeof originalCount === 'number' ? `原始 ${originalCount} 条` : null,
    status === 'skipped' && typeof messageCount === 'number' ? `当前 ${messageCount} 条` : null,
  ].filter(Boolean)

  const diagnostic = status === 'failed'
    ? (message || reason || '压缩模型未返回可用摘要')
    : status === 'skipped'
    ? skippedReason(reason)
    : null

  return (
    <div className="aux-card jdc-compact-card mb-3" data-tone={copy.tone} data-status={status}>
      <div className="aux-card-header jdc-compact-card-header">
        <span className={`aux-card-dot ${status === 'running' ? 'is-live' : ''}`} />
        <span className="jdc-compact-ring" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span className="jdc-compact-copy">
          <span className="aux-card-label">{copy.title}</span>
          <span className="aux-card-muted">{copy.detail}</span>
        </span>
        <span className="aux-card-chip">{copy.chip}</span>
      </div>
      {(metrics.length > 0 || diagnostic) && (
        <div className="aux-card-body jdc-compact-card-body">
          {metrics.length > 0 && (
            <div className="jdc-compact-metrics">
              {metrics.map((metric) => <span key={metric}>{metric}</span>)}
            </div>
          )}
          {diagnostic && <p>{diagnostic}</p>}
        </div>
      )}
    </div>
  )
}

function skippedReason(reason?: string): string | null {
  if (reason === 'too_short') return '对话还比较短，暂时不需要压缩。'
  if (reason === 'in_progress') return '已有一次压缩正在进行中。'
  if (reason === 'no_session') return '没有可压缩的活动会话。'
  return null
}

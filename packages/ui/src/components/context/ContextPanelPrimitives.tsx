import type { ContextInspectPayload } from '@jdcagnet/core'
import type { ReactNode } from 'react'

type ContextDiagnostic = ContextInspectPayload['diagnostics'][number]

export function PanelFrame({ title, subtitle, actions, children }: {
  title: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="min-w-0 space-y-3">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] pb-2">
        <div className="min-w-0">
          <h3 className="break-words font-mono text-[11px] font-semibold uppercase text-[var(--text)] [overflow-wrap:anywhere]">{title}</h3>
          {subtitle && <p className="mt-1 whitespace-normal break-words text-[11px] leading-5 text-[var(--muted)] [overflow-wrap:anywhere]">{subtitle}</p>}
        </div>
        {actions && <div className="min-w-0 max-w-full rounded-[7px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-2)_44%,transparent)] p-1">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

export function PanelState({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-[8px] border border-dashed border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-2)_54%,transparent)] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className="break-words text-[12px] font-medium text-[var(--text)] [overflow-wrap:anywhere]">{title}</div>
      <div className="mt-1 whitespace-normal break-words text-[11px] leading-5 text-[var(--muted)] [overflow-wrap:anywhere]">{message}</div>
    </div>
  )
}

export function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'good' | 'warn' | 'bad' | 'accent' }) {
  const color = tone === 'good' ? 'var(--good)' : tone === 'warn' ? 'var(--warn)' : tone === 'bad' ? 'var(--bad)' : tone === 'accent' ? 'var(--accent)' : 'var(--muted)'
  return (
    <span className="inline-flex max-w-full items-center whitespace-normal break-words rounded-[5px] border bg-[color-mix(in_srgb,currentColor_8%,transparent)] px-1.5 py-1 font-mono text-[10px] leading-none [overflow-wrap:anywhere]" style={{ color, borderColor: `color-mix(in srgb, ${color} 42%, var(--border))` }}>
      {children}
    </span>
  )
}

export function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 rounded-[7px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-2)_44%,transparent)] px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
      <div className="break-words font-mono text-[10px] uppercase text-[var(--muted)] [overflow-wrap:anywhere]">{label}</div>
      <div className="mt-1 min-w-0 whitespace-normal break-words font-mono text-[12px] text-[var(--text)] [overflow-wrap:anywhere]">{value}</div>
    </div>
  )
}

export function DiagnosticsList({ diagnostics }: { diagnostics: ContextDiagnostic[] }) {
  if (diagnostics.length === 0) return null
  return (
    <div className="space-y-1.5">
      <div className="font-mono text-[10px] uppercase text-[var(--muted)]">诊断</div>
      {diagnostics.map((diagnostic) => (
        <div key={diagnostic.id} className="min-w-0 rounded-[7px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-2)_54%,transparent)] px-2.5 py-2 text-[11px]">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 whitespace-normal break-words font-mono text-[var(--muted)] [overflow-wrap:anywhere]">{diagnostic.source}</span>
            <Badge tone={diagnostic.level === 'error' ? 'bad' : diagnostic.level === 'warning' ? 'warn' : 'muted'}>{diagnosticLevelLabel(diagnostic.level)}</Badge>
          </div>
          <div className="mt-1 whitespace-normal break-words text-[var(--text)] [overflow-wrap:anywhere]">{diagnostic.message}</div>
        </div>
      ))}
    </div>
  )
}

export function formatDate(timestamp?: number): string {
  if (timestamp == null) return '未报告'
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false })
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

export function formatTokens(value: number): string {
  return `${value.toLocaleString('zh-CN')} 令牌`
}

export function titleCase(value: string): string {
  const text = value.replace(/_/g, ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function statusTone(status: string): 'muted' | 'good' | 'warn' | 'bad' | 'accent' {
  if (status === 'accepted' || status === 'enabled' || status === 'fresh' || status === 'cached' || status === 'completed') return 'good'
  if (status === 'failed' || status === 'rejected' || status === 'timeout') return 'bad'
  if (status === 'skipped' || status === 'stale' || status === 'rate_limited' || status === 'not_indexed') return 'warn'
  if (status === 'queued' || status === 'classified' || status === 'distilling' || status === 'validating' || status === 'indexing' || status === 'running') return 'accent'
  return 'muted'
}

export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    accepted: '已接受',
    skipped: '已跳过',
    rejected: '已拒绝',
    failed: '失败',
    pending_review: '待确认',
    queued: '排队中',
    classified: '已分类',
    distilling: '提炼中',
    validating: '验证中',
    enabled: '已启用',
    disabled: '已关闭',
    fresh: '最新',
    cached: '已缓存',
    stale: '过期',
    not_indexed: '未索引',
    indexing: '索引中',
    timeout: '超时',
    rate_limited: '限流',
    live: '实时',
    completed: '已完成',
    running: '运行中',
    empty: '空',
    available: '可用',
    unavailable: '不可用',
    'not reported': '未报告',
    not_reported: '未报告',
  }
  return labels[status] ?? titleCase(status)
}

export function freshnessLabel(freshness: string): string {
  return statusLabel(freshness)
}

export function kindLabel(kind: string): string {
  const labels: Record<string, string> = {
    user_intent: '用户意图',
    project_profile: '项目画像',
    code_map: '代码地图',
    relevant_code: '相关代码',
    repo_wiki: '仓库 Wiki',
    git_state: 'Git 状态',
    memory: '记忆',
    conversation_state: '会话状态',
    runtime_state: '运行状态',
    ide_state: 'IDE 状态',
    diagnostics: '诊断',
    architecture_decision: '架构决策',
    module_boundary: '模块边界',
    user_preference: '用户偏好',
    current_goal: '当前目标',
    runtime_error_chain: '运行错误链',
    code_entrypoint: '代码入口',
    known_issue: '已知问题',
    project_convention: '项目约定',
    workflow_rule: '工作流规则',
    workflow_hint: '工作流提示',
    team_decision: '团队决策',
    task_result: '任务结果',
    artifact_summary: '产物摘要',
    qa_issue: '质量问题',
  }
  return labels[kind] ?? titleCase(kind)
}

export function scopeLabel(scope: string): string {
  const labels: Record<string, string> = {
    global: '全局',
    project: '项目',
    repo: '仓库',
    session: '会话',
    turn: '本轮',
  }
  return labels[scope] ?? scope
}

function diagnosticLevelLabel(level: string): string {
  const labels: Record<string, string> = {
    info: '信息',
    warning: '警告',
    error: '错误',
  }
  return labels[level] ?? level
}

export function unknownPreview(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

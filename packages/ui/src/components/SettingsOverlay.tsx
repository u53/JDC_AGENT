import { useState, useEffect, useRef, useCallback } from 'react'
import { useSettingsStore, type SettingsTab } from '../stores/settings-store'
import { useModelStore, type ApiProtocol, type ModelGroup } from '../stores/model-store'
import { useSessionStore } from '../stores/session-store'
import { IconX } from './icons'
import type { McpServerState } from '../lib/ipc-client'
import { ipc } from '../lib/ipc-client'

function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false)
  return (
    <span className="relative inline-flex" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-[11px] text-[var(--text)] bg-[var(--surface-3)] border border-[var(--border)] rounded-[4px] whitespace-nowrap z-50 pointer-events-none">
          {text}
        </span>
      )}
    </span>
  )
}

const PROTOCOL_OPTIONS: { value: ApiProtocol; label: string }[] = [
  { value: 'anthropic', label: 'Anthropic (/v1/messages)' },
  { value: 'openai', label: 'OpenAI (/v1/chat/completions)' },
  { value: 'openai-responses', label: 'OpenAI Responses (/v1/responses)' },
]

function ProtocolSelect({ value, onChange }: { value: ApiProtocol; onChange: (v: ApiProtocol) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = PROTOCOL_OPTIONS.find(o => o.value === value)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-[6px] px-3 py-2 text-[13px] text-[var(--text)] text-left flex items-center justify-between hover:border-[var(--border-strong)] transition-colors"
      >
        <span>{current?.label}</span>
        <span className="text-[var(--muted)]">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 border border-[var(--border)] rounded-[6px] bg-[var(--surface)] overflow-hidden" style={{ boxShadow: 'var(--shadow-soft)' }}>
          {PROTOCOL_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false) }}
              className={`w-full text-left px-3 py-2 text-[13px] transition-colors ${opt.value === value ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'text-[var(--text)] hover:bg-[var(--surface-2)]'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const TABS: { key: SettingsTab; label: string }[] = [
  { key: 'models', label: '模型' },
  { key: 'mcp', label: 'MCP' },
  { key: 'tools', label: '工具' },
  { key: 'shortcuts', label: '快捷键' },
  { key: 'advanced', label: '版本信息' },
]

export function SettingsOverlay() {
  const isOpen = useSettingsStore((s) => s.isOpen)
  const activeTab = useSettingsStore((s) => s.activeTab)
  const close = useSettingsStore((s) => s.close)
  const setActiveTab = useSettingsStore((s) => s.setActiveTab)
  const activeTabMeta = TABS.find((tab) => tab.key === activeTab) ?? TABS[0]

  if (!isOpen) return null

  return (
    <div
      className="settings-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xl"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div
        className="settings-shell flex min-h-[560px] max-h-[86vh] w-[min(920px,94vw)] overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)]"
        style={{ boxShadow: '0 24px 80px rgba(0, 0, 0, 0.46), inset 0 1px 0 rgba(255, 255, 255, 0.04)' }}
      >
        {/* Left nav */}
        <nav className="settings-nav flex w-[220px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface-2)] px-3 py-4">
          <div className="mb-5 px-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">JDC Code</div>
            <h2 className="mt-2 text-[20px] font-semibold leading-none text-[var(--text)]">Settings</h2>
            <p className="mt-2 text-[12px] leading-5 text-[var(--muted)]">模型、工具和运行环境</p>
          </div>

          <div className="flex flex-1 flex-col gap-1">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`group flex w-full items-center justify-between rounded-[6px] px-3 py-2 text-left text-[13px] transition-colors ${
                  activeTab === tab.key
                    ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                    : 'text-[var(--muted)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]'
                }`}
              >
                <span>{tab.label}</span>
                <span className={`h-1.5 w-1.5 rounded-full transition-opacity ${activeTab === tab.key ? 'bg-[var(--accent)] opacity-100' : 'bg-[var(--muted)] opacity-0 group-hover:opacity-40'}`} />
              </button>
            ))}
          </div>
        </nav>

        {/* Right content */}
        <main className="settings-content context-panel-scroll relative min-w-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="mb-5 flex items-start justify-between gap-4 border-b border-[var(--border)] pb-4 pr-8">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">JDC Dark</div>
              <h3 className="mt-1 text-[18px] font-semibold leading-7 text-[var(--text)]">{activeTabMeta.label}</h3>
            </div>
          </div>

          <button
            type="button"
            onClick={close}
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-[6px] text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
            aria-label="关闭设置"
          >
            <IconX size={18} />
          </button>

          {activeTab === 'models' && <ModelsTab />}
          {activeTab === 'mcp' && <McpTab />}
          {activeTab === 'tools' && <ToolsTab />}
          {activeTab === 'shortcuts' && <ShortcutsTab />}
          {activeTab === 'advanced' && <AdvancedTab />}
        </main>
      </div>
    </div>
  )
}

/* ─── Appearance ─── */
/* ─── Advanced ─── */
function AdvancedTab() {
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error' | 'uptodate'>('idle')
  const [updateVersion, setUpdateVersion] = useState('')
  const [downloadPercent, setDownloadPercent] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const [appVersion, setAppVersion] = useState('')

  useEffect(() => {
    window.electronAPI?.getVersion?.().then((v: string) => setAppVersion(v))
    const unsub1 = window.electronAPI?.onUpdaterAvailable?.((data: { version: string }) => {
      setUpdateStatus('available')
      setUpdateVersion(data.version)
    })
    const unsub2 = window.electronAPI?.onUpdaterProgress?.((data: { percent: number }) => {
      setUpdateStatus('downloading')
      setDownloadPercent(data.percent)
    })
    const unsub3 = window.electronAPI?.onUpdaterDownloaded?.(() => {
      setUpdateStatus('ready')
    })
    const unsub4 = window.electronAPI?.onUpdaterNotAvailable?.(() => {
      setUpdateStatus('uptodate')
    })
    const unsub5 = window.electronAPI?.onUpdaterError?.((data: { message: string }) => {
      setUpdateStatus('error')
      setErrorMsg(data.message)
    })
    return () => { unsub1?.(); unsub2?.(); unsub3?.(); unsub4?.(); unsub5?.() }
  }, [])

  const checkUpdate = async () => {
    setUpdateStatus('checking')
    setErrorMsg('')
    try {
      const result = await window.electronAPI?.updaterCheck()
      if (result?.error) {
        setUpdateStatus('error')
        setErrorMsg(result.error)
      }
    } catch {
      setUpdateStatus('error')
      setErrorMsg('检查更新失败')
    }
  }

  const downloadUpdate = async () => {
    setUpdateStatus('downloading')
    setDownloadPercent(0)
    try {
      const result = await window.electronAPI?.updaterDownload()
      if (result?.success === false) {
        setUpdateStatus('error')
        setErrorMsg(result.error || '下载更新失败')
      }
    } catch {
      setUpdateStatus('error')
      setErrorMsg('下载更新失败')
    }
  }

  const installUpdate = () => {
    window.electronAPI?.updaterInstall()
  }

  return (
    <div className="space-y-6">
      {/* Version & Update */}
      <div>
        <h3 className="text-[13px] font-medium text-[var(--text)] mb-3">版本信息</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-[var(--muted)]">当前版本</span>
            <span className="text-[13px] font-mono text-[var(--text)]">v{appVersion || '...'}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[13px] text-[var(--muted)]">检查更新</span>
            <div className="flex items-center gap-2">
              {updateStatus === 'idle' && (
                <button
                  onClick={checkUpdate}
                  className="px-3 py-1 text-[12px] rounded-[6px] border border-[var(--border)] text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
                >
                  检查更新
                </button>
              )}
              {updateStatus === 'uptodate' && (
                <span className="text-[12px] text-[var(--good)]">已是最新版本</span>
              )}
              {updateStatus === 'checking' && (
                <span className="text-[12px] text-[var(--muted)]">检查中...</span>
              )}
              {updateStatus === 'available' && (
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-[var(--good)]">v{updateVersion} 可用</span>
                  <button
                    onClick={downloadUpdate}
                    className="px-3 py-1 text-[12px] rounded-[6px] bg-[var(--accent)] text-[var(--accent-ink)] hover:opacity-90 transition-colors"
                  >
                    下载
                  </button>
                </div>
              )}
              {updateStatus === 'downloading' && (
                <div className="flex items-center gap-2">
                  <div className="w-24 h-1.5 rounded-full bg-[var(--surface-3)] overflow-hidden">
                    <div className="h-full rounded-full bg-[var(--accent)] transition-all" style={{ width: `${downloadPercent}%` }} />
                  </div>
                  <span className="text-[12px] text-[var(--muted)]">{downloadPercent}%</span>
                </div>
              )}
              {updateStatus === 'ready' && (
                <button
                  onClick={installUpdate}
                  className="px-3 py-1 text-[12px] rounded-[6px] bg-[var(--good)] text-white hover:opacity-90 transition-colors"
                >
                  重启并安装
                </button>
              )}
              {updateStatus === 'error' && (
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-[var(--bad)]">失败</span>
                  <button
                    onClick={checkUpdate}
                    className="px-3 py-1 text-[12px] rounded-[6px] border border-[var(--border)] text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
                  >
                    重试
                  </button>
                </div>
              )}
            </div>
          </div>
          {errorMsg && (
            <p className="text-[11px] text-[var(--bad)]">{errorMsg}</p>
          )}
        </div>
      </div>

      {/* About */}
      <div>
        <h3 className="text-[13px] font-medium text-[var(--text)] mb-3">关于</h3>
        <div className="space-y-2 text-[13px] text-[var(--muted)]">
          <p>JDC Code — AI-powered coding assistant</p>
        </div>
      </div>
    </div>
  )
}

/* ─── Shortcuts ─── */
const SHORTCUTS = [
  { keys: '⌘ N', desc: '新建会话' },
  { keys: '⌘ W', desc: '关闭会话' },
  { keys: '⌘ K', desc: '清空对话' },
  { keys: '⌘ ,', desc: '打开设置' },
  { keys: 'Escape', desc: '停止生成' },
  { keys: 'Shift+Tab', desc: '计划模式' },
  { keys: '⌘ 1-9', desc: '切换会话' },
]

function ShortcutsTab() {
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="text-left text-[var(--muted)] border-b border-[var(--border)]">
          <th className="pb-2 font-normal">快捷键</th>
          <th className="pb-2 font-normal">描述</th>
        </tr>
      </thead>
      <tbody>
        {SHORTCUTS.map((s) => (
          <tr key={s.keys} className="border-b border-[var(--border)]">
            <td className="py-2 font-mono text-[12px] text-[var(--text)]">{s.keys}</td>
            <td className="py-2 text-[var(--muted)]">{s.desc}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/* ─── Models ─── */
function formatContextWindow(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`
  return String(n)
}

function ModelsTab() {
  const groups = useModelStore((s) => s.groups)
  const addGroup = useModelStore((s) => s.addGroup)
  const removeGroup = useModelStore((s) => s.removeGroup)
  const updateGroup = useModelStore((s) => s.updateGroup)
  const addModel = useModelStore((s) => s.addModel)
  const updateModel = useModelStore((s) => s.updateModel)
  const removeModel = useModelStore((s) => s.removeModel)
  const loadFromConfig = useModelStore((s) => s.loadFromConfig)
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null)
  const [showNewGroup, setShowNewGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupProtocol, setNewGroupProtocol] = useState<ApiProtocol>('anthropic')
  const [newGroupUrl, setNewGroupUrl] = useState('')
  const [newGroupKey, setNewGroupKey] = useState('')

  useEffect(() => { loadFromConfig() }, [loadFromConfig])

  const handleAddGroup = () => {
    if (!newGroupName.trim()) return
    addGroup(newGroupName.trim(), newGroupProtocol, newGroupUrl.trim(), newGroupKey.trim())
    setNewGroupName('')
    setNewGroupProtocol('anthropic')
    setNewGroupUrl('')
    setNewGroupKey('')
    setShowNewGroup(false)
  }

  const inputCls = 'w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-[6px] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--border-strong)]'
  const btnPrimary = 'bg-[var(--accent)] text-[var(--accent-ink)] rounded-[6px] px-3 py-1.5 text-[12px]'
  const btnGhost = 'border border-[var(--border)] rounded-[6px] px-3 py-1.5 text-[12px] text-[var(--muted)] hover:text-[var(--text)]'

  return (
    <div className="settings-tab-body space-y-4">
      <section className="settings-section flex items-center justify-between gap-4 rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
        <div className="min-w-0">
          <h4 className="text-[13px] font-semibold text-[var(--text)]">模型分组</h4>
          <p className="mt-1 text-[12px] leading-5 text-[var(--muted)]">按供应商或代理端点维护模型配置。</p>
        </div>
        <button onClick={() => setShowNewGroup(true)} className={`settings-primary-action ${btnPrimary} shrink-0`}>
          + 新建分组
        </button>
      </section>

      {showNewGroup && (
        <div className="settings-form-card border border-[var(--border)] rounded-[8px] bg-[var(--surface-2)] p-4 space-y-3">
          <input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="分组名称" className={inputCls} />
          <ProtocolSelect value={newGroupProtocol} onChange={setNewGroupProtocol} />
          <input value={newGroupUrl} onChange={(e) => setNewGroupUrl(e.target.value)} placeholder="Base URL" className={inputCls} />
          <input type="password" value={newGroupKey} onChange={(e) => setNewGroupKey(e.target.value)} placeholder="API Key" className={inputCls} />
          <div className="flex gap-2">
            <button onClick={handleAddGroup} className={btnPrimary}>确认</button>
            <button onClick={() => setShowNewGroup(false)} className={btnGhost}>取消</button>
          </div>
        </div>
      )}

      {groups.map((group) => (
        <ModelGroupCard
          key={group.id}
          group={group}
          expanded={expandedGroupId === group.id}
          onToggle={() => setExpandedGroupId(expandedGroupId === group.id ? null : group.id)}
          onDelete={() => removeGroup(group.id)}
          onUpdate={(updates) => updateGroup(group.id, updates)}
          onAddModel={(model) => addModel(group.id, model)}
          onUpdateModel={(modelId, updates) => updateModel(group.id, modelId, updates)}
          onRemoveModel={(modelId) => removeModel(group.id, modelId)}
        />
      ))}

      {groups.length === 0 && !showNewGroup && (
        <div className="settings-empty-state rounded-[8px] border border-dashed border-[var(--border)] bg-[var(--surface-2)] px-6 py-10 text-center">
          <div className="mx-auto mb-3 h-8 w-8 rounded-[6px] border border-[var(--border)] bg-[var(--surface-3)]" />
          <h4 className="text-[13px] font-semibold text-[var(--text)]">暂无模型分组</h4>
          <p className="mx-auto mt-2 max-w-[360px] text-[12px] leading-5 text-[var(--muted)]">创建一个分组后，可以把 Base URL、协议和模型 ID 绑定在一起，切换会更稳。</p>
        </div>
      )}
    </div>
  )
}

/* ─── Model Edit Form ─── */
function ModelEditForm({ model, inputCls, onSave, onCancel }: {
  model: { modelId: string; name: string; contextWindow: number; maxTokens: number; compressAt: number }
  inputCls: string
  onSave: (updates: { modelId: string; name: string; contextWindow: number; maxTokens: number; compressAt: number }) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(model.name)
  const [modelId, setModelId] = useState(model.modelId)
  const [ctx, setCtx] = useState(String(model.contextWindow))
  const [maxTokens, setMaxTokens] = useState(String(model.maxTokens || 32000))
  const [compress, setCompress] = useState(String(Math.round(model.compressAt * 100)))
  const btnPrimary = 'bg-[var(--accent)] text-[var(--accent-ink)] rounded-[6px] px-3 py-1.5 text-[12px]'
  const btnGhost = 'border border-[var(--border)] rounded-[6px] px-3 py-1.5 text-[12px] text-[var(--muted)] hover:text-[var(--text)]'

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="显示名称" className={inputCls} />
        <input value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="Model ID" className={inputCls} />
        <input value={ctx} onChange={(e) => setCtx(e.target.value)} placeholder="200000" type="number" className={inputCls + ' [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'} />
        <input value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} placeholder="32000" type="number" className={inputCls + ' [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'} />
        <input value={compress} onChange={(e) => setCompress(e.target.value)} placeholder="90" type="number" className={inputCls + ' [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'} />
      </div>
      <div className="flex gap-2">
        <button onClick={() => onSave({ name: name.trim(), modelId: modelId.trim(), contextWindow: parseInt(ctx) || 200000, maxTokens: parseInt(maxTokens) || 32000, compressAt: (parseInt(compress) || 90) / 100 })} className={btnPrimary}>保存</button>
        <button onClick={onCancel} className={btnGhost}>取消</button>
      </div>
    </div>
  )
}

/* ─── Model Group Card ─── */
interface ModelGroupCardProps {
  group: ModelGroup
  expanded: boolean
  onToggle: () => void
  onDelete: () => void
  onUpdate: (updates: Partial<Omit<ModelGroup, 'id' | 'models'>>) => void
  onAddModel: (model: { modelId: string; name: string; contextWindow: number; maxTokens: number; compressAt: number }) => void
  onUpdateModel: (modelId: string, updates: Partial<{ modelId: string; name: string; contextWindow: number; maxTokens: number; compressAt: number }>) => void
  onRemoveModel: (modelId: string) => void
}

function ModelGroupCard({ group, expanded, onToggle, onDelete, onUpdate, onAddModel, onUpdateModel, onRemoveModel }: ModelGroupCardProps) {
  const [editUrl, setEditUrl] = useState(group.baseUrl)
  const [editKey, setEditKey] = useState(group.apiKey)
  const [editName, setEditName] = useState(group.name)
  const [editingName, setEditingName] = useState(false)
  const [showAddModel, setShowAddModel] = useState(false)
  const [editingModelId, setEditingModelId] = useState<string | null>(null)
  const [mName, setMName] = useState('')
  const [mId, setMId] = useState('')
  const [mCtx, setMCtx] = useState('200000')
  const [mMaxTokens, setMMaxTokens] = useState('32000')
  const [mCompress, setMCompress] = useState('90')
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; msg: string } | null>(null)

  const inputCls = 'w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-[6px] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--border-strong)]'
  const btnPrimary = 'bg-[var(--accent)] text-[var(--accent-ink)] rounded-[6px] px-3 py-1.5 text-[12px]'
  const btnGhost = 'border border-[var(--border)] rounded-[6px] px-3 py-1.5 text-[12px] text-[var(--muted)] hover:text-[var(--text)]'

  const handleTestModel = async (modelId: string, modelEntryId: string) => {
    setTesting(modelEntryId)
    setTestResult(null)
    const result = await window.electronAPI?.modelTest({ protocol: group.protocol, baseUrl: group.baseUrl, apiKey: group.apiKey, modelId })
    if (result?.success) {
      setTestResult({ id: modelEntryId, success: true, msg: result.reply || '' })
    } else {
      setTestResult({ id: modelEntryId, success: false, msg: result?.error || '连接失败' })
    }
    setTesting(null)
  }

  const handleAddModel = () => {
    if (!mName.trim() || !mId.trim()) return
    onAddModel({
      name: mName.trim(),
      modelId: mId.trim(),
      contextWindow: parseInt(mCtx) || 200000,
      maxTokens: parseInt(mMaxTokens) || 32000,
      compressAt: (parseInt(mCompress) || 90) / 100,
    })
    setMName('')
    setMId('')
    setMCtx('200000')
    setMMaxTokens('32000')
    setMCompress('90')
    setShowAddModel(false)
  }

  return (
    <div className="mb-3 border border-[var(--border)] rounded-[6px] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-[var(--surface-2)] transition-colors" onClick={onToggle}>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-[var(--muted)]">{expanded ? '▼' : '▶'}</span>
          {editingName ? (
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={() => { onUpdate({ name: editName }); setEditingName(false) }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { onUpdate({ name: editName }); setEditingName(false) } }}
              onClick={(e) => e.stopPropagation()}
              autoFocus
              className="text-[13px] text-[var(--text)] font-medium bg-[var(--surface-2)] border border-[var(--border)] rounded px-1.5 py-0.5 outline-none w-32"
            />
          ) : (
            <span className="text-[13px] text-[var(--text)] font-medium" onDoubleClick={(e) => { e.stopPropagation(); setEditingName(true) }}>{group.name}</span>
          )}
          <select
            value={group.protocol}
            onChange={(e) => { e.stopPropagation(); onUpdate({ protocol: e.target.value as ApiProtocol }) }}
            onClick={(e) => e.stopPropagation()}
            className="text-[11px] text-[var(--muted)] border border-[var(--border)] rounded px-1.5 py-0.5 bg-transparent outline-none cursor-pointer"
          >
            <option value="anthropic">anthropic</option>
            <option value="openai">openai</option>
            <option value="openai-responses">openai-responses</option>
          </select>
        </div>
        <button onClick={(e) => { e.stopPropagation(); onDelete() }} className="text-[12px] text-[var(--muted)] hover:text-red-500 transition-colors">
          删除
        </button>
      </div>
      {expanded && (
        <div className="border-t border-[var(--border)] px-4 py-4 space-y-3">
          <input value={editUrl} onChange={(e) => setEditUrl(e.target.value)} onBlur={() => onUpdate({ baseUrl: editUrl })} placeholder="Base URL" className={inputCls} />
          <input type="password" value={editKey} onChange={(e) => setEditKey(e.target.value)} onBlur={() => onUpdate({ apiKey: editKey })} placeholder="API Key" className={inputCls} />

          <div className="space-y-2">
            {group.models.map((model) => (
              <div key={model.id} className="border border-[var(--border)] rounded-[6px] px-3 py-2 space-y-1">
                {editingModelId === model.id ? (
                  <ModelEditForm
                    model={model}
                    inputCls={inputCls}
                    onSave={(updates) => { onUpdateModel(model.id, updates); setEditingModelId(null) }}
                    onCancel={() => setEditingModelId(null)}
                  />
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[13px] text-[var(--text)]">{model.name}</div>
                        <div className="text-[11px] text-[var(--muted)]">
                          {model.modelId} &middot; {formatContextWindow(model.contextWindow)} &middot; 输出 {formatContextWindow(model.maxTokens || 32000)} &middot; {Math.round(model.compressAt * 100)}%
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleTestModel(model.modelId, model.id)}
                          disabled={testing === model.id}
                          className="text-[12px] text-[var(--accent)] hover:opacity-80 transition-colors disabled:opacity-50"
                        >
                          {testing === model.id ? '测试中...' : '测试'}
                        </button>
                        <button onClick={() => setEditingModelId(model.id)} className="text-[12px] text-[var(--accent)] hover:opacity-80 transition-colors">编辑</button>
                        <button onClick={() => onRemoveModel(model.id)} className="text-[12px] text-[var(--muted)] hover:text-red-500 transition-colors">删除</button>
                      </div>
                    </div>
                    {testResult?.id === model.id && (
                      <div className={`text-[11px] ${testResult.success ? 'text-[var(--good)]' : 'text-[var(--bad)]'}`}>
                        {testResult.success ? '✓' : '✗'} {testResult.msg}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>

          {showAddModel ? (
            <div className="border border-[var(--border)] rounded-[6px] p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input value={mName} onChange={(e) => setMName(e.target.value)} placeholder="显示名称" className={inputCls} />
                <input value={mId} onChange={(e) => setMId(e.target.value)} placeholder="Model ID" className={inputCls} />
                <div className="relative">
                  <input value={mCtx} onChange={(e) => setMCtx(e.target.value)} placeholder="200000" type="number" className={inputCls + ' pr-8 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'} />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2"><Tooltip text="上下文窗口大小 (tokens)"><span className="text-[var(--muted)] cursor-help">ⓘ</span></Tooltip></span>
                </div>
                <div className="relative">
                  <input value={mMaxTokens} onChange={(e) => setMMaxTokens(e.target.value)} placeholder="32000" type="number" className={inputCls + ' pr-8 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'} />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2"><Tooltip text="最大输出 tokens"><span className="text-[var(--muted)] cursor-help">ⓘ</span></Tooltip></span>
                </div>
                <div className="relative">
                  <input value={mCompress} onChange={(e) => setMCompress(e.target.value)} placeholder="90" type="number" className={inputCls + ' pr-8 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'} />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2"><Tooltip text="压缩阈值 (%)"><span className="text-[var(--muted)] cursor-help">ⓘ</span></Tooltip></span>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={handleAddModel} className={btnPrimary}>添加</button>
                <button onClick={() => setShowAddModel(false)} className={btnGhost}>取消</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowAddModel(true)} className={btnGhost}>+ 添加模型</button>
          )}
        </div>
      )}
    </div>
  )
}

/* ─── MCP ─── */
function McpTab() {
  const [servers, setServers] = useState<McpServerState[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const projects = useSessionStore((s) => s.projects)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const activeProject = projects.find((p) => p.sessions.some((s) => s.id === activeSessionId))
  const cwd = activeProject?.cwd || ''

  useEffect(() => {
    setLoading(true)
    window.electronAPI?.mcpListServers().then((states) => {
      setServers(states ?? [])
      setLoading(false)
    })
    window.electronAPI?.onMcpStateChanged((states) => {
      setServers(states)
    })
  }, [])

  const statusDot = (status: string) => {
    switch (status) {
      case 'connected': return <span className="text-green-500">●</span>
      case 'connecting': return <span className="text-yellow-400 animate-pulse">●</span>
      case 'failed': return <span className="text-red-500">●</span>
      case 'disabled': return <span className="text-[var(--muted)]">○</span>
      default: return <span className="text-[var(--muted)]">●</span>
    }
  }

  const handleReconnect = async (name: string) => { await window.electronAPI?.mcpReconnect(name) }
  const handleToggle = async (name: string, currentlyDisabled: boolean) => { await window.electronAPI?.mcpToggle(name, currentlyDisabled) }
  const handleDelete = async (name: string) => {
    const allServers: Record<string, any> = {}
    for (const s of servers) {
      if (s.name !== name) allServers[s.name] = s.config
    }
    await window.electronAPI?.mcpSaveConfig(allServers, 'global')
    setServers((prev) => prev.filter((s) => s.name !== name))
  }

  if (loading) return <p className="text-[13px] text-[var(--muted)] animate-pulse">加载中...</p>

  return (
    <div className="space-y-2">
      {servers.length === 0 && <p className="text-[13px] text-[var(--muted)] text-center py-4">暂无 MCP 服务器配置</p>}
      {servers.map((server) => (
        <div key={server.name} className="border border-[var(--border)] rounded-[6px] overflow-hidden">
          <div
            className="flex items-center justify-between px-3 py-2.5 cursor-pointer hover:bg-[var(--surface-2)] transition-colors"
            onClick={() => setExpanded(expanded === server.name ? null : server.name)}
          >
            <div className="flex items-center gap-2">
              {statusDot(server.status)}
              <span className="text-[13px] text-[var(--text)]">{server.name}</span>
              <span className="text-[11px] text-[var(--muted)] border border-[var(--border)] rounded px-1.5 py-0.5">{server.config.transport}</span>
              {server.status === 'connected' && (
                <span className="text-[11px] text-[var(--muted)]">{server.tools.length} tools</span>
              )}
            </div>
            <span className="text-[11px] text-[var(--muted)]">{expanded === server.name ? '▼' : '▶'}</span>
          </div>

          {expanded === server.name && (
            <div className="border-t border-[var(--border)] px-3 py-3 space-y-2">
              <div className="text-[12px] text-[var(--muted)]">
                {server.config.transport === 'stdio' && <span>CMD: {server.config.command} {server.config.args?.join(' ')}</span>}
                {server.config.transport === 'sse' && <span>URL: {server.config.url}</span>}
              </div>
              {server.error && <div className="text-[12px] text-red-500 break-all">Error: {server.error}</div>}
              {server.tools.length > 0 && (
                <div className="max-h-[160px] overflow-y-auto space-y-0.5">
                  {server.tools.map((tool) => (
                    <div key={tool.name} className="text-[12px] text-[var(--text)] pl-2">
                      <span className="text-green-500 mr-1">*</span>{tool.name}
                      {tool.description && <span className="text-[var(--muted)] ml-1">- {tool.description}</span>}
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2 pt-2 border-t border-[var(--border)]">
                {server.status === 'failed' && (
                  <button onClick={() => handleReconnect(server.name)} className="text-[12px] text-yellow-500 hover:text-yellow-400">重连</button>
                )}
                {server.status !== 'disabled' && server.status !== 'connecting' && (
                  <button onClick={() => handleToggle(server.name, false)} className="text-[12px] text-[var(--muted)] hover:text-red-500">禁用</button>
                )}
                {server.status === 'disabled' && (
                  <button onClick={() => handleToggle(server.name, true)} className="text-[12px] text-[var(--muted)] hover:text-green-500">启用</button>
                )}
                <button onClick={() => handleDelete(server.name)} className="text-[12px] text-[var(--muted)] hover:text-red-500">删除</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/* ─── Tools ─── */
const SEARCH_PROVIDERS = [
  { value: 'brave', label: 'Brave Search', keyField: 'braveApiKey', placeholder: 'BSA...' },
  { value: 'tavily', label: 'Tavily', keyField: 'tavilyApiKey', placeholder: 'tvly-...' },
  { value: 'serper', label: 'Serper (Google)', keyField: 'serperApiKey', placeholder: 'Your Serper key' },
] as const

function ToolsTab() {
  const [provider, setProvider] = useState<string>('brave')
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [proxy, setProxy] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    ipc.config.get().then((cfg: any) => {
      const ws = cfg?.webSearch || {}
      setProvider(ws.provider || 'brave')
      setKeys({
        braveApiKey: ws.braveApiKey || '',
        tavilyApiKey: ws.tavilyApiKey || '',
        serperApiKey: ws.serperApiKey || '',
      })
      setProxy(ws.proxy || '')
    })
  }, [])

  const handleSave = async () => {
    await ipc.config.set({
      webSearch: { provider, ...keys, proxy: proxy || undefined },
    } as any)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const inputCls = 'w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-[6px] px-3 py-2 text-[13px] text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--accent)]'
  const labelCls = 'text-[12px] text-[var(--muted)] mb-1'

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-[14px] font-medium text-[var(--text)] mb-3">联网搜索</h3>

        <div className="mb-4">
          <div className={labelCls}>搜索引擎</div>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className={inputCls}
          >
            {SEARCH_PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>

        {SEARCH_PROVIDERS.map((p) => (
          <div key={p.value} className="mb-3">
            <div className={labelCls}>{p.label} API Key</div>
            <input
              type="password"
              value={keys[p.keyField] || ''}
              onChange={(e) => setKeys({ ...keys, [p.keyField]: e.target.value })}
              placeholder={p.placeholder}
              className={inputCls}
            />
          </div>
        ))}

        <div className="mb-4">
          <div className={labelCls}>HTTP 代理（可选）</div>
          <input
            type="text"
            value={proxy}
            onChange={(e) => setProxy(e.target.value)}
            placeholder="http://127.0.0.1:7890"
            className={inputCls}
          />
          <div className="text-[11px] text-[var(--muted)] mt-1">留空则直连，配置后所有搜索请求走代理</div>
        </div>

        <button
          onClick={handleSave}
          className="px-4 py-2 text-[13px] rounded-[6px] bg-[var(--accent)] text-[var(--accent-ink)] hover:opacity-90 transition-opacity"
        >
          {saved ? '已保存 ✓' : '保存'}
        </button>
      </div>
    </div>
  )
}

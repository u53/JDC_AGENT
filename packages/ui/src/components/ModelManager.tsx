import { useState, useEffect } from 'react'
import { useModelStore, type ModelGroup, type ApiProtocol } from '../stores/model-store'
import { useSettingsStore } from '../stores/settings-store'

function formatContextWindow(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`
  return String(n)
}

export function ModelManager() {
  const { isOpen, close } = useSettingsStore()
  const { groups, addGroup, removeGroup, updateGroup, addModel, removeModel, loadFromConfig } = useModelStore()
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null)
  const [showNewGroup, setShowNewGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupProtocol, setNewGroupProtocol] = useState<ApiProtocol>('anthropic')
  const [newGroupUrl, setNewGroupUrl] = useState('')
  const [newGroupKey, setNewGroupKey] = useState('')

  useEffect(() => {
    if (isOpen) loadFromConfig()
  }, [isOpen, loadFromConfig])

  if (!isOpen) return null

  const handleAddGroup = () => {
    if (!newGroupName.trim()) return
    addGroup(newGroupName.trim(), newGroupProtocol, newGroupUrl.trim(), newGroupKey.trim())
    setNewGroupName('')
    setNewGroupProtocol('anthropic')
    setNewGroupUrl('')
    setNewGroupKey('')
    setShowNewGroup(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
      <div className="w-[560px] max-h-[80vh] flex flex-col rounded-[12px] border border-[#EAEAEA] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
        <div className="flex items-center justify-between px-8 pt-8 pb-4">
          <h2 className="text-base font-medium text-[#2F3437]">模型管理</h2>
          <button onClick={close} className="text-[#787774] hover:text-[#2F3437] text-lg">&times;</button>
        </div>
        <div className="flex-1 overflow-y-auto px-8 pb-8">
          <button
            onClick={() => setShowNewGroup(true)}
            className="mb-4 rounded-[6px] bg-[#111111] px-3 py-2 text-sm text-white hover:opacity-90 transition-opacity"
          >
            新建分组
          </button>

          {showNewGroup && (
            <div className="mb-4 rounded-[8px] border border-[#EAEAEA] p-4">
              <label className="mb-1.5 block text-xs text-[#787774] uppercase tracking-wide font-medium">分组名称</label>
              <input
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="我的 Claude 代理"
                className="mb-3 w-full rounded-[6px] border border-[#EAEAEA] bg-[#F7F6F3] px-3 py-2 text-sm outline-none"
              />
              <label className="mb-1.5 block text-xs text-[#787774] uppercase tracking-wide font-medium">API 协议</label>
              <select
                value={newGroupProtocol}
                onChange={(e) => setNewGroupProtocol(e.target.value as ApiProtocol)}
                className="mb-3 w-full rounded-[6px] border border-[#EAEAEA] bg-[#F7F6F3] px-3 py-2 text-sm outline-none"
              >
                <option value="anthropic">Anthropic (/v1/messages)</option>
                <option value="openai">OpenAI (/v1/chat/completions)</option>
                <option value="openai-responses">OpenAI Responses (/v1/responses)</option>
              </select>
              <label className="mb-1.5 block text-xs text-[#787774] uppercase tracking-wide font-medium">Base URL</label>
              <input
                value={newGroupUrl}
                onChange={(e) => setNewGroupUrl(e.target.value)}
                placeholder="https://api.anthropic.com"
                className="mb-3 w-full rounded-[6px] border border-[#EAEAEA] bg-[#F7F6F3] px-3 py-2 text-sm outline-none"
              />
              <label className="mb-1.5 block text-xs text-[#787774] uppercase tracking-wide font-medium">API Key</label>
              <input
                type="password"
                value={newGroupKey}
                onChange={(e) => setNewGroupKey(e.target.value)}
                placeholder="sk-..."
                className="mb-3 w-full rounded-[6px] border border-[#EAEAEA] bg-[#F7F6F3] px-3 py-2 text-sm outline-none"
              />
              <div className="flex gap-2">
                <button onClick={handleAddGroup} className="rounded-[6px] bg-[#111111] px-3 py-1.5 text-sm text-white hover:opacity-90">确定</button>
                <button onClick={() => setShowNewGroup(false)} className="rounded-[6px] border border-[#EAEAEA] px-3 py-1.5 text-sm text-[#787774] hover:text-[#2F3437]">取消</button>
              </div>
            </div>
          )}

          {groups.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              expanded={expandedGroupId === group.id}
              onToggle={() => setExpandedGroupId(expandedGroupId === group.id ? null : group.id)}
              onDelete={() => removeGroup(group.id)}
              onUpdate={(updates) => updateGroup(group.id, updates)}
              onAddModel={(model) => addModel(group.id, model)}
              onRemoveModel={(modelId) => removeModel(group.id, modelId)}
            />
          ))}

          {groups.length === 0 && !showNewGroup && (
            <div className="text-center text-sm text-[#787774] py-8">暂无分组，点击上方按钮创建</div>
          )}
        </div>
      </div>
    </div>
  )
}

interface GroupCardProps {
  group: ModelGroup
  expanded: boolean
  onToggle: () => void
  onDelete: () => void
  onUpdate: (updates: Partial<Omit<ModelGroup, 'id' | 'models'>>) => void
  onAddModel: (model: { modelId: string; name: string; contextWindow: number; compressAt: number }) => void
  onRemoveModel: (modelId: string) => void
}

function GroupCard({ group, expanded, onToggle, onDelete, onUpdate, onAddModel, onRemoveModel }: GroupCardProps) {
  const [editUrl, setEditUrl] = useState(group.baseUrl)
  const [editKey, setEditKey] = useState(group.apiKey)
  const [showAddModel, setShowAddModel] = useState(false)
  const [mName, setMName] = useState('')
  const [mId, setMId] = useState('')
  const [mCtx, setMCtx] = useState('200000')
  const [mCompress, setMCompress] = useState('90')

  const handleAddModel = () => {
    if (!mName.trim() || !mId.trim()) return
    onAddModel({
      name: mName.trim(),
      modelId: mId.trim(),
      contextWindow: parseInt(mCtx) || 200000,
      compressAt: (parseInt(mCompress) || 90) / 100,
    })
    setMName('')
    setMId('')
    setMCtx('200000')
    setMCompress('90')
    setShowAddModel(false)
  }

  return (
    <div className="mb-3 rounded-[8px] border border-[#EAEAEA]">
      <div className="flex items-center justify-between px-4 py-3 cursor-pointer" onClick={onToggle}>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#787774]">{expanded ? '▼' : '▶'}</span>
          <span className="text-sm font-medium text-[#2F3437]">{group.name}</span>
          <span className="text-[10px] text-[#787774] border border-[#EAEAEA] rounded px-1.5 py-0.5">{group.protocol}</span>
          <span className="text-xs text-[#787774] font-mono truncate max-w-[160px]">{group.baseUrl}</span>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="text-xs text-[#787774] hover:text-red-500"
        >
          删除
        </button>
      </div>
      {expanded && (
        <div className="border-t border-[#EAEAEA] px-4 py-3">
          <label className="mb-1.5 block text-xs text-[#787774] uppercase tracking-wide font-medium">Base URL</label>
          <input
            value={editUrl}
            onChange={(e) => setEditUrl(e.target.value)}
            onBlur={() => onUpdate({ baseUrl: editUrl })}
            className="mb-3 w-full rounded-[6px] border border-[#EAEAEA] bg-[#F7F6F3] px-3 py-2 text-sm outline-none"
          />
          <label className="mb-1.5 block text-xs text-[#787774] uppercase tracking-wide font-medium">API Key</label>
          <input
            type="password"
            value={editKey}
            onChange={(e) => setEditKey(e.target.value)}
            onBlur={() => onUpdate({ apiKey: editKey })}
            className="mb-4 w-full rounded-[6px] border border-[#EAEAEA] bg-[#F7F6F3] px-3 py-2 text-sm outline-none"
          />

          <div className="mb-3">
            <label className="mb-1.5 block text-xs text-[#787774] uppercase tracking-wide font-medium">模型列表</label>
            {group.models.map((model) => (
              <div key={model.id} className="flex items-center justify-between rounded-[6px] border border-[#EAEAEA] px-3 py-2 mb-2">
                <div>
                  <div className="text-sm text-[#2F3437]">{model.name}</div>
                  <div className="text-xs font-mono text-[#787774]">{model.modelId}</div>
                  <div className="text-xs text-[#787774]">
                    上下文: {formatContextWindow(model.contextWindow)} | 压缩: {Math.round(model.compressAt * 100)}%
                  </div>
                </div>
                <button onClick={() => onRemoveModel(model.id)} className="text-xs text-[#787774] hover:text-red-500">删除</button>
              </div>
            ))}
          </div>

          {showAddModel ? (
            <div className="rounded-[6px] border border-[#EAEAEA] p-3">
              <div className="grid grid-cols-2 gap-2 mb-2">
                <div>
                  <label className="mb-1 block text-xs text-[#787774]">显示名称</label>
                  <input value={mName} onChange={(e) => setMName(e.target.value)} placeholder="Claude Opus 4"
                    className="w-full rounded-[6px] border border-[#EAEAEA] bg-[#F7F6F3] px-2 py-1.5 text-sm outline-none" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[#787774]">模型 ID</label>
                  <input value={mId} onChange={(e) => setMId(e.target.value)} placeholder="claude-opus-4-20250514"
                    className="w-full rounded-[6px] border border-[#EAEAEA] bg-[#F7F6F3] px-2 py-1.5 text-sm font-mono outline-none" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[#787774]">上下文窗口</label>
                  <input value={mCtx} onChange={(e) => setMCtx(e.target.value)} placeholder="200000"
                    className="w-full rounded-[6px] border border-[#EAEAEA] bg-[#F7F6F3] px-2 py-1.5 text-sm outline-none" type="number" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[#787774]">压缩阈值 (%)</label>
                  <input value={mCompress} onChange={(e) => setMCompress(e.target.value)} placeholder="90"
                    className="w-full rounded-[6px] border border-[#EAEAEA] bg-[#F7F6F3] px-2 py-1.5 text-sm outline-none" type="number" />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={handleAddModel} className="rounded-[6px] bg-[#111111] px-3 py-1.5 text-sm text-white hover:opacity-90">添加</button>
                <button onClick={() => setShowAddModel(false)} className="rounded-[6px] border border-[#EAEAEA] px-3 py-1.5 text-sm text-[#787774]">取消</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowAddModel(true)} className="text-sm text-[#787774] hover:text-[#2F3437]">+ 添加模型</button>
          )}
        </div>
      )}
    </div>
  )
}

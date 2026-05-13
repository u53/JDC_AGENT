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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85">
      <div className="w-[580px] max-h-[80vh] flex flex-col border border-[#333] bg-[#0A0A0A]">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-[#333]">
          <h2 className="text-xs uppercase tracking-[0.1em] text-[#EAEAEA]">[ MODEL CONFIGURATION ]</h2>
          <button onClick={close} className="text-[#666] hover:text-[#EAEAEA] text-xs uppercase tracking-[0.1em]">[CLOSE]</button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <button
            onClick={() => setShowNewGroup(true)}
            className="mb-4 border border-[#EAEAEA] text-[#EAEAEA] px-3 py-2 text-[10px] uppercase tracking-[0.1em] hover:bg-[#EAEAEA] hover:text-[#0A0A0A] transition-colors"
          >
            + NEW GROUP
          </button>
          {showNewGroup && (
            <div className="mb-4 border border-[#333] p-4">
              <label className="mb-1.5 block text-[10px] text-[#666] uppercase tracking-[0.1em]">GROUP NAME</label>
              <input
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="My Claude Agents"
                className="mb-3 w-full bg-transparent border border-[#333] px-3 py-2 text-sm text-[#EAEAEA] outline-none focus:border-[#EAEAEA]"
              />
              <label className="mb-1.5 block text-[10px] text-[#666] uppercase tracking-[0.1em]">API PROTOCOL</label>
              <select
                value={newGroupProtocol}
                onChange={(e) => setNewGroupProtocol(e.target.value as ApiProtocol)}
                className="mb-3 w-full bg-[#0A0A0A] border border-[#333] px-3 py-2 text-sm text-[#EAEAEA] outline-none focus:border-[#EAEAEA]"
              >
                <option value="anthropic">Anthropic (/v1/messages)</option>
                <option value="openai">OpenAI (/v1/chat/completions)</option>
                <option value="openai-responses">OpenAI Responses (/v1/responses)</option>
              </select>
              <label className="mb-1.5 block text-[10px] text-[#666] uppercase tracking-[0.1em]">BASE URL</label>
              <input
                value={newGroupUrl}
                onChange={(e) => setNewGroupUrl(e.target.value)}
                placeholder="https://api.anthropic.com"
                className="mb-3 w-full bg-transparent border border-[#333] px-3 py-2 text-sm text-[#EAEAEA] outline-none focus:border-[#EAEAEA]"
              />
              <label className="mb-1.5 block text-[10px] text-[#666] uppercase tracking-[0.1em]">API KEY</label>
              <input
                type="password"
                value={newGroupKey}
                onChange={(e) => setNewGroupKey(e.target.value)}
                placeholder="sk-..."
                className="mb-3 w-full bg-transparent border border-[#333] px-3 py-2 text-sm text-[#EAEAEA] outline-none focus:border-[#EAEAEA]"
              />
              <div className="flex gap-2">
                <button onClick={handleAddGroup} className="border border-[#EAEAEA] text-[#EAEAEA] px-3 py-1.5 text-[10px] uppercase tracking-[0.05em] hover:bg-[#EAEAEA] hover:text-[#0A0A0A]">[CONFIRM]</button>
                <button onClick={() => setShowNewGroup(false)} className="border border-[#333] text-[#666] px-3 py-1.5 text-[10px] uppercase tracking-[0.05em] hover:text-[#EAEAEA]">[CANCEL]</button>
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
            <div className="text-center text-[10px] text-[#666] uppercase tracking-[0.1em] py-8">NO GROUPS // CREATE ONE ABOVE</div>
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
    <div className="mb-3 border border-[#333]">
      <div className="flex items-center justify-between px-4 py-3 cursor-pointer" onClick={onToggle}>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#666]">{expanded ? '▼' : '▶'}</span>
          <span className="text-xs uppercase tracking-[0.05em] text-[#EAEAEA]">{group.name}</span>
          <span className="text-[10px] text-[#666] border border-[#333] px-1.5 py-0.5">{group.protocol}</span>
          <span className="text-[10px] text-[#666] truncate max-w-[160px]">{group.baseUrl}</span>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="text-[10px] text-[#666] uppercase tracking-[0.05em] hover:text-[#E61919]"
        >
          [DEL]
        </button>
      </div>
      {expanded && (
        <div className="border-t border-[#333] px-4 py-3">
          <label className="mb-1.5 block text-[10px] text-[#666] uppercase tracking-[0.1em]">BASE URL</label>
          <input
            value={editUrl}
            onChange={(e) => setEditUrl(e.target.value)}
            onBlur={() => onUpdate({ baseUrl: editUrl })}
            className="mb-3 w-full bg-transparent border border-[#333] px-3 py-2 text-sm text-[#EAEAEA] outline-none focus:border-[#EAEAEA]"
          />
          <label className="mb-1.5 block text-[10px] text-[#666] uppercase tracking-[0.1em]">API KEY</label>
          <input
            type="password"
            value={editKey}
            onChange={(e) => setEditKey(e.target.value)}
            onBlur={() => onUpdate({ apiKey: editKey })}
            className="mb-4 w-full bg-transparent border border-[#333] px-3 py-2 text-sm text-[#EAEAEA] outline-none focus:border-[#EAEAEA]"
          />
          <div className="mb-3">
            <label className="mb-1.5 block text-[10px] text-[#666] uppercase tracking-[0.1em]">MODELS</label>
            {group.models.map((model) => (
              <div key={model.id} className="flex items-center justify-between border border-[#333] px-3 py-2 mb-2">
                <div>
                  <div className="text-xs text-[#EAEAEA]">{model.name}</div>
                  <div className="text-[10px] text-[#666]">{model.modelId}</div>
                  <div className="text-[10px] text-[#666]">
                    CTX: {formatContextWindow(model.contextWindow)} // COMPRESS: {Math.round(model.compressAt * 100)}%
                  </div>
                </div>
                <button onClick={() => onRemoveModel(model.id)} className="text-[10px] text-[#666] uppercase hover:text-[#E61919]">[DEL]</button>
              </div>
            ))}
          </div>

          {showAddModel ? (
            <div className="border border-[#333] p-3">
              <div className="grid grid-cols-2 gap-2 mb-2">
                <div>
                  <label className="mb-1 block text-[10px] text-[#666] uppercase tracking-[0.1em]">DISPLAY NAME</label>
                  <input value={mName} onChange={(e) => setMName(e.target.value)} placeholder="Claude Opus 4"
                    className="w-full bg-transparent border border-[#333] px-2 py-1.5 text-sm text-[#EAEAEA] outline-none focus:border-[#EAEAEA]" />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] text-[#666] uppercase tracking-[0.1em]">MODEL ID</label>
                  <input value={mId} onChange={(e) => setMId(e.target.value)} placeholder="claude-opus-4-20250514"
                    className="w-full bg-transparent border border-[#333] px-2 py-1.5 text-sm text-[#EAEAEA] outline-none focus:border-[#EAEAEA]" />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] text-[#666] uppercase tracking-[0.1em]">CONTEXT WINDOW</label>
                  <input value={mCtx} onChange={(e) => setMCtx(e.target.value)} placeholder="200000"
                    className="w-full bg-transparent border border-[#333] px-2 py-1.5 text-sm text-[#EAEAEA] outline-none focus:border-[#EAEAEA]" type="number" />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] text-[#666] uppercase tracking-[0.1em]">COMPRESS AT (%)</label>
                  <input value={mCompress} onChange={(e) => setMCompress(e.target.value)} placeholder="90"
                    className="w-full bg-transparent border border-[#333] px-2 py-1.5 text-sm text-[#EAEAEA] outline-none focus:border-[#EAEAEA]" type="number" />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={handleAddModel} className="border border-[#EAEAEA] text-[#EAEAEA] px-3 py-1.5 text-[10px] uppercase tracking-[0.05em] hover:bg-[#EAEAEA] hover:text-[#0A0A0A]">[ADD]</button>
                <button onClick={() => setShowAddModel(false)} className="border border-[#333] text-[#666] px-3 py-1.5 text-[10px] uppercase tracking-[0.05em] hover:text-[#EAEAEA]">[CANCEL]</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowAddModel(true)} className="text-[10px] text-[#666] uppercase tracking-[0.1em] hover:text-[#EAEAEA]">+ ADD MODEL</button>
          )}
        </div>
      )}
    </div>
  )
}
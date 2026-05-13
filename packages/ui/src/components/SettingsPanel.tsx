import { useEffect, useState } from 'react'
import { useSettingsStore } from '../stores/settings-store'

export function SettingsPanel() {
  const { isOpen, config, close, load, save } = useSettingsStore()
  const [provider, setProvider] = useState('anthropic')
  const [apiKey, setApiKey] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [defaultModel, setDefaultModel] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [newModel, setNewModel] = useState('')

  useEffect(() => {
    if (isOpen) {
      load()
    }
  }, [isOpen, load])

  useEffect(() => {
    if (config) {
      setProvider(config.provider || 'anthropic')
      setApiKey(config.apiKey || '')
      setModels(config.models || [])
      setDefaultModel(config.defaultModel || '')
      setEndpoint(config.endpoint || '')
    }
  }, [config])

  if (!isOpen) return null

  const handleSave = () => {
    save({ provider, apiKey, models, defaultModel, endpoint })
  }

  const handleAddModel = () => {
    const trimmed = newModel.trim()
    if (trimmed && !models.includes(trimmed)) {
      setModels([...models, trimmed])
      setNewModel('')
    }
  }

  const handleRemoveModel = (m: string) => {
    setModels(models.filter((x) => x !== m))
    if (defaultModel === m) setDefaultModel('')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
      <div className="w-[480px] rounded-[12px] border border-[#EAEAEA] bg-white p-8 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
        <h2 className="mb-6 text-base font-medium text-[#2F3437]">设置</h2>

        <label className="mb-1.5 block text-xs text-[#787774] uppercase tracking-wide font-medium">模型提供商</label>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="mb-5 w-full rounded-[6px] border border-[#EAEAEA] bg-[#F7F6F3] px-3 py-2 text-sm text-[#2F3437] outline-none"
        >
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
          <option value="ollama">Ollama</option>
          <option value="custom">Custom</option>
        </select>

        <label className="mb-1.5 block text-xs text-[#787774] uppercase tracking-wide font-medium">API Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-ant-..."
          className="mb-5 w-full rounded-[6px] border border-[#EAEAEA] bg-[#F7F6F3] px-3 py-2 text-sm text-[#2F3437] outline-none placeholder:text-[#787774]"
        />

        <label className="mb-1.5 block text-xs text-[#787774] uppercase tracking-wide font-medium">模型列表</label>
        <div className="mb-2 max-h-[160px] overflow-y-auto rounded-[6px] border border-[#EAEAEA] bg-[#F7F6F3]">
          {models.length === 0 && (
            <div className="px-3 py-2 text-xs text-[#787774]">暂无模型，请添加</div>
          )}
          {models.map((m) => (
            <div
              key={m}
              onClick={() => setDefaultModel(m)}
              className={`flex items-center justify-between px-3 py-1.5 cursor-pointer text-sm ${
                defaultModel === m
                  ? 'bg-[#111111] text-white'
                  : 'text-[#2F3437] hover:bg-[#EAEAEA]'
              }`}
            >
              <span className="truncate">{m}</span>
              <button
                onClick={(e) => { e.stopPropagation(); handleRemoveModel(m) }}
                className={`ml-2 text-xs ${defaultModel === m ? 'text-white/70 hover:text-white' : 'text-[#787774] hover:text-[#2F3437]'}`}
              >
                &times;
              </button>
            </div>
          ))}
        </div>
        <div className="mb-5 flex gap-2">
          <input
            type="text"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddModel() }}
            placeholder="输入模型 ID，如 claude-sonnet-4-20250514"
            className="flex-1 rounded-[6px] border border-[#EAEAEA] bg-[#F7F6F3] px-3 py-2 text-sm text-[#2F3437] outline-none placeholder:text-[#787774]"
          />
          <button
            onClick={handleAddModel}
            className="rounded-[6px] bg-[#111111] px-3 py-2 text-sm text-white hover:opacity-90 transition-opacity"
          >
            添加模型
          </button>
        </div>

        <label className="mb-1.5 block text-xs text-[#787774] uppercase tracking-wide font-medium">自定义 Base URL</label>
        <input
          type="text"
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          placeholder="https://api.example.com/v1"
          className="mb-6 w-full rounded-[6px] border border-[#EAEAEA] bg-[#F7F6F3] px-3 py-2 text-sm text-[#2F3437] outline-none placeholder:text-[#787774]"
        />

        <div className="flex justify-end gap-3">
          <button
            onClick={close}
            className="rounded-[6px] border border-[#EAEAEA] px-4 py-2 text-sm text-[#787774] hover:text-[#2F3437] transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="rounded-[6px] bg-[#111111] px-4 py-2 text-sm text-white hover:opacity-90 transition-opacity"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useSettingsStore } from '../stores/settings-store'

export function SettingsPanel() {
  const { isOpen, config, close, load, save } = useSettingsStore()
  const [provider, setProvider] = useState('anthropic')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('claude-sonnet-4-20250514')
  const [endpoint, setEndpoint] = useState('')

  useEffect(() => {
    if (isOpen) {
      load()
    }
  }, [isOpen, load])

  useEffect(() => {
    if (config) {
      setProvider(config.provider || 'anthropic')
      setApiKey(config.apiKey || '')
      setModel(config.model || 'claude-sonnet-4-20250514')
      setEndpoint(config.endpoint || '')
    }
  }, [config])

  if (!isOpen) return null

  const handleSave = () => {
    save({ provider, apiKey, model, endpoint })
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

        <label className="mb-1.5 block text-xs text-[#787774] uppercase tracking-wide font-medium">默认模型</label>
        <input
          type="text"
          list="model-suggestions"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="输入模型 ID 或从建议中选择"
          className="mb-5 w-full rounded-[6px] border border-[#EAEAEA] bg-[#F7F6F3] px-3 py-2 text-sm text-[#2F3437] outline-none placeholder:text-[#787774]"
        />
        <datalist id="model-suggestions">
          <option value="claude-opus-4-20250514">Claude Opus 4</option>
          <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
          <option value="claude-haiku-4-5-20251001">Claude Haiku 3.5</option>
          <option value="gpt-4o">GPT-4o</option>
          <option value="gpt-4o-mini">GPT-4o Mini</option>
          <option value="deepseek-chat">DeepSeek V3</option>
          <option value="qwen-max">Qwen Max</option>
        </datalist>

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

import { useEffect, useState } from 'react'
import { useSettingsStore } from '../stores/settings-store'

export function SettingsPanel() {
  const { isOpen, config, close, load, save } = useSettingsStore()
  const [provider, setProvider] = useState('anthropic')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('claude-sonnet-4-6')
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
      setModel(config.model || 'claude-sonnet-4-6')
      setEndpoint(config.endpoint || '')
    }
  }, [config])

  if (!isOpen) return null

  const handleSave = () => {
    save({ provider, apiKey, model, endpoint })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[420px] rounded-lg bg-zinc-800 p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold text-zinc-100">设置</h2>

        <label className="mb-1 block text-sm text-zinc-300">模型提供商</label>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="mb-4 w-full rounded bg-zinc-700 px-3 py-2 text-sm text-zinc-100 outline-none"
        >
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
          <option value="ollama">Ollama</option>
          <option value="custom">Custom</option>
        </select>

        <label className="mb-1 block text-sm text-zinc-300">Anthropic API Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-ant-..."
          className="mb-4 w-full rounded bg-zinc-700 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
        />

        <label className="mb-1 block text-sm text-zinc-300">默认模型</label>
        <input
          type="text"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="mb-4 w-full rounded bg-zinc-700 px-3 py-2 text-sm text-zinc-100 outline-none"
        />

        {provider === 'custom' && (
          <>
            <label className="mb-1 block text-sm text-zinc-300">自定义 Endpoint</label>
            <input
              type="text"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://..."
              className="mb-4 w-full rounded bg-zinc-700 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
            />
          </>
        )}

        <div className="mt-2 flex justify-end gap-3">
          <button
            onClick={close}
            className="rounded px-4 py-2 text-sm text-zinc-300 hover:text-zinc-100 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500 transition-colors"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}

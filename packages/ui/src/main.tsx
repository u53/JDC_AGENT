import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { useSettingsStore } from './stores/settings-store'
import './index.css'

useSettingsStore.getState().load()

const mql = window.matchMedia('(prefers-color-scheme: dark)')
mql.addEventListener('change', () => {
  const { theme } = useSettingsStore.getState()
  if (theme === 'system') {
    document.documentElement.dataset.theme = 'system'
  }
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

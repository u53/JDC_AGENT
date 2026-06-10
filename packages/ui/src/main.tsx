import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { applyTheme, useSettingsStore } from './stores/settings-store'
import './index.css'

applyTheme('system')
useSettingsStore.getState().load()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

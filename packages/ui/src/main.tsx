import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { useSettingsStore } from './stores/settings-store'
import './index.css'

document.documentElement.dataset.theme = 'dark'
useSettingsStore.getState().load()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

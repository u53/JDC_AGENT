# JDCAGNET UI Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform JDCAGNET from a CRT-terminal chat client into a professional AI workbench with light/dark/system theme support.

**Architecture:** Progressive replacement — each component replaced incrementally with build passing at every step. CSS variable-driven theming on `<html data-theme>`. Grid-based app shell with sidebar/main/inspector layout. Turn-based conversation model replacing message bubbles.

**Tech Stack:** React 19, Zustand 5, Tailwind CSS 4, Vite 6, Radix UI primitives (already installed), inline SVG icons.

---

## File Structure

### New Files
- `packages/ui/src/components/Topbar.tsx` — app-level top bar (drag, project name, theme, actions)
- `packages/ui/src/components/ThemeSegmented.tsx` — segmented control for theme switching
- `packages/ui/src/components/ProjectPage.tsx` — project overview when no session active
- `packages/ui/src/components/SessionHeader.tsx` — chat page top status bar
- `packages/ui/src/components/ConversationTurn.tsx` — turn container (user + assistant + tools)
- `packages/ui/src/components/Composer.tsx` — new input area with queue chip
- `packages/ui/src/components/Inspector.tsx` — right panel (rail + expanded)
- `packages/ui/src/components/SettingsOverlay.tsx` — unified tabbed settings
- `packages/ui/src/components/icons.tsx` — inline SVG icon components

### Modified Files
- `packages/ui/src/index.css` — complete rewrite: CSS tokens, theme system, typography
- `packages/ui/src/App.tsx` — grid shell layout, new component imports
- `packages/ui/src/stores/settings-store.ts` — add theme field, activeTab, setTheme
- `packages/ui/src/main.tsx` — apply theme on mount
- `packages/ui/src/components/Sidebar.tsx` — visual redo with tokens
- `packages/ui/src/components/ChatView.tsx` — restructure to header + timeline + composer
- `packages/ui/src/components/tool-cards/ToolCardShell.tsx` — visual redo
- `packages/ui/src/components/tool-cards/ReadToolCard.tsx` — new detail format + actions
- `packages/ui/src/components/tool-cards/BashToolCard.tsx` — new detail format + actions
- `packages/ui/src/components/tool-cards/EditToolCard.tsx` — new detail format + actions
- `packages/ui/src/components/tool-cards/WriteToolCard.tsx` — new detail format + actions
- `packages/ui/src/components/tool-cards/McpToolCard.tsx` — new detail format + actions
- `packages/ui/src/components/tool-cards/AgentToolCard.tsx` — new detail format + actions
- `packages/ui/src/components/tool-cards/SkillToolCard.tsx` — new detail format + actions
- `packages/ui/src/components/tool-cards/GenericToolCard.tsx` — structured summary
- `packages/ui/src/components/SlashCommandMenu.tsx` — command palette visual
- `packages/ui/src/components/ErrorCard.tsx` — left bar style, token colors
- `packages/ui/src/components/PermissionDialog.tsx` — left bar style, token colors
- `packages/ui/src/components/PlanReviewDialog.tsx` — left bar style, plan color
- `packages/ui/src/components/AskUserDialog.tsx` — new overlay card style
- `packages/ui/src/components/AskUserCard.tsx` — option rows, token colors
- `packages/ui/src/components/MarkdownRenderer.tsx` — prose styles for new theme

### Deleted Files (after replacements are in place)
- `packages/ui/src/components/SettingsPanel.tsx`
- `packages/ui/src/components/ModelManager.tsx`
- `packages/ui/src/components/McpSettings.tsx`
- `packages/ui/src/components/UsageHUD.tsx`
- `packages/ui/src/components/StatsCard.tsx`
- `packages/ui/src/components/MessageBubble.tsx`
- `packages/ui/src/components/QueueIndicator.tsx`
- `packages/ui/src/components/TaskPanel.tsx`
- `packages/ui/src/components/FileChangesPanel.tsx`
- `packages/ui/src/components/StatusBar.tsx`
- `packages/ui/src/components/ModelSwitcher.tsx`

---

## Task 1: Theme System & CSS Tokens

**Files:**
- Modify: `packages/ui/src/index.css` (complete rewrite)
- Modify: `packages/ui/src/stores/settings-store.ts`
- Modify: `packages/ui/src/main.tsx`
- Modify: `packages/ui/src/App.tsx` (minimal: remove hardcoded colors from root div)

- [ ] **Step 1: Rewrite index.css with theme tokens**

Replace the entire contents of `packages/ui/src/index.css` with:

```css
@import "tailwindcss";

:root {
  --bg: #f7f5ef;
  --surface: #ffffff;
  --surface-2: #fbfaf7;
  --surface-3: #f4f1ea;
  --text: #1e1d1a;
  --muted: #757069;
  --border: rgba(30, 29, 26, 0.10);
  --border-strong: rgba(30, 29, 26, 0.16);
  --accent: #1f1d1a;
  --accent-soft: #ece8dd;
  --accent-ink: #ffffff;
  --good: #7e9f7a;
  --warn: #a07c37;
  --bad: #a35b53;
  --plan: #8b7ec8;
  --shadow: 0 1px 0 rgba(30, 29, 26, 0.02);
  --shadow-soft: 0 8px 28px rgba(30, 29, 26, 0.05);
  --font-serif: "Iowan Old Style", "Baskerville", "Georgia", serif;
  --font-sans: "SF Pro Display", "Geist Sans", "Helvetica Neue", sans-serif;
  --font-mono: "Geist Mono", "SF Mono", "JetBrains Mono", monospace;
  color-scheme: light;
}

[data-theme="dark"] {
  --bg: #111215;
  --surface: #17191d;
  --surface-2: #1c1f24;
  --surface-3: #22252b;
  --text: #f4f0e8;
  --muted: #a3a095;
  --border: rgba(255, 255, 255, 0.08);
  --border-strong: rgba(255, 255, 255, 0.14);
  --accent: #f4f0e8;
  --accent-soft: #262931;
  --accent-ink: #111215;
  --good: #9bb693;
  --warn: #d0b57d;
  --bad: #d29b94;
  --plan: #a99be0;
  --shadow: 0 1px 0 rgba(0, 0, 0, 0.24);
  --shadow-soft: 0 12px 32px rgba(0, 0, 0, 0.25);
  color-scheme: dark;
}

[data-theme="system"] {
  color-scheme: light;
}

@media (prefers-color-scheme: dark) {
  [data-theme="system"] {
    --bg: #111215;
    --surface: #17191d;
    --surface-2: #1c1f24;
    --surface-3: #22252b;
    --text: #f4f0e8;
    --muted: #a3a095;
    --border: rgba(255, 255, 255, 0.08);
    --border-strong: rgba(255, 255, 255, 0.14);
    --accent: #f4f0e8;
    --accent-soft: #262931;
    --accent-ink: #111215;
    --good: #9bb693;
    --warn: #d0b57d;
    --bad: #d29b94;
    --plan: #a99be0;
    --shadow: 0 1px 0 rgba(0, 0, 0, 0.24);
    --shadow-soft: 0 12px 32px rgba(0, 0, 0, 0.25);
    color-scheme: dark;
  }
}

body {
  font-family: var(--font-sans);
  color: var(--text);
  background: var(--bg);
  -webkit-font-smoothing: antialiased;
  transition: background-color 180ms ease, color 180ms ease;
}

::selection {
  background: var(--accent);
  color: var(--accent-ink);
}

::-webkit-scrollbar {
  width: 6px;
}
::-webkit-scrollbar-track {
  background: var(--bg);
}
::-webkit-scrollbar-thumb {
  background: var(--border-strong);
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
  background: var(--muted);
}

.hljs { background: var(--surface-2) !important; color: var(--text) !important; }
.hljs-keyword { color: var(--good); }
.hljs-string { color: var(--warn); }
.hljs-comment { color: var(--muted); }
.hljs-number { color: var(--plan); }

.prose { color: var(--text); }
.prose strong { color: var(--text); }
.prose code { color: var(--text); background: var(--surface-2); padding: 0.1em 0.3em; border-radius: 4px; font-family: var(--font-mono); }
.prose pre { background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; }
.prose a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
.prose a:hover { opacity: 0.8; }
.prose h1, .prose h2, .prose h3, .prose h4 { color: var(--text); font-family: var(--font-serif); }
.prose blockquote { border-left: 2px solid var(--border-strong); color: var(--muted); }
.prose ul, .prose ol { color: var(--text); }
```

- [ ] **Step 2: Update settings-store with theme support**

Replace `packages/ui/src/stores/settings-store.ts`:

```typescript
import { create } from 'zustand'
import { ipc } from '../lib/ipc-client'

export type ThemeMode = 'light' | 'dark' | 'system'
export type SettingsTab = 'appearance' | 'models' | 'mcp' | 'shortcuts' | 'advanced'

interface SettingsState {
  config: any | null
  isOpen: boolean
  activeTab: SettingsTab
  theme: ThemeMode

  open: (tab?: SettingsTab) => void
  close: () => void
  setActiveTab: (tab: SettingsTab) => void
  setTheme: (theme: ThemeMode) => void
  load: () => Promise<void>
  save: (config: any) => Promise<void>
}

function applyTheme(theme: ThemeMode) {
  document.documentElement.dataset.theme = theme
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  config: null,
  isOpen: false,
  activeTab: 'appearance',
  theme: 'system',

  open: (tab) => set({ isOpen: true, activeTab: tab || get().activeTab }),
  close: () => set({ isOpen: false }),
  setActiveTab: (tab) => set({ activeTab: tab }),

  setTheme: (theme) => {
    applyTheme(theme)
    set({ theme })
    ipc.config.set({ theme } as any)
  },

  load: async () => {
    const config = await ipc.config.get()
    const theme = (config as any)?.theme || 'system'
    applyTheme(theme)
    set({ config, theme })
  },

  save: async (config: any) => {
    await ipc.config.set(config)
    set({ config, isOpen: false })
  },
}))
```

- [ ] **Step 3: Update main.tsx to load theme on startup**

Replace `packages/ui/src/main.tsx`:

```typescript
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
```

- [ ] **Step 4: Update App.tsx root div to use CSS variables**

In `packages/ui/src/App.tsx`, change the root div class from:
```tsx
<div className="flex h-screen w-screen bg-[#0A0A0A] text-[#EAEAEA]">
```
to:
```tsx
<div className="flex h-screen w-screen bg-[var(--bg)] text-[var(--text)]">
```

- [ ] **Step 5: Build and verify**

Run: `cd /Users/chenmingxu/Documents/jdcagnet && pnpm --filter @jdcagnet/ui build`
Expected: Build passes. The app now uses CSS variables but visually looks the same (defaults to light theme system mode).

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/index.css packages/ui/src/stores/settings-store.ts packages/ui/src/main.tsx packages/ui/src/App.tsx
git commit -m "feat(ui): add theme system with light/dark/system CSS tokens"
```

---

## Task 2: Icons Module

**Files:**
- Create: `packages/ui/src/components/icons.tsx`

- [ ] **Step 1: Create inline SVG icon components**

Create `packages/ui/src/components/icons.tsx`:

```tsx
interface IconProps {
  size?: number
  className?: string
}

export function IconTasks({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
    </svg>
  )
}

export function IconQueue({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 12h18M3 6h18M3 18h18" />
    </svg>
  )
}

export function IconUsage({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18 20V10M12 20V4M6 20v-6" />
    </svg>
  )
}

export function IconFiles({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  )
}

export function IconSession({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

export function IconSettings({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  )
}

export function IconPlus({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

export function IconX({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

export function IconChevronRight({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

export function IconChevronDown({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

export function IconSun({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  )
}

export function IconMoon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </svg>
  )
}

export function IconMonitor({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  )
}

export function IconStop({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="6" y="6" width="12" height="12" rx="1" />
    </svg>
  )
}

export function IconSend({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  )
}

export function IconCopy({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  )
}

export function IconPanelRight({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="15" y1="3" x2="15" y2="21" />
    </svg>
  )
}
```

- [ ] **Step 2: Build and verify**

Run: `cd /Users/chenmingxu/Documents/jdcagnet && pnpm --filter @jdcagnet/ui build`
Expected: Build passes (icons not yet imported anywhere, just available).

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/icons.tsx
git commit -m "feat(ui): add inline SVG icon components"
```

---

## Task 3: ThemeSegmented + Topbar

**Files:**
- Create: `packages/ui/src/components/ThemeSegmented.tsx`
- Create: `packages/ui/src/components/Topbar.tsx`

- [ ] **Step 1: Create ThemeSegmented component**

Create `packages/ui/src/components/ThemeSegmented.tsx`:

```tsx
import { useSettingsStore, type ThemeMode } from '../stores/settings-store'
import { IconSun, IconMoon, IconMonitor } from './icons'

const OPTIONS: { value: ThemeMode; label: string; Icon: typeof IconSun }[] = [
  { value: 'light', label: '白天', Icon: IconSun },
  { value: 'dark', label: '黑夜', Icon: IconMoon },
  { value: 'system', label: '跟随系统', Icon: IconMonitor },
]

export function ThemeSegmented() {
  const theme = useSettingsStore((s) => s.theme)
  const setTheme = useSettingsStore((s) => s.setTheme)

  return (
    <div className="inline-flex p-1 border border-[var(--border)] rounded-[10px] bg-[var(--surface)]" style={{ boxShadow: 'var(--shadow)' }}>
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          onClick={() => setTheme(value)}
          aria-pressed={theme === value}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[7px] text-[12px] transition-all duration-150 ${
            theme === value
              ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
              : 'text-[var(--muted)] hover:text-[var(--text)]'
          }`}
        >
          <Icon size={14} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Create Topbar component**

Create `packages/ui/src/components/Topbar.tsx`:

```tsx
import { useSessionStore } from '../stores/session-store'
import { useSettingsStore } from '../stores/settings-store'
import { ThemeSegmented } from './ThemeSegmented'
import { IconPlus, IconSettings } from './icons'

export function Topbar() {
  const projects = useSessionStore((s) => s.projects)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const addProject = useSessionStore((s) => s.addProject)
  const openSettings = useSettingsStore((s) => s.open)

  const activeProject = projects.find((p) =>
    p.sessions.some((s) => s.id === activeSessionId)
  )
  const projectName = activeProject?.name || projects[0]?.name || 'JDCAGNET'

  return (
    <header
      className="h-12 flex items-center justify-between px-5 border-b border-[var(--border)] bg-[var(--surface)]"
      style={{ WebkitAppRegion: 'drag' } as any}
    >
      <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' } as any}>
        <h1 className="text-[18px] font-medium tracking-[-0.03em]" style={{ fontFamily: 'var(--font-serif)' }}>
          {projectName}
        </h1>
      </div>

      <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' } as any}>
        <ThemeSegmented />
        <button
          onClick={addProject}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] border border-[var(--border)] rounded-[8px] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
          aria-label="New session"
        >
          <IconPlus size={14} />
          <span>New session</span>
        </button>
        <button
          onClick={() => openSettings()}
          className="p-2 rounded-[8px] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
          aria-label="Settings"
        >
          <IconSettings size={18} />
        </button>
      </div>
    </header>
  )
}
```

- [ ] **Step 3: Build and verify**

Run: `cd /Users/chenmingxu/Documents/jdcagnet && pnpm --filter @jdcagnet/ui build`
Expected: Build passes (components created but not yet wired into App.tsx).

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/ThemeSegmented.tsx packages/ui/src/components/Topbar.tsx
git commit -m "feat(ui): add Topbar and ThemeSegmented components"
```

---

## Task 4: Sidebar Visual Redo

**Files:**
- Modify: `packages/ui/src/components/Sidebar.tsx`

- [ ] **Step 1: Rewrite Sidebar with token-based styling**

Replace `packages/ui/src/components/Sidebar.tsx`:

```tsx
import { useEffect } from 'react'
import { useSessionStore } from '../stores/session-store'

export function Sidebar() {
  const { projects, activeSessionId, sessionStates, loadProjects, createSession, switchSession, addProject } =
    useSessionStore()

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  return (
    <aside className="w-[240px] border-r border-[var(--border)] bg-[var(--surface)] overflow-y-auto flex flex-col">
      <div className="h-[38px] flex-shrink-0" style={{ WebkitAppRegion: 'drag' } as any} />

      <div className="flex-1 px-3 pb-3 space-y-5">
        {projects.map((project) => (
          <div key={project.cwd}>
            <h3 className="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)] mb-2 px-2 font-medium" style={{ fontFamily: 'var(--font-sans)' }}>
              {project.name}
            </h3>
            <div className="space-y-0.5">
              {project.sessions.map((session) => {
                const state = sessionStates[session.id]
                const isBusy = state?.isStreaming
                const hasError = state?.error && !state.error.retrying
                const isFinished = state?.finished
                const isActive = activeSessionId === session.id

                return (
                  <button
                    key={session.id}
                    onClick={() => {
                      switchSession(session.id)
                      if (isFinished) useSessionStore.getState().dismissFinished(session.id)
                    }}
                    className={`w-full text-left px-2.5 py-2 text-[13px] truncate transition-colors flex items-center gap-2 rounded-[6px] ${
                      isActive
                        ? 'border-l-2 border-[var(--accent)] pl-2 bg-[var(--surface-2)] text-[var(--text)]'
                        : 'text-[var(--text)] hover:bg-[var(--surface-3)]'
                    }`}
                    style={{ fontFamily: 'var(--font-sans)' }}
                  >
                    {!isActive && isBusy && (
                      <span className="inline-block h-[6px] w-[6px] rounded-full bg-[var(--warn)] animate-pulse flex-shrink-0" />
                    )}
                    {!isActive && !isBusy && hasError && (
                      <span className="inline-block h-[6px] w-[6px] rounded-full bg-[var(--bad)] flex-shrink-0" />
                    )}
                    {!isActive && !isBusy && !hasError && isFinished && (
                      <span className="inline-block h-[6px] w-[6px] rounded-full bg-[var(--good)] flex-shrink-0" />
                    )}
                    <span className="block truncate">
                      {session.projectName || '新会话'}
                    </span>
                  </button>
                )
              })}
              <button
                onClick={() => createSession(project.cwd)}
                className="w-full text-left px-2.5 py-1.5 text-[12px] text-[var(--muted)] hover:text-[var(--text)] transition-colors rounded-[6px]"
              >
                + New session
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="px-3 pb-3 mt-auto">
        <button
          onClick={addProject}
          className="w-full border border-[var(--border)] text-[var(--text)] text-[12px] py-2.5 rounded-[8px] hover:bg-[var(--surface-2)] transition-colors"
        >
          + New project
        </button>
      </div>
    </aside>
  )
}
```

- [ ] **Step 2: Build and verify**

Run: `cd /Users/chenmingxu/Documents/jdcagnet && pnpm --filter @jdcagnet/ui build`
Expected: Build passes.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/Sidebar.tsx
git commit -m "feat(ui): restyle Sidebar with theme tokens"
```

---

## Task 5: App Shell Grid Layout

**Files:**
- Modify: `packages/ui/src/App.tsx`

- [ ] **Step 1: Rewrite App.tsx with grid layout and Topbar**

Replace `packages/ui/src/App.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react'
import { Topbar } from './components/Topbar'
import { Sidebar } from './components/Sidebar'
import { ChatView } from './components/ChatView'
import { UsageHUD } from './components/UsageHUD'
import { ModelManager } from './components/ModelManager'
import { McpSettings } from './components/McpSettings'
import { AskUserDialog } from './components/AskUserDialog'
import { useSessionStore } from './stores/session-store'
import { useModelStore } from './stores/model-store'
import { useSettingsStore } from './stores/settings-store'
import { useHotkeys } from './hooks/useHotkeys'

export function App() {
  const { activeSessionId, projects } = useSessionStore()
  const createSession = useSessionStore((s) => s.createSession)
  const deleteSession = useSessionStore((s) => s.deleteSession)
  const switchSession = useSessionStore((s) => s.switchSession)
  const loadModels = useModelStore((s) => s.loadFromConfig)
  const [mcpOpen, setMcpOpen] = useState(false)
  const settingsIsOpen = useSettingsStore((s) => s.isOpen)
  const openSettings = useSettingsStore((s) => s.open)
  const closeSettings = useSettingsStore((s) => s.close)

  useEffect(() => { loadModels() }, [loadModels])

  const allSessions = useMemo(
    () => projects.flatMap((p) => p.sessions),
    [projects]
  )

  const hotkeyMap = useMemo(() => {
    const map: Record<string, () => void> = {
      'escape': () => {
        if (activeSessionId) {
          window.electronAPI?.invoke('query:abort', { sessionId: activeSessionId })
        }
      },
      'mod+n': async () => {
        const path = await window.electronAPI?.invoke('dialog:open-folder')
        if (path && typeof path === 'string') {
          createSession(path)
        }
      },
      'mod+w': () => {
        if (activeSessionId) {
          deleteSession(activeSessionId)
        }
      },
      'mod+k': () => {
        if (activeSessionId) {
          window.electronAPI?.invoke('session:clear', { sessionId: activeSessionId })
        }
      },
      'mod+,': () => {
        if (settingsIsOpen) {
          closeSettings()
        } else {
          openSettings()
        }
      },
    }

    for (let i = 1; i <= 9; i++) {
      map[`mod+${i}`] = () => {
        const session = allSessions[i - 1]
        if (session) {
          switchSession(session.id)
        }
      }
    }

    return map
  }, [activeSessionId, allSessions, createSession, deleteSession, switchSession, settingsIsOpen, openSettings, closeSettings])

  useHotkeys(hotkeyMap)

  return (
    <div className="h-screen w-screen grid grid-rows-[48px_1fr] bg-[var(--bg)] text-[var(--text)]">
      <Topbar />
      <div className="grid grid-cols-[240px_1fr] overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden border-l border-[var(--border)]">
          {activeSessionId ? (
            <ChatView onOpenMcp={() => setMcpOpen(true)} />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <p className="text-[14px] text-[var(--muted)]">选择项目或新建会话</p>
              </div>
            </div>
          )}
          <UsageHUD onOpenMcp={() => setMcpOpen(true)} onOpenSettings={() => openSettings()} />
        </div>
      </div>
      <ModelManager />
      <McpSettings isOpen={mcpOpen} onClose={() => setMcpOpen(false)} />
      <AskUserDialog />
    </div>
  )
}
```

Note: This is a transitional state. `UsageHUD`, `ModelManager`, `McpSettings` are still imported but will be replaced in later tasks. The grid layout is in place, Topbar is wired in, and the empty state text is updated.

- [ ] **Step 2: Build and verify**

Run: `cd /Users/chenmingxu/Documents/jdcagnet && pnpm --filter @jdcagnet/ui build`
Expected: Build passes. App now has Topbar + grid layout with sidebar and main area.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/App.tsx
git commit -m "feat(ui): wire Topbar into grid-based App shell"
```

---

## Task 6: Project Page

**Files:**
- Create: `packages/ui/src/components/ProjectPage.tsx`
- Modify: `packages/ui/src/App.tsx` (swap empty state for ProjectPage)

- [ ] **Step 1: Create ProjectPage component**

Create `packages/ui/src/components/ProjectPage.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { useSessionStore } from '../stores/session-store'
import { useModelStore } from '../stores/model-store'
import type { McpServerState } from '../lib/ipc-client'

function formatTokens(tokens: number): string {
  if (tokens === 0) return '0'
  if (tokens < 1000) return String(tokens)
  if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}k`
  return `${(tokens / 1000000).toFixed(2)}M`
}

export function ProjectPage() {
  const projects = useSessionStore((s) => s.projects)
  const sessionStates = useSessionStore((s) => s.sessionStates)
  const switchSession = useSessionStore((s) => s.switchSession)
  const tasks = useSessionStore((s) => s.tasks)
  const addProject = useSessionStore((s) => s.addProject)
  const activeModelId = useModelStore((s) => s.activeModelId)
  const groups = useModelStore((s) => s.groups)
  const [mcpServers, setMcpServers] = useState<McpServerState[]>([])

  useEffect(() => {
    window.electronAPI?.mcpListServers().then((s) => { if (s) setMcpServers(s) })
    window.electronAPI?.onMcpStateChanged((s) => setMcpServers(s))
  }, [])

  const modelName = (() => {
    if (!activeModelId) return null
    for (const g of groups) {
      const m = g.models.find((m) => m.id === activeModelId)
      if (m) return m.name
    }
    return null
  })()

  const allSessions = projects.flatMap((p) => p.sessions)
  const currentProject = projects[0]

  const latestUsage = (() => {
    for (const s of allSessions) {
      const state = sessionStates[s.id]
      if (state?.usage) return state.usage
    }
    return null
  })()

  const connectedMcp = mcpServers.filter((s) => s.status === 'connected').length
  const totalMcp = mcpServers.length

  const activeTasks = tasks.filter((t) => t.status !== 'completed')

  if (projects.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-[14px] text-[var(--muted)]">添加项目开始使用</p>
          <button
            onClick={addProject}
            className="px-4 py-2.5 text-[13px] rounded-[8px] bg-[var(--accent)] text-[var(--accent-ink)] hover:opacity-90 transition-opacity"
          >
            New project
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-[900px] mx-auto space-y-4">
        {/* Project Info Card */}
        <div className="border border-[var(--border)] rounded-[12px] bg-[var(--surface)] p-5" style={{ boxShadow: 'var(--shadow)' }}>
          <h2 className="text-[12px] uppercase tracking-[0.12em] text-[var(--muted)] font-medium mb-3">Project</h2>
          <div className="space-y-1">
            <p className="text-[18px] font-medium text-[var(--text)]" style={{ fontFamily: 'var(--font-serif)' }}>
              {currentProject?.name || 'Untitled'}
            </p>
            <p className="text-[12px] text-[var(--muted)]" style={{ fontFamily: 'var(--font-mono)' }}>
              {currentProject?.cwd}
            </p>
            <div className="flex items-center gap-4 mt-2 text-[13px]">
              {modelName && <span className="text-[var(--text)]">{modelName}</span>}
              <span className="text-[var(--muted)]">{allSessions.length} sessions</span>
            </div>
          </div>
        </div>

        {/* Grid cards */}
        <div className="grid grid-cols-2 gap-4">
          {/* Recent Sessions */}
          <div className="border border-[var(--border)] rounded-[12px] bg-[var(--surface)] p-5" style={{ boxShadow: 'var(--shadow)' }}>
            <h2 className="text-[12px] uppercase tracking-[0.12em] text-[var(--muted)] font-medium mb-3">Recent Sessions</h2>
            <div className="space-y-1.5">
              {allSessions.slice(0, 5).map((session) => {
                const state = sessionStates[session.id]
                return (
                  <button
                    key={session.id}
                    onClick={() => switchSession(session.id)}
                    className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-[6px] hover:bg-[var(--surface-2)] transition-colors"
                  >
                    <span className={`inline-block h-[6px] w-[6px] rounded-full flex-shrink-0 ${
                      state?.isStreaming ? 'bg-[var(--warn)] animate-pulse' :
                      state?.error ? 'bg-[var(--bad)]' :
                      state?.finished ? 'bg-[var(--good)]' : 'bg-[var(--border-strong)]'
                    }`} />
                    <span className="text-[13px] text-[var(--text)] truncate">{session.projectName || '新会话'}</span>
                  </button>
                )
              })}
              {allSessions.length === 0 && (
                <p className="text-[13px] text-[var(--muted)]">暂无会话</p>
              )}
            </div>
          </div>

          {/* MCP Health */}
          <div className="border border-[var(--border)] rounded-[12px] bg-[var(--surface)] p-5" style={{ boxShadow: 'var(--shadow)' }}>
            <h2 className="text-[12px] uppercase tracking-[0.12em] text-[var(--muted)] font-medium mb-3">MCP Servers</h2>
            {totalMcp > 0 ? (
              <div className="space-y-1.5">
                <p className="text-[14px] text-[var(--text)]">
                  <span className={connectedMcp === totalMcp ? 'text-[var(--good)]' : 'text-[var(--warn)]'}>
                    {connectedMcp}/{totalMcp}
                  </span>
                  {' '}connected
                </p>
                {mcpServers.slice(0, 4).map((s) => (
                  <div key={s.name} className="flex items-center gap-2 text-[12px]">
                    <span className={`inline-block h-[5px] w-[5px] rounded-full ${
                      s.status === 'connected' ? 'bg-[var(--good)]' :
                      s.status === 'failed' ? 'bg-[var(--bad)]' : 'bg-[var(--muted)]'
                    }`} />
                    <span className="text-[var(--text)]">{s.name}</span>
                    <span className="text-[var(--muted)]">{s.tools.length} tools</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-[var(--muted)]">未配置 MCP 服务器</p>
            )}
          </div>

          {/* Usage Summary */}
          <div className="border border-[var(--border)] rounded-[12px] bg-[var(--surface)] p-5" style={{ boxShadow: 'var(--shadow)' }}>
            <h2 className="text-[12px] uppercase tracking-[0.12em] text-[var(--muted)] font-medium mb-3">Usage</h2>
            {latestUsage ? (
              <div className="space-y-2 text-[13px]">
                <div className="flex justify-between">
                  <span className="text-[var(--muted)]">Tokens</span>
                  <span className="text-[var(--text)]">{formatTokens(latestUsage.totalTokens)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--muted)]">Cache hit</span>
                  <span className="text-[var(--text)]">{latestUsage.cacheHitRate}%</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[var(--muted)]">Context</span>
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1 rounded-full bg-[var(--surface-3)] overflow-hidden">
                      <div
                        className={`h-full rounded-full ${latestUsage.contextUsedPercent > 80 ? 'bg-[var(--bad)]' : 'bg-[var(--accent)]'}`}
                        style={{ width: `${latestUsage.contextUsedPercent}%` }}
                      />
                    </div>
                    <span className={latestUsage.contextUsedPercent > 80 ? 'text-[var(--bad)]' : 'text-[var(--text)]'}>
                      {latestUsage.contextUsedPercent}%
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-[13px] text-[var(--muted)]">暂无数据</p>
            )}
          </div>

          {/* Tasks Summary */}
          <div className="border border-[var(--border)] rounded-[12px] bg-[var(--surface)] p-5" style={{ boxShadow: 'var(--shadow)' }}>
            <h2 className="text-[12px] uppercase tracking-[0.12em] text-[var(--muted)] font-medium mb-3">Tasks</h2>
            {activeTasks.length > 0 ? (
              <div className="space-y-1.5">
                {activeTasks.slice(0, 5).map((task) => (
                  <div key={task.id} className="flex items-center gap-2 text-[12px]">
                    <span className={task.status === 'in_progress' ? 'text-[var(--good)] animate-pulse' : 'text-[var(--muted)]'}>
                      {task.status === 'in_progress' ? '●' : '○'}
                    </span>
                    <span className="text-[var(--text)] truncate">{task.subject}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-[var(--muted)]">暂无任务</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire ProjectPage into App.tsx**

In `packages/ui/src/App.tsx`, add the import at the top:
```tsx
import { ProjectPage } from './components/ProjectPage'
```

Replace the empty state block:
```tsx
) : (
  <div className="flex-1 flex items-center justify-center">
    <div className="text-center">
      <p className="text-[14px] text-[var(--muted)]">选择项目或新建会话</p>
    </div>
  </div>
)}
```
with:
```tsx
) : (
  <ProjectPage />
)}
```

- [ ] **Step 3: Build and verify**

Run: `cd /Users/chenmingxu/Documents/jdcagnet && pnpm --filter @jdcagnet/ui build`
Expected: Build passes.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/ProjectPage.tsx packages/ui/src/App.tsx
git commit -m "feat(ui): add ProjectPage with overview cards"
```

---

## Task 7: SessionHeader + ConversationTurn

**Files:**
- Create: `packages/ui/src/components/SessionHeader.tsx`
- Create: `packages/ui/src/components/ConversationTurn.tsx`

- [ ] **Step 1: Create SessionHeader**

Create `packages/ui/src/components/SessionHeader.tsx`:

```tsx
import { useSessionStore } from '../stores/session-store'
import { useModelStore } from '../stores/model-store'

interface Props {
  permissionMode: string
  thinkingEnabled: boolean
  planMode: boolean
}

export function SessionHeader({ permissionMode, thinkingEnabled, planMode }: Props) {
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const projects = useSessionStore((s) => s.projects)
  const sessionStates = useSessionStore((s) => s.sessionStates)
  const messageQueue = useSessionStore((s) => s.messageQueue)
  const activeModelId = useModelStore((s) => s.activeModelId)
  const groups = useModelStore((s) => s.groups)

  const usage = activeSessionId ? sessionStates[activeSessionId]?.usage : undefined
  const isStreaming = activeSessionId ? sessionStates[activeSessionId]?.isStreaming : false

  const activeProject = projects.find((p) =>
    p.sessions.some((s) => s.id === activeSessionId)
  )

  const modelName = (() => {
    if (!activeModelId) return null
    for (const g of groups) {
      const m = g.models.find((m) => m.id === activeModelId)
      if (m) return m.name
    }
    return null
  })()

  const permLabel = permissionMode === 'strict' ? '严格' : permissionMode === 'relaxed' ? '完全访问' : '标准'

  return (
    <div className="h-10 flex items-center justify-between px-5 border-b border-[var(--border)] bg-[var(--surface)] flex-shrink-0">
      <div className="flex items-center gap-3 text-[12px]">
        <span className="text-[var(--muted)]">{activeProject?.name}</span>
        <span className="text-[var(--border-strong)]">/</span>
        <span className="text-[var(--text)]" style={{ fontFamily: 'var(--font-mono)' }}>
          {activeSessionId?.slice(0, 8)}
        </span>
      </div>

      <div className="flex items-center gap-3 text-[12px]">
        {modelName && (
          <span className="px-2 py-0.5 rounded-[5px] bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)]">
            {modelName}
          </span>
        )}
        <span className="text-[var(--muted)]">{permLabel}</span>
        {thinkingEnabled && <span className="flex items-center gap-1 text-[var(--good)]"><span className="inline-block h-[5px] w-[5px] rounded-full bg-[var(--good)]" />推理</span>}
        {planMode && <span className="flex items-center gap-1 text-[var(--plan)]"><span className="inline-block h-[5px] w-[5px] rounded-full bg-[var(--plan)]" />规划</span>}
        {isStreaming && <span className="inline-block h-[5px] w-[5px] rounded-full bg-[var(--warn)] animate-pulse" />}
        {messageQueue.length > 0 && (
          <span className="px-1.5 py-0.5 rounded-[4px] bg-[var(--accent-soft)] text-[var(--text)] text-[11px]">
            {messageQueue.length}
          </span>
        )}
        {usage && (
          <div className="flex items-center gap-1.5">
            <div className="w-12 h-1 rounded-full bg-[var(--surface-3)] overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${usage.contextUsedPercent > 80 ? 'bg-[var(--bad)]' : 'bg-[var(--accent)]'}`}
                style={{ width: `${usage.contextUsedPercent}%` }}
              />
            </div>
            <span className={`text-[11px] ${usage.contextUsedPercent > 80 ? 'text-[var(--bad)]' : 'text-[var(--muted)]'}`}>
              {usage.contextUsedPercent}%
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create ConversationTurn**

Create `packages/ui/src/components/ConversationTurn.tsx`:

```tsx
import { MarkdownRenderer } from './MarkdownRenderer'
import { ToolCardRouter } from './tool-cards'
import type { ContentBlock, Message } from '@jdcagnet/core'

interface Props {
  userContent: ContentBlock[]
  assistantContent: ContentBlock[]
  nextMessage?: Message
  isActive?: boolean
  streamingText?: string
  thinkingText?: string
  isThinking?: boolean
}

export function ConversationTurn({ userContent, assistantContent, nextMessage, isActive, streamingText, thinkingText, isThinking }: Props) {
  const findToolResult = (toolUseId: string) => {
    if (!nextMessage || nextMessage.role !== 'user') return undefined
    const block = nextMessage.content.find(
      (b: any) => b.type === 'tool_result' && b.tool_use_id === toolUseId
    ) as any
    if (!block) return undefined
    return { content: block.content, is_error: block.is_error }
  }

  const userTextBlocks = userContent.filter((b) => b.type === 'text' || b.type === 'image')
  const assistantTextBlocks = assistantContent.filter((b) => b.type === 'text')
  const toolUseBlocks = assistantContent.filter((b) => b.type === 'tool_use')

  return (
    <div className="py-5 border-b border-[var(--border)]">
      {/* User input */}
      {userTextBlocks.length > 0 && (
        <div className="border-l-2 border-[var(--accent)] pl-4 mb-4">
          {userTextBlocks.map((block, i) => {
            if (block.type === 'text') {
              return <p key={i} className="text-[14px] text-[var(--text)] whitespace-pre-wrap">{block.text}</p>
            }
            if (block.type === 'image') {
              return (
                <img
                  key={i}
                  src={`data:${block.source.media_type};base64,${block.source.data}`}
                  className="max-w-sm max-h-64 border border-[var(--border)] rounded-[8px] my-2"
                  alt="Attached image"
                />
              )
            }
            return null
          })}
        </div>
      )}

      {/* Assistant response */}
      <div className="pl-4">
        {/* Thinking indicator */}
        {isActive && isThinking && (
          <div className="flex items-center gap-2 mb-3 text-[12px] text-[var(--muted)]">
            <span className="inline-block h-[5px] w-[5px] rounded-full bg-[var(--plan)] animate-pulse" />
            <span>Thinking... ({thinkingText?.length || 0} chars)</span>
          </div>
        )}

        {/* Tool calls */}
        {toolUseBlocks.map((block, i) => {
          if (block.type === 'tool_use') {
            return (
              <div key={i} className="mb-2">
                <ToolCardRouter
                  name={block.name}
                  input={block.input}
                  result={findToolResult(block.id)}
                />
              </div>
            )
          }
          return null
        })}

        {/* Streaming text (active turn) */}
        {isActive && streamingText && (
          <div className="prose prose-sm max-w-none mb-3">
            <MarkdownRenderer content={streamingText} />
            <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-[var(--accent)]" />
          </div>
        )}

        {/* Completed assistant text */}
        {!isActive && assistantTextBlocks.map((block, i) => {
          if (block.type === 'text') {
            if (block.text.startsWith('__STATS__')) return null
            return (
              <div key={i} className="prose prose-sm max-w-none">
                <MarkdownRenderer content={block.text} />
              </div>
            )
          }
          return null
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Build and verify**

Run: `cd /Users/chenmingxu/Documents/jdcagnet && pnpm --filter @jdcagnet/ui build`
Expected: Build passes (components created but not yet wired into ChatView).

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/SessionHeader.tsx packages/ui/src/components/ConversationTurn.tsx
git commit -m "feat(ui): add SessionHeader and ConversationTurn components"
```

---

## Task 8: Composer

**Files:**
- Create: `packages/ui/src/components/Composer.tsx`

- [ ] **Step 1: Create Composer component**

Create `packages/ui/src/components/Composer.tsx`:

```tsx
import { useState, useRef, useCallback, type KeyboardEvent, type ClipboardEvent, type DragEvent } from 'react'
import { ImagePreview } from './ImagePreview'
import { SlashCommandMenu, type SlashCommand } from './SlashCommandMenu'
import { useSessionStore } from '../stores/session-store'
import { IconSend, IconStop } from './icons'

interface Props {
  onSend: (text: string, images?: { data: string; mediaType: string }[]) => void
  onAbort: () => void
  isStreaming: boolean
  onSlashCommand?: (command: string) => void
  permissionMode?: string
  onPermissionChange?: (mode: string) => void
  thinkingEnabled?: boolean
  onThinkingToggle?: () => void
  planMode?: boolean
  onPlanToggle?: () => void
  modelName?: string
  modelId?: string
  models?: { id: string; name: string; groupName: string }[]
  onModelChange?: (modelId: string) => void
  onModelClick?: () => void
  skills?: { name: string; description: string }[]
}

export function Composer({ onSend, onAbort, isStreaming, onSlashCommand, permissionMode = 'standard', onPermissionChange, thinkingEnabled, onThinkingToggle, planMode, onPlanToggle, modelName, modelId, models, onModelChange, onModelClick, skills }: Props) {
  const [text, setText] = useState('')
  const [images, setImages] = useState<{ data: string; mediaType: string }[]>([])
  const [showSlashMenu, setShowSlashMenu] = useState(false)
  const [slashFilter, setSlashFilter] = useState('')
  const [showPermMenu, setShowPermMenu] = useState(false)
  const [showModelMenu, setShowModelMenu] = useState(false)
  const [queueExpanded, setQueueExpanded] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isComposingRef = useRef(false)

  const queue = useSessionStore((s) => s.messageQueue)
  const enqueueMessage = useSessionStore((s) => s.enqueueMessage)
  const removeFromQueue = useSessionStore((s) => s.removeFromQueue)

  const addImageFile = useCallback((file: File) => {
    const validTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
    if (!validTypes.includes(file.type)) return
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1]
      if (base64) setImages((prev) => [...prev, { data: base64, mediaType: file.type }])
    }
    reader.readAsDataURL(file)
  }, [])

  const handlePaste = useCallback((e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) addImageFile(file)
        return
      }
    }
  }, [addImageFile])

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    for (const file of e.dataTransfer?.files || []) {
      if (file.type.startsWith('image/')) addImageFile(file)
    }
  }, [addImageFile])

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => { e.preventDefault() }, [])

  const handleTextChange = (value: string) => {
    setText(value)
    if (value === '/') {
      setShowSlashMenu(true)
      setSlashFilter('')
    } else if (value.startsWith('/') && !value.includes(' ')) {
      setShowSlashMenu(true)
      setSlashFilter(value.slice(1))
    } else {
      setShowSlashMenu(false)
    }
  }

  const handleSlashSelect = (cmd: SlashCommand) => {
    setShowSlashMenu(false)
    if (cmd.section === 'skill') {
      setText(`/${cmd.name} `)
      textareaRef.current?.focus()
    } else {
      setText('')
      onSlashCommand?.(`/${cmd.name}`)
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isComposingRef.current) return
    if (showSlashMenu && ['ArrowDown', 'ArrowUp', 'Tab', 'Enter'].includes(e.key)) return
    if (e.key === 'Escape' && showSlashMenu) { setShowSlashMenu(false); return }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (text.startsWith('/') && !text.includes(' ')) {
        onSlashCommand?.(text)
        setText('')
        setShowSlashMenu(false)
        return
      }
      if (text.trim() || images.length > 0) {
        if (isStreaming) {
          enqueueMessage(text.trim())
          setText('')
          setImages([])
        } else {
          onSend(text.trim(), images.length > 0 ? images : undefined)
          setText('')
          setImages([])
        }
        if (textareaRef.current) textareaRef.current.style.height = 'auto'
      }
    }
  }

  const handleInput = () => {
    const el = textareaRef.current
    if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px` }
  }

  const permLabel = permissionMode === 'strict' ? '严格' : permissionMode === 'relaxed' ? '完全访问' : '标准'
  const permColor = permissionMode === 'relaxed' ? 'text-[var(--warn)]' : permissionMode === 'strict' ? 'text-[var(--bad)]' : 'text-[var(--good)]'

  return (
    <div className="border-t border-[var(--border)] bg-[var(--surface)] px-6 py-3" onDrop={handleDrop} onDragOver={handleDragOver}>
      {/* Queue chip */}
      {queue.length > 0 && (
        <div className="mx-auto max-w-[760px] mb-2">
          <button
            onClick={() => setQueueExpanded(!queueExpanded)}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-[8px] bg-[var(--surface-3)] text-[12px] text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
          >
            <span className="inline-block h-[5px] w-[5px] rounded-full bg-[var(--warn)]" />
            <span>Queue: {queue.length} message{queue.length > 1 ? 's' : ''}</span>
          </button>
          {queueExpanded && (
            <div className="mt-1.5 border border-[var(--border)] rounded-[8px] bg-[var(--surface)] p-2 space-y-1">
              {queue.map((msg, i) => (
                <div key={i} className="flex items-center gap-2 px-2 py-1 rounded-[4px] hover:bg-[var(--surface-2)]">
                  <span className="text-[12px] text-[var(--text)] truncate flex-1">{msg.length > 60 ? msg.slice(0, 60) + '...' : msg}</span>
                  <button onClick={() => removeFromQueue(i)} className="text-[var(--muted)] hover:text-[var(--bad)] transition-colors">
                    <span className="text-[11px]">×</span>
                  </button>
                </div>
              ))}
              <button
                onClick={() => { useSessionStore.setState({ messageQueue: [] }); setQueueExpanded(false) }}
                className="text-[11px] text-[var(--muted)] hover:text-[var(--bad)] transition-colors px-2"
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      )}

      <ImagePreview images={images} onRemove={(i) => setImages((prev) => prev.filter((_, idx) => idx !== i))} />
      <div className="mx-auto max-w-[760px]">
        <div className="relative mb-2">
          <SlashCommandMenu filter={slashFilter} visible={showSlashMenu} onSelect={handleSlashSelect} onClose={() => setShowSlashMenu(false)} skills={skills} />
          <div className="flex items-end gap-3">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => { handleTextChange(e.target.value); handleInput() }}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => { isComposingRef.current = true }}
              onCompositionEnd={() => { isComposingRef.current = false }}
              onPaste={handlePaste}
              rows={1}
              placeholder="输入消息... (/ 打开命令)"
              className="flex-1 resize-none bg-[var(--surface-2)] border border-[var(--border)] rounded-[10px] px-4 py-3 text-[14px] text-[var(--text)] placeholder-[var(--muted)] focus:border-[var(--border-strong)] focus:outline-none transition-colors"
              style={{ fontFamily: 'var(--font-sans)' }}
            />
            {isStreaming ? (
              <div className="flex items-center gap-2">
                {text.trim() && (
                  <button
                    onClick={() => { enqueueMessage(text.trim()); setText(''); setImages([]) }}
                    className="px-4 py-2.5 text-[12px] rounded-[8px] bg-[var(--accent)] text-[var(--accent-ink)] hover:opacity-90 transition-opacity"
                  >
                    Queue
                  </button>
                )}
                <button
                  onClick={onAbort}
                  className="p-2.5 rounded-[8px] border border-[var(--bad)] text-[var(--bad)] hover:bg-[var(--bad)] hover:text-[var(--accent-ink)] transition-colors"
                  aria-label="Stop"
                >
                  <IconStop size={16} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => { if (text.trim() || images.length > 0) { onSend(text.trim(), images.length > 0 ? images : undefined); setText(''); setImages([]) } }}
                className="p-2.5 rounded-[8px] bg-[var(--accent)] text-[var(--accent-ink)] hover:opacity-90 transition-opacity disabled:opacity-40"
                disabled={!text.trim() && images.length === 0}
                aria-label="Send"
              >
                <IconSend size={16} />
              </button>
            )}
          </div>
        </div>
        {/* Status bar */}
        <div className="flex items-center justify-between text-[12px]">
          <div className="flex items-center gap-3">
            <div className="relative">
              <button onClick={() => setShowPermMenu(!showPermMenu)} className={`${permColor} hover:opacity-80 transition-opacity`}>{permLabel}</button>
              {showPermMenu && (
                <div className="absolute bottom-full left-0 mb-1 border border-[var(--border)] bg-[var(--surface)] rounded-[8px] z-50 min-w-[120px] overflow-hidden" style={{ boxShadow: 'var(--shadow-soft)' }}>
                  {(['relaxed', 'standard', 'strict'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => { onPermissionChange?.(mode); setShowPermMenu(false) }}
                      className={`block w-full text-left px-3 py-2 text-[12px] hover:bg-[var(--surface-2)] transition-colors ${permissionMode === mode ? 'text-[var(--accent)]' : 'text-[var(--text)]'}`}
                    >
                      {mode === 'relaxed' ? '完全访问' : mode === 'strict' ? '严格模式' : '标准模式'}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={onThinkingToggle}
              className={`flex items-center gap-1 transition-colors ${thinkingEnabled ? 'text-[var(--good)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}
            >
              <span className={`inline-block h-[5px] w-[5px] rounded-full ${thinkingEnabled ? 'bg-[var(--good)]' : 'bg-[var(--muted)]'}`} />
              推理
            </button>
            <button
              onClick={onPlanToggle}
              className={`flex items-center gap-1 transition-colors ${planMode ? 'text-[var(--plan)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}
            >
              <span className={`inline-block h-[5px] w-[5px] rounded-full ${planMode ? 'bg-[var(--plan)]' : 'bg-[var(--muted)]'}`} />
              规划
            </button>
          </div>
          <div className="relative">
            <button onClick={() => { if (models && models.length > 0) setShowModelMenu(!showModelMenu); else onModelClick?.() }} className="text-[var(--text)] hover:text-[var(--accent)] transition-colors">
              {modelName || 'No model'}
            </button>
            {showModelMenu && models && models.length > 0 && (
              <div className="absolute bottom-full right-0 mb-1 border border-[var(--border)] bg-[var(--surface)] rounded-[8px] z-50 min-w-[200px] max-h-[240px] overflow-y-auto" style={{ boxShadow: 'var(--shadow-soft)' }}>
                {models.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => { onModelChange?.(m.id); setShowModelMenu(false) }}
                    className={`block w-full text-left px-3 py-2 hover:bg-[var(--surface-2)] transition-colors ${m.id === modelId ? 'text-[var(--accent)]' : 'text-[var(--text)]'}`}
                  >
                    <span className="text-[12px]">{m.name}</span>
                    <span className="text-[11px] text-[var(--muted)] ml-2">{m.groupName}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Build and verify**

Run: `cd /Users/chenmingxu/Documents/jdcagnet && pnpm --filter @jdcagnet/ui build`
Expected: Build passes.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/Composer.tsx
git commit -m "feat(ui): add Composer with queue chip and token styling"
```

---

## Task 9: ChatView Restructure

**Files:**
- Modify: `packages/ui/src/components/ChatView.tsx` (major rewrite using SessionHeader, ConversationTurn, Composer)

- [ ] **Step 1: Rewrite ChatView to use new components**

Replace `packages/ui/src/components/ChatView.tsx` with a restructured version that:
1. Uses `SessionHeader` at the top
2. Renders messages as `ConversationTurn` pairs (user + assistant grouped)
3. Shows streaming tool events in the active turn
4. Uses `Composer` instead of `PromptInput`
5. Keeps `PermissionDialog`, `PlanReviewDialog`, `HelpDialog`, `AgentDetailPanel` in place
6. Removes inline `FileChangesPanel`, `TaskPanel`, `QueueIndicator` (moved to Inspector later)

Key changes in the rewrite:
- Group messages into turns: iterate messages, pair each user message with the following assistant message
- Active turn (streaming): render tool events + streaming text inside the last turn
- Error/Permission/PlanReview: render after the active turn's tool events
- Remove `UsageHUD` reference (it's still in App.tsx temporarily)
- Remove `StatsCard` rendering from message content (stats messages are filtered out)

The full component is large. The implementation should:
- Import `SessionHeader`, `ConversationTurn`, `Composer` instead of `PromptInput`
- Keep all existing state management (permissionMode, thinkingEnabled, planMode, skills, toast, etc.)
- Keep `useSession` hook and `useAgentEvents` hook
- Keep slash command handling logic
- Replace the message rendering loop with turn-based grouping

- [ ] **Step 2: Build and verify**

Run: `cd /Users/chenmingxu/Documents/jdcagnet && pnpm --filter @jdcagnet/ui build`
Expected: Build passes. Chat page now shows turns with SessionHeader and Composer.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/ChatView.tsx
git commit -m "feat(ui): restructure ChatView with turns, SessionHeader, Composer"
```

---

## Task 10: ToolCardShell Visual Redo

**Files:**
- Modify: `packages/ui/src/components/tool-cards/ToolCardShell.tsx`

- [ ] **Step 1: Rewrite ToolCardShell with token-based styling**

Replace `packages/ui/src/components/tool-cards/ToolCardShell.tsx`:

```tsx
import { useState, type ReactNode } from 'react'
import { IconChevronRight, IconChevronDown } from '../icons'

interface Props {
  label: string
  detail: string
  status: 'running' | 'done' | 'error'
  defaultExpanded?: boolean
  collapsible?: boolean
  children?: ReactNode
  actions?: ReactNode
}

const statusConfig = {
  running: { dot: 'bg-[var(--warn)] animate-pulse' },
  done: { dot: 'bg-[var(--muted)]' },
  error: { dot: 'bg-[var(--bad)]' },
}

export function ToolCardShell({
  label,
  detail,
  status,
  defaultExpanded = false,
  collapsible = true,
  children,
  actions,
}: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const cfg = statusConfig[status]
  const hasContent = !!children
  const canToggle = collapsible && hasContent && status !== 'running'

  return (
    <div className={`mb-2 border rounded-[8px] bg-[var(--surface-2)] ${status === 'error' ? 'border-[var(--bad)]' : 'border-[var(--border)]'}`}>
      <div
        className={`flex items-center gap-2 px-3 py-2 min-h-[36px] ${canToggle ? 'cursor-pointer hover:bg-[var(--surface-3)]' : ''} transition-colors rounded-t-[8px]`}
        onClick={() => { if (canToggle) setExpanded(!expanded) }}
      >
        <span className={`inline-block h-[6px] w-[6px] rounded-full flex-shrink-0 ${cfg.dot}`} />
        {canToggle && (expanded ? <IconChevronDown size={12} className="text-[var(--muted)]" /> : <IconChevronRight size={12} className="text-[var(--muted)]" />)}
        <span className="text-[12px] font-medium text-[var(--text)]">{label}</span>
        <span className="text-[12px] text-[var(--muted)] truncate flex-1 text-left" style={{ fontFamily: 'var(--font-mono)' }}>{detail}</span>
        {actions && <div className="flex items-center gap-1 flex-shrink-0">{actions}</div>}
      </div>
      {(expanded || (status === 'running' && hasContent)) && hasContent && (
        <div className="border-t border-[var(--border)] px-3 py-2">
          {children}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Build and verify**

Run: `cd /Users/chenmingxu/Documents/jdcagnet && pnpm --filter @jdcagnet/ui build`
Expected: Build passes.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/tool-cards/ToolCardShell.tsx
git commit -m "feat(ui): restyle ToolCardShell with theme tokens"
```

---

## Task 11: Tool Card Types Redo

**Files:**
- Modify: `packages/ui/src/components/tool-cards/ReadToolCard.tsx`
- Modify: `packages/ui/src/components/tool-cards/BashToolCard.tsx`
- Modify: `packages/ui/src/components/tool-cards/EditToolCard.tsx`
- Modify: `packages/ui/src/components/tool-cards/WriteToolCard.tsx`
- Modify: `packages/ui/src/components/tool-cards/McpToolCard.tsx`
- Modify: `packages/ui/src/components/tool-cards/AgentToolCard.tsx`
- Modify: `packages/ui/src/components/tool-cards/SkillToolCard.tsx`
- Modify: `packages/ui/src/components/tool-cards/GenericToolCard.tsx`

- [ ] **Step 1: Update ReadToolCard**

Replace `packages/ui/src/components/tool-cards/ReadToolCard.tsx`:

```tsx
import type { ToolCardRouterProps } from './ToolCardRouter'
import { ToolCardShell } from './ToolCardShell'
import { IconCopy } from '../icons'

export function ReadToolCard({ event, input, result }: ToolCardRouterProps) {
  const status = event
    ? (event.type === 'complete' ? 'done' : event.type === 'error' ? 'error' : 'running')
    : (result?.is_error ? 'error' : 'done')

  const toolInput = event?.input || input || {}
  const filePath = (toolInput.file_path || toolInput.path || '') as string
  const content = event?.result?.content || result?.content || ''
  const lineCount = content ? content.split('\n').length : 0
  const isError = event?.result?.isError || result?.is_error

  const detail = filePath + (lineCount > 0 ? ` (${lineCount} lines)` : '')

  const copyPath = () => navigator.clipboard?.writeText(filePath)

  return (
    <ToolCardShell
      label="Read"
      detail={detail}
      status={status}
      defaultExpanded={false}
      actions={status === 'done' ? (
        <button onClick={(e) => { e.stopPropagation(); copyPath() }} className="p-1 rounded-[4px] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-3)] transition-colors" aria-label="Copy path">
          <IconCopy size={12} />
        </button>
      ) : undefined}
    >
      {isError && (
        <pre className="max-h-48 overflow-auto text-[12px] whitespace-pre-wrap text-[var(--bad)]" style={{ fontFamily: 'var(--font-mono)' }}>
          {content}
        </pre>
      )}
      {!isError && content && (
        <pre className="max-h-48 overflow-auto text-[12px] whitespace-pre-wrap text-[var(--text)]" style={{ fontFamily: 'var(--font-mono)' }}>
          {content.split('\n').slice(0, 5).join('\n')}
          {lineCount > 5 && `\n... ${lineCount - 5} more lines`}
        </pre>
      )}
    </ToolCardShell>
  )
}
```

- [ ] **Step 2: Update BashToolCard**

Replace `packages/ui/src/components/tool-cards/BashToolCard.tsx`:

```tsx
import type { ToolCardRouterProps } from './ToolCardRouter'
import { ToolCardShell } from './ToolCardShell'
import { truncateText } from './shared'
import { IconCopy } from '../icons'

export function BashToolCard({ event, input, result }: ToolCardRouterProps) {
  const status = event
    ? (event.type === 'complete' ? 'done' : event.type === 'error' ? 'error' : 'running')
    : (result?.is_error ? 'error' : 'done')

  const command = (event?.input?.command || input?.command || '') as string
  const output = event?.result?.content || result?.content || ''
  const isError = event?.result?.isError || result?.is_error

  const detail = `$ ${truncateText(command, 50)}`

  const copyCommand = () => navigator.clipboard?.writeText(command)
  const copyOutput = () => navigator.clipboard?.writeText(output)

  return (
    <ToolCardShell
      label="Bash"
      detail={detail}
      status={status}
      defaultExpanded={status === 'running'}
      actions={status === 'done' ? (
        <div className="flex items-center gap-1">
          <button onClick={(e) => { e.stopPropagation(); copyCommand() }} className="px-1.5 py-0.5 rounded-[4px] text-[11px] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-3)] transition-colors">Copy cmd</button>
          {output && <button onClick={(e) => { e.stopPropagation(); copyOutput() }} className="px-1.5 py-0.5 rounded-[4px] text-[11px] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-3)] transition-colors">Copy output</button>}
        </div>
      ) : undefined}
    >
      {status === 'running' && !output && (
        <div className="text-[12px] text-[var(--muted)]">Running...</div>
      )}
      {output && (
        <pre className={`max-h-[300px] overflow-auto text-[12px] whitespace-pre-wrap ${isError ? 'text-[var(--bad)]' : 'text-[var(--text)]'}`} style={{ fontFamily: 'var(--font-mono)' }}>
          {output}
        </pre>
      )}
    </ToolCardShell>
  )
}
```

- [ ] **Step 3: Update EditToolCard, WriteToolCard, McpToolCard, AgentToolCard, SkillToolCard, GenericToolCard**

Apply the same pattern to each:
- Use `var(--*)` tokens instead of hardcoded colors
- Use `font-family: var(--font-mono)` for code content
- Use natural text labels for actions (no brackets)
- Use `IconCopy` for copy buttons
- Keep existing logic, only change visual styling

For each file, replace all instances of:
- `bg-[#050505]` → remove (use parent bg)
- `text-[#EAEAEA]` → `text-[var(--text)]`
- `text-[#E61919]` → `text-[var(--bad)]`
- `text-[#4AF626]` → `text-[var(--good)]`
- `text-[#666]` → `text-[var(--muted)]`
- `border-[#333]` → `border-[var(--border)]`
- `font-mono` class → `style={{ fontFamily: 'var(--font-mono)' }}`

- [ ] **Step 4: Build and verify**

Run: `cd /Users/chenmingxu/Documents/jdcagnet && pnpm --filter @jdcagnet/ui build`
Expected: Build passes.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/tool-cards/
git commit -m "feat(ui): restyle all tool cards with theme tokens"
```

---

## Task 12: Inspector Panel

**Files:**
- Create: `packages/ui/src/components/Inspector.tsx`
- Modify: `packages/ui/src/App.tsx` (add Inspector to grid)

- [ ] **Step 1: Create Inspector component**

Create `packages/ui/src/components/Inspector.tsx`:

```tsx
import { useState, useEffect, useCallback } from 'react'
import { useSessionStore } from '../stores/session-store'
import { IconTasks, IconQueue, IconUsage, IconFiles, IconSession, IconX } from './icons'

interface FileChange {
  filePath: string
  changeType: 'created' | 'modified'
  snapshotCount: number
}

function formatTokens(tokens: number): string {
  if (tokens === 0) return '0'
  if (tokens < 1000) return String(tokens)
  if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}k`
  return `${(tokens / 1000000).toFixed(2)}M`
}

export function Inspector() {
  const [expanded, setExpanded] = useState(false)
  const [activeSection, setActiveSection] = useState<string | null>(null)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const sessionStates = useSessionStore((s) => s.sessionStates)
  const tasks = useSessionStore((s) => s.tasks)
  const queue = useSessionStore((s) => s.messageQueue)
  const removeFromQueue = useSessionStore((s) => s.removeFromQueue)
  const [fileChanges, setFileChanges] = useState<FileChange[]>([])

  const usage = activeSessionId ? sessionStates[activeSessionId]?.usage : undefined
  const isStreaming = activeSessionId ? sessionStates[activeSessionId]?.isStreaming : false

  const loadFileChanges = useCallback(async () => {
    if (!activeSessionId) return
    try {
      const result = await window.electronAPI?.invoke('file:get-changes', { sessionId: activeSessionId })
      if (result) setFileChanges(result as FileChange[])
    } catch { /* ignore */ }
  }, [activeSessionId])

  useEffect(() => { loadFileChanges() }, [loadFileChanges])
  useEffect(() => { if (!isStreaming) loadFileChanges() }, [isStreaming, loadFileChanges])

  const activeTasks = tasks.filter((t) => t.status !== 'completed')

  const toggleSection = (section: string) => {
    if (!expanded) {
      setExpanded(true)
      setActiveSection(section)
    } else if (activeSection === section) {
      setExpanded(false)
      setActiveSection(null)
    } else {
      setActiveSection(section)
    }
  }

  const railItems = [
    { id: 'tasks', Icon: IconTasks, badge: activeTasks.length || null },
    { id: 'queue', Icon: IconQueue, badge: queue.length || null },
    { id: 'usage', Icon: IconUsage, badge: null },
    { id: 'files', Icon: IconFiles, badge: fileChanges.length || null },
    { id: 'session', Icon: IconSession, badge: null },
  ]

  return (
    <div className="flex h-full">
      {/* Rail */}
      <div className="w-[44px] border-l border-[var(--border)] bg-[var(--surface)] flex flex-col items-center py-3 gap-2">
        {railItems.map(({ id, Icon, badge }) => (
          <button
            key={id}
            onClick={() => toggleSection(id)}
            className={`relative p-2 rounded-[6px] transition-colors ${activeSection === id && expanded ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'}`}
            aria-label={id}
          >
            <Icon size={16} />
            {badge && badge > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-ink)] text-[9px] font-medium px-0.5">
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Expanded panel */}
      {expanded && (
        <div className="w-[300px] border-l border-[var(--border)] bg-[var(--surface)] overflow-y-auto" style={{ transition: 'width 180ms ease, opacity 180ms ease' }}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
            <span className="text-[12px] uppercase tracking-[0.1em] text-[var(--muted)] font-medium">Inspector</span>
            <button onClick={() => { setExpanded(false); setActiveSection(null) }} className="text-[var(--muted)] hover:text-[var(--text)] transition-colors">
              <IconX size={14} />
            </button>
          </div>

          {/* Session section */}
          {(activeSection === 'session' || !activeSection) && activeSessionId && (
            <div className="px-4 py-3 border-b border-[var(--border)]">
              <h3 className="text-[11px] uppercase tracking-[0.1em] text-[var(--muted)] font-medium mb-2">Session</h3>
              <div className="space-y-1 text-[12px]">
                <div className="flex justify-between"><span className="text-[var(--muted)]">ID</span><span className="text-[var(--text)]" style={{ fontFamily: 'var(--font-mono)' }}>{activeSessionId.slice(0, 8)}</span></div>
              </div>
            </div>
          )}

          {/* Usage section */}
          {(activeSection === 'usage' || !activeSection) && usage && (
            <div className="px-4 py-3 border-b border-[var(--border)]">
              <h3 className="text-[11px] uppercase tracking-[0.1em] text-[var(--muted)] font-medium mb-2">Usage</h3>
              <div className="space-y-2 text-[12px]">
                <div className="flex justify-between"><span className="text-[var(--muted)]">Tokens</span><span className="text-[var(--text)]">{formatTokens(usage.totalTokens)}</span></div>
                <div className="flex justify-between"><span className="text-[var(--muted)]">Cache</span><span className="text-[var(--text)]">{usage.cacheHitRate}%</span></div>
                <div className="flex justify-between items-center">
                  <span className="text-[var(--muted)]">Context</span>
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1 rounded-full bg-[var(--surface-3)] overflow-hidden">
                      <div className={`h-full rounded-full ${usage.contextUsedPercent > 80 ? 'bg-[var(--bad)]' : 'bg-[var(--accent)]'}`} style={{ width: `${usage.contextUsedPercent}%` }} />
                    </div>
                    <span className={usage.contextUsedPercent > 80 ? 'text-[var(--bad)]' : 'text-[var(--text)]'}>{usage.contextUsedPercent}%</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tasks section */}
          {(activeSection === 'tasks' || !activeSection) && activeTasks.length > 0 && (
            <div className="px-4 py-3 border-b border-[var(--border)]">
              <h3 className="text-[11px] uppercase tracking-[0.1em] text-[var(--muted)] font-medium mb-2">Tasks ({activeTasks.length})</h3>
              <div className="space-y-1.5">
                {activeTasks.map((task) => (
                  <div key={task.id} className="flex items-center gap-2 text-[12px]">
                    <span className={task.status === 'in_progress' ? 'text-[var(--good)] animate-pulse' : 'text-[var(--muted)]'}>
                      {task.status === 'in_progress' ? '●' : '○'}
                    </span>
                    <span className="text-[var(--muted)]">#{task.id}</span>
                    <span className="text-[var(--text)] truncate">{task.subject}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Queue section */}
          {(activeSection === 'queue' || !activeSection) && queue.length > 0 && (
            <div className="px-4 py-3 border-b border-[var(--border)]">
              <h3 className="text-[11px] uppercase tracking-[0.1em] text-[var(--muted)] font-medium mb-2">Queue ({queue.length})</h3>
              <div className="space-y-1">
                {queue.map((msg, i) => (
                  <div key={i} className="flex items-center gap-2 text-[12px]">
                    <span className="text-[var(--text)] truncate flex-1">{msg.length > 40 ? msg.slice(0, 40) + '...' : msg}</span>
                    <button onClick={() => removeFromQueue(i)} className="text-[var(--muted)] hover:text-[var(--bad)] text-[11px] transition-colors">×</button>
                  </div>
                ))}
                <button onClick={() => useSessionStore.setState({ messageQueue: [] })} className="text-[11px] text-[var(--muted)] hover:text-[var(--bad)] transition-colors mt-1">Clear all</button>
              </div>
            </div>
          )}

          {/* Files section */}
          {(activeSection === 'files' || !activeSection) && fileChanges.length > 0 && (
            <div className="px-4 py-3 border-b border-[var(--border)]">
              <h3 className="text-[11px] uppercase tracking-[0.1em] text-[var(--muted)] font-medium mb-2">Files Changed ({fileChanges.length})</h3>
              <div className="space-y-1">
                {fileChanges.map((change) => (
                  <div key={change.filePath} className="flex items-center gap-2 text-[12px]">
                    <span className={change.changeType === 'created' ? 'text-[var(--good)]' : 'text-[var(--warn)]'}>
                      {change.changeType === 'created' ? '+' : '~'}
                    </span>
                    <span className="text-[var(--text)] truncate" style={{ fontFamily: 'var(--font-mono)' }}>
                      {change.filePath.split('/').slice(-2).join('/')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add Inspector to App.tsx grid**

In `packages/ui/src/App.tsx`, add the import:
```tsx
import { Inspector } from './components/Inspector'
```

Change the inner grid from:
```tsx
<div className="grid grid-cols-[240px_1fr] overflow-hidden">
```
to:
```tsx
<div className="grid grid-cols-[240px_1fr_auto] overflow-hidden">
```

Add `<Inspector />` after the main content div (before the closing `</div>` of the grid):
```tsx
        </div>
        <Inspector />
      </div>
```

- [ ] **Step 3: Build and verify**

Run: `cd /Users/chenmingxu/Documents/jdcagnet && pnpm --filter @jdcagnet/ui build`
Expected: Build passes.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/Inspector.tsx packages/ui/src/App.tsx
git commit -m "feat(ui): add Inspector panel with rail and expanded state"
```

---

## Task 13: Settings Overlay

**Files:**
- Create: `packages/ui/src/components/SettingsOverlay.tsx`
- Modify: `packages/ui/src/App.tsx` (replace ModelManager + McpSettings + SettingsPanel with SettingsOverlay)

- [ ] **Step 1: Create SettingsOverlay**

Create `packages/ui/src/components/SettingsOverlay.tsx` with:
- Left tab nav (160px): Appearance, Models, MCP, Shortcuts, Advanced
- Right content area that renders the active tab
- Appearance tab: `ThemeSegmented` component
- Models tab: reuse all logic from current `ModelManager` (groups, addGroup, addModel, etc.)
- MCP tab: reuse all logic from current `McpSettings` (server list, reconnect, toggle, delete)
- Shortcuts tab: hardcoded reference table
- Advanced tab: permission mode default selector
- Overlay: centered modal, `max-width: 680px`, `max-height: 80vh`, backdrop

The component should import from `useModelStore` and use `electronAPI.mcpListServers()` directly, same as the existing components do.

- [ ] **Step 2: Wire SettingsOverlay into App.tsx**

In `packages/ui/src/App.tsx`:
- Replace imports of `ModelManager`, `McpSettings`, `SettingsPanel` with `SettingsOverlay`
- Remove `[mcpOpen, setMcpOpen]` state (MCP is now a tab in settings)
- Replace `<ModelManager />`, `<McpSettings ... />` with `<SettingsOverlay />`
- Update `onOpenMcp` prop on ChatView to open settings with MCP tab: `openSettings('mcp')`

- [ ] **Step 3: Build and verify**

Run: `cd /Users/chenmingxu/Documents/jdcagnet && pnpm --filter @jdcagnet/ui build`
Expected: Build passes.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/SettingsOverlay.tsx packages/ui/src/App.tsx
git commit -m "feat(ui): add unified SettingsOverlay with tabs"
```

---

## Task 14: Overlay Components Restyle

**Files:**
- Modify: `packages/ui/src/components/ErrorCard.tsx`
- Modify: `packages/ui/src/components/PermissionDialog.tsx`
- Modify: `packages/ui/src/components/PlanReviewDialog.tsx`
- Modify: `packages/ui/src/components/AskUserDialog.tsx`
- Modify: `packages/ui/src/components/AskUserCard.tsx`
- Modify: `packages/ui/src/components/SlashCommandMenu.tsx`

- [ ] **Step 1: Restyle ErrorCard**

Update `ErrorCard.tsx`:
- Replace `border-[#E61919]/50 bg-[#E61919]/5` with `border-[var(--border)] bg-[var(--surface-2)]`
- Add left bar: `border-l-4 border-l-[var(--bad)]`
- Replace all hardcoded colors with token vars
- Replace `[RETRY]` / `[X]` with `Retry` / `Dismiss`
- Add `rounded-[8px]`

- [ ] **Step 2: Restyle PermissionDialog**

Update `PermissionDialog.tsx`:
- Replace `border-yellow-600/50 bg-yellow-900/10` with `border-[var(--border)] bg-[var(--surface-2)]`
- Add left bar: `border-l-4 border-l-[var(--warn)]`
- Replace `[ALLOW]` / `[DENY]` with `Allow` / `Deny`
- Use token colors throughout
- Add `rounded-[8px]`

- [ ] **Step 3: Restyle PlanReviewDialog**

Update `PlanReviewDialog.tsx`:
- Replace `border-purple-600/50 bg-purple-900/10` with `border-[var(--border)] bg-[var(--surface-2)]`
- Add left bar: `border-l-4 border-l-[var(--plan)]`
- Replace `[APPROVE]` / `[REJECT]` with `Approve` / `Reject`
- Use token colors throughout
- Add `rounded-[8px]`

- [ ] **Step 4: Restyle AskUserDialog + AskUserCard**

Update `AskUserDialog.tsx`:
- Replace `bg-black/80` with `bg-black/20 dark:bg-black/60` (use `[data-theme="dark"] &` or just `bg-black/40`)
- Card: `rounded-[14px]`, `shadow-soft`, `surface` bg

Update `AskUserCard.tsx`:
- Option rows: hover `surface-2`, selected `accent-soft` bg
- Use token colors throughout

- [ ] **Step 5: Restyle SlashCommandMenu**

Update `SlashCommandMenu.tsx`:
- Replace `border-[#333] bg-[#0A0A0A]` with `border-[var(--border)] bg-[var(--surface)]`
- Add `rounded-[12px]` and `box-shadow: var(--shadow-soft)`
- Replace all hardcoded colors with token vars
- Section headers: `text-[var(--muted)]`
- Selected item: `bg-[var(--surface-2)]`

- [ ] **Step 6: Build and verify**

Run: `cd /Users/chenmingxu/Documents/jdcagnet && pnpm --filter @jdcagnet/ui build`
Expected: Build passes.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/components/ErrorCard.tsx packages/ui/src/components/PermissionDialog.tsx packages/ui/src/components/PlanReviewDialog.tsx packages/ui/src/components/AskUserDialog.tsx packages/ui/src/components/AskUserCard.tsx packages/ui/src/components/SlashCommandMenu.tsx
git commit -m "feat(ui): restyle overlays and dialogs with theme tokens"
```

---

## Task 15: Delete Replaced Components

**Files:**
- Delete: `packages/ui/src/components/SettingsPanel.tsx`
- Delete: `packages/ui/src/components/ModelManager.tsx`
- Delete: `packages/ui/src/components/McpSettings.tsx`
- Delete: `packages/ui/src/components/UsageHUD.tsx`
- Delete: `packages/ui/src/components/StatsCard.tsx`
- Delete: `packages/ui/src/components/MessageBubble.tsx`
- Delete: `packages/ui/src/components/QueueIndicator.tsx`
- Delete: `packages/ui/src/components/TaskPanel.tsx`
- Delete: `packages/ui/src/components/FileChangesPanel.tsx`
- Delete: `packages/ui/src/components/PromptInput.tsx`
- Modify: `packages/ui/src/App.tsx` (remove dead imports)
- Modify: `packages/ui/src/components/ChatView.tsx` (remove dead imports)

- [ ] **Step 1: Remove all deleted component files**

```bash
cd /Users/chenmingxu/Documents/jdcagnet
rm packages/ui/src/components/SettingsPanel.tsx
rm packages/ui/src/components/ModelManager.tsx
rm packages/ui/src/components/McpSettings.tsx
rm packages/ui/src/components/UsageHUD.tsx
rm packages/ui/src/components/StatsCard.tsx
rm packages/ui/src/components/MessageBubble.tsx
rm packages/ui/src/components/QueueIndicator.tsx
rm packages/ui/src/components/TaskPanel.tsx
rm packages/ui/src/components/FileChangesPanel.tsx
rm packages/ui/src/components/PromptInput.tsx
```

- [ ] **Step 2: Remove dead imports from App.tsx and ChatView.tsx**

Remove any import lines referencing the deleted files. Remove any JSX usage of these components.

- [ ] **Step 3: Build and verify**

Run: `cd /Users/chenmingxu/Documents/jdcagnet && pnpm --filter @jdcagnet/ui build`
Expected: Build passes with no references to deleted files.

- [ ] **Step 4: Commit**

```bash
git add -A packages/ui/src/
git commit -m "chore(ui): remove replaced components (SettingsPanel, ModelManager, McpSettings, UsageHUD, etc.)"
```

---

## Task 16: Responsive + Accessibility + Final Polish

**Files:**
- Modify: `packages/ui/src/components/Inspector.tsx` (responsive breakpoints)
- Modify: `packages/ui/src/components/Topbar.tsx` (responsive)
- Modify: `packages/ui/src/index.css` (add responsive utilities if needed)

- [ ] **Step 1: Add responsive behavior to Inspector**

In `Inspector.tsx`, add a window width check:
- Use `window.innerWidth` or a resize observer
- If width < 900px: force `expanded = false`, disable expand
- If width < 700px: hide the rail entirely

- [ ] **Step 2: Add aria-labels and keyboard focus**

Across all interactive components, ensure:
- All icon-only buttons have `aria-label`
- Focus rings use `focus-visible:ring-2 focus-visible:ring-[var(--accent)]`
- Dialogs trap focus when open
- Escape closes overlays

- [ ] **Step 3: Add MarkdownRenderer prose update**

Update `MarkdownRenderer.tsx` to ensure prose classes work with new CSS tokens (the `.prose` styles in `index.css` already use vars, but verify the component applies `prose` class correctly).

- [ ] **Step 4: Build and verify**

Run: `cd /Users/chenmingxu/Documents/jdcagnet && pnpm --filter @jdcagnet/ui build`
Expected: Build passes.

- [ ] **Step 5: Commit**

```bash
git add -A packages/ui/src/
git commit -m "feat(ui): add responsive behavior and accessibility improvements"
```

---

## Verification Checklist

After all tasks are complete, verify:

- [ ] `pnpm --filter @jdcagnet/ui build` passes
- [ ] Light theme renders correctly (warm whites, bone backgrounds)
- [ ] Dark theme renders correctly (deep grays, soft text)
- [ ] System theme follows OS preference and updates in real time
- [ ] Theme preference persists across app restart
- [ ] Sidebar shows projects/sessions with status dots
- [ ] Project page shows overview cards when no session active
- [ ] Chat page shows turns (user + assistant grouped)
- [ ] Streaming text appears inline in active turn
- [ ] Tool cards collapse/expand correctly
- [ ] Composer shows Queue chip when messages queued
- [ ] Stop/Queue/Send buttons appear in correct states
- [ ] Inspector rail shows badges, expands on click
- [ ] Settings overlay has all tabs functional
- [ ] Permission/PlanReview/Error dialogs render with left bar style
- [ ] No CRT scanlines, no neon green, no `border-radius: 0 !important`
- [ ] All text readable, no overlap or truncation

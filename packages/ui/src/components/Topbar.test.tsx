import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { useSessionStore } from '../stores/session-store'
import { useSettingsStore } from '../stores/settings-store'
import { Topbar } from './Topbar'

const cwd = '/Users/chenmingxu/Documents/jdcagnet'

describe('Topbar', () => {
  beforeEach(() => {
    const state = {
      projects: [{
        name: 'jdcagnet',
        cwd,
        sessions: [{ id: 'session-1', projectName: 'jdcagnet', cwd }],
      }],
      activeSessionId: 'session-1',
    }
    useSessionStore.setState(state)
    Object.assign(useSessionStore.getInitialState(), state)
    const settingsState = { theme: 'system' as const, resolvedTheme: 'light' as const }
    useSettingsStore.setState(settingsState)
    Object.assign(useSettingsStore.getInitialState(), settingsState)
  })

  it('shows the JDC CODE brand with the full project path in the topbar', () => {
    const html = renderToStaticMarkup(<Topbar />)
    const heading = html.match(/<h1[^>]*>.*?<\/h1>/)?.[0] ?? ''

    expect(heading).toContain(`JDC CODE · ${cwd}`)
    expect(heading).not.toContain('jdcagnet ·')
    expect(heading).not.toContain('title=')
    expect(heading).not.toContain('jdcagnet-&gt;')
  })

  it('makes the full project path a project console trigger', () => {
    const html = renderToStaticMarkup(<Topbar />)

    expect(html).toContain('topbar-project-console-trigger')
    expect(html).toContain('aria-label="Open project console"')
    expect(html).toContain(`JDC CODE · ${cwd}`)
  })

  it('renders theme mode as a custom dropdown with system as the default option', () => {
    const html = renderToStaticMarkup(<Topbar />)

    expect(html).not.toContain('<select')
    expect(html).toContain('theme-mode-trigger')
    expect(html).toContain('aria-haspopup="listbox"')
    expect(html).toContain('aria-label="Theme mode"')
    expect(html).toContain('跟随系统')
  })
})

import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { useSessionStore } from '../stores/session-store'
import { Sidebar } from './Sidebar'

describe('Sidebar', () => {
  beforeEach(() => {
    const state = {
      projects: [{
        name: 'jdcagnet',
        cwd: '/Users/chenmingxu/Documents/jdcagnet',
        sessions: [
          { id: 'session-1', projectName: 'jdcagnet', cwd: '/Users/chenmingxu/Documents/jdcagnet', title: 'Review UI' },
          { id: 'session-2', projectName: 'jdcagnet', cwd: '/Users/chenmingxu/Documents/jdcagnet', title: 'JDC Dark' },
        ],
      }],
      activeSessionId: 'session-2',
      sessionStates: {
        'session-1': { isStreaming: true, streamingText: '', thinkingText: '', isThinking: false, toolEvents: [] },
        'session-2': { isStreaming: false, streamingText: '', thinkingText: '', isThinking: false, toolEvents: [] },
      },
    }
    useSessionStore.setState(state)
    Object.assign(useSessionStore.getInitialState(), state)
  })

  it('renders the left session list as a JDC dark shell', () => {
    const html = renderToStaticMarkup(<Sidebar />)

    expect(html).toContain('sidebar-shell')
    expect(html).toContain('sidebar-project-group')
    expect(html).toContain('sidebar-project-heading')
    expect(html).toContain('sidebar-session-row')
    expect(html).toContain('sidebar-session-active')
    expect(html).toContain('sidebar-footer')
    expect(html).toContain('JDC Dark')
    expect(html).toContain('New project')
  })

  it('renders each project heading as a console trigger', () => {
    const html = renderToStaticMarkup(<Sidebar />)

    expect(html).toContain('sidebar-project-console-trigger')
    expect(html).toContain('aria-label="Open jdcagnet project console"')
  })
})

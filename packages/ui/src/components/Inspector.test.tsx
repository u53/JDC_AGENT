import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBackgroundTaskStore } from '../stores/background-task-store'
import { useContextStore } from '../stores/context-store'
import { useSessionStore } from '../stores/session-store'
import { useTeamStore } from '../stores/team-store'
import { Inspector } from './Inspector'

describe('Inspector', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      innerWidth: 1200,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      electronAPI: {
        invoke: vi.fn().mockResolvedValue([]),
      },
    })
    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
    })
    useSessionStore.setState({
      activeSessionId: 'session-1',
      sessionStates: {},
      tasks: [],
      messageQueue: [],
    })
    useBackgroundTaskStore.setState({ tasks: [] })
    useTeamStore.setState({ teams: {}, activeTeamId: null })
    useContextStore.setState({
      inspect: { data: null, loading: false, error: null, loadedAt: null },
    })
  })

  it('renders the collapsed inspector as a polished JDC dark rail', () => {
    const html = renderToStaticMarkup(<Inspector />)

    expect(html).toContain('inspector-rail')
    expect(html).toContain('inspector-rail-brand')
    expect(html).toContain('inspector-rail-item')
    expect(html).toContain('JD')
    expect(html).toContain('aria-label="Session"')
  })
})

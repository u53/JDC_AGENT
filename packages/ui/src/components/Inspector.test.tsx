import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBackgroundTaskStore } from '../stores/background-task-store'
import { useContextStore } from '../stores/context-store'
import { useSessionStore } from '../stores/session-store'
import { useTeamStore } from '../stores/team-store'
import { Inspector } from './Inspector'

function extractZIndex(source: string, marker: string): number {
  const markerIndex = source.indexOf(marker)
  expect(markerIndex).toBeGreaterThan(-1)
  const snippet = source.slice(markerIndex, markerIndex + 260)
  const arbitrary = snippet.match(/z-\[(\d+)\]/)
  if (arbitrary) return Number(arbitrary[1])
  const scale = snippet.match(/z-(\d+)/)
  if (scale) return Number(scale[1])
  throw new Error(`No z-index utility found near ${marker}`)
}

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
      messageQueues: {},
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

  it('keeps the image preview overlay above the chat composer', () => {
    const inspectorSource = readFileSync(new URL('./Inspector.tsx', import.meta.url), 'utf8')
    const composerSource = readFileSync(new URL('./Composer.tsx', import.meta.url), 'utf8')

    const previewZIndex = extractZIndex(inspectorSource, 'fixed inset-0')
    const composerZIndex = extractZIndex(composerSource, 'composer-shell')

    expect(previewZIndex).toBeGreaterThan(composerZIndex)
  })
})

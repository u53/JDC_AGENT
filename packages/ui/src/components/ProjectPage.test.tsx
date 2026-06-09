import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { useModelStore } from '../stores/model-store'
import { useSessionStore } from '../stores/session-store'
import { ProjectPage } from './ProjectPage'

describe('ProjectPage', () => {
  beforeEach(() => {
    const sessionState = {
      projects: [],
      activeSessionId: null,
      sessionStates: {},
      tasks: [],
    }
    useSessionStore.setState(sessionState)
    Object.assign(useSessionStore.getInitialState(), sessionState)
    useModelStore.setState({ groups: [], activeModelId: null })
  })

  it('renders the empty workspace as an open JDC dark hero surface', () => {
    const html = renderToStaticMarkup(<ProjectPage />)

    expect(html).toContain('project-page-shell')
    expect(html).toContain('project-empty-state')
    expect(html).toContain('project-empty-headline')
    expect(html).toContain('project-primary-action')
    expect(html).toContain('Local agent workspace')
    expect(html).toContain('ready for a project')
  })

  it('renders the selected project console instead of always using the first project', () => {
    const sessionState = {
      projects: [
        { name: 'alpha', cwd: '/repo/alpha', sessions: [{ id: 'alpha-1', projectName: 'alpha', cwd: '/repo/alpha' }] },
        { name: 'olympus', cwd: '/repo/olympus', sessions: [{ id: 'olympus-1', projectName: 'olympus', cwd: '/repo/olympus' }] },
      ],
      activeProjectCwd: '/repo/olympus',
      activeSessionId: null,
      sessionStates: {},
      tasks: [],
    } as any
    useSessionStore.setState(sessionState)
    Object.assign(useSessionStore.getInitialState(), sessionState)

    const html = renderToStaticMarkup(<ProjectPage />)

    expect(html).toContain('olympus')
    expect(html).toContain('/repo/olympus')
    expect(html).not.toContain('/repo/alpha')
  })
})

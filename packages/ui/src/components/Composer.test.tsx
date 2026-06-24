import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore } from '../stores/session-store'
import { Composer } from './Composer'

describe('Composer', () => {
  beforeEach(() => {
    vi.stubGlobal('FileReader', class {})
    const state = {
      activeSessionId: 'session-1',
      projects: [{
        name: 'jdcagnet',
        cwd: '/Users/chenmingxu/Documents/jdcagnet',
        sessions: [{ id: 'session-1', projectName: 'jdcagnet', cwd: '/Users/chenmingxu/Documents/jdcagnet' }],
      }],
      messageQueues: {},
      drafts: { 'session-1': { text: '', images: [] } },
    }
    useSessionStore.setState(state)
    Object.assign(useSessionStore.getInitialState(), state)
  })

  it('renders a polished command surface with control buttons', () => {
    const html = renderToStaticMarkup(
      <Composer
        onSend={vi.fn()}
        onAbort={vi.fn()}
        isStreaming={false}
        permissionMode="standard"
        effort="medium"
        modelId="model-1"
        modelName="GPT 5.5"
        models={[{ id: 'model-1', name: 'GPT 5.5', groupName: 'JDC AI' }]}
      />,
    )

    expect(html).toContain('composer-shell')
    expect(html).toContain('composer-command-surface')
    expect(html).toContain('composer-control-strip')
    expect(html).toContain('composer-control-button')
    expect(html).toContain('composer-send-button')
    expect(html).toContain('标准模式')
    expect(html).toContain('推理:中')
    expect(html).toContain('GPT 5.5')
  })

  it('renders only the active session queue count', () => {
    const queueState = {
      activeSessionId: 'session-2',
      projects: [{
        name: 'jdcagnet',
        cwd: '/Users/chenmingxu/Documents/jdcagnet',
        sessions: [
          { id: 'session-1', projectName: 'jdcagnet', cwd: '/Users/chenmingxu/Documents/jdcagnet' },
          { id: 'session-2', projectName: 'jdcagnet', cwd: '/Users/chenmingxu/Documents/jdcagnet' },
        ],
      }],
      messageQueues: { 'session-1': ['queued from session 1'], 'session-2': ['queued from session 2'] },
      drafts: { 'session-2': { text: '', images: [] } },
    }
    useSessionStore.setState(queueState as any)
    Object.assign(useSessionStore.getInitialState(), queueState)

    const html = renderToStaticMarkup(
      <Composer
        onSend={vi.fn()}
        onAbort={vi.fn()}
        isStreaming={false}
        permissionMode="standard"
        effort="medium"
        modelId="model-1"
        modelName="GPT 5.5"
        models={[{ id: 'model-1', name: 'GPT 5.5', groupName: 'JDC AI' }]}
      />,
    )

    expect(html).toContain('Queue: 1 messages')
    expect(html).not.toContain('Queue: 2 messages')
    expect(html).not.toContain('queued from session 1')
  })

  it('renders queued messages as editable controls', () => {
    const composerSource = readFileSync(new URL('./Composer.tsx', import.meta.url), 'utf8')

    expect(composerSource).toContain('composer-queued-message-input')
    expect(composerSource).toContain('updateQueuedMessage(activeSessionId, i')
  })

  it('shows the full xhigh reasoning label in the command controls', () => {
    const html = renderToStaticMarkup(
      <Composer
        onSend={vi.fn()}
        onAbort={vi.fn()}
        isStreaming={false}
        permissionMode="standard"
        effort="xhigh"
        modelId="model-1"
        modelName="GPT 5.5"
        models={[{ id: 'model-1', name: 'GPT 5.5', groupName: 'JDC AI' }]}
      />,
    )

    expect(html).toContain('推理:超高')
    expect(html).not.toMatch(/>推理:超</)
  })

  it('keeps control popovers in a layer above the chat timeline', () => {
    const html = renderToStaticMarkup(
      <Composer
        onSend={vi.fn()}
        onAbort={vi.fn()}
        isStreaming={false}
        permissionMode="standard"
        effort="medium"
        modelId="model-1"
        modelName="GPT 5.5"
        models={[{ id: 'model-1', name: 'GPT 5.5', groupName: 'JDC AI' }]}
      />,
    )

    expect(html).toContain('composer-shell')
    expect(html).toContain('relative')
    expect(html).toContain('z-[70]')
    expect(html).toContain('overflow-visible')
  })
})

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
      messageQueue: [],
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
})

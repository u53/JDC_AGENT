import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { useModelStore } from '../stores/model-store'
import { useSessionStore } from '../stores/session-store'
import { SessionHeader } from './SessionHeader'

describe('SessionHeader', () => {
  beforeEach(() => {
    const sessionState = {
      activeSessionId: 'session-1',
      projects: [{
        name: 'jdcagnet',
        cwd: '/Users/chenmingxu/Documents/jdcagnet',
        sessions: [{ id: 'session-1', projectName: 'jdcagnet', cwd: '/Users/chenmingxu/Documents/jdcagnet' }],
      }],
      sessionStates: {},
      messageQueue: [],
    }
    useSessionStore.setState(sessionState)
    Object.assign(useSessionStore.getInitialState(), sessionState)
    useModelStore.setState({
      activeModelId: 'model-1',
      groups: [{
        id: 'group-1',
        name: 'JDC AI',
        protocol: 'openai-responses',
        baseUrl: 'https://api.example.com/v1',
        apiKey: '',
        models: [{
          id: 'model-1',
          name: 'GPT 5.5',
          modelId: 'gpt-5.5',
          contextWindow: 200000,
          maxTokens: 32000,
          compressAt: 0.9,
        }],
      }],
    })
  })

  it('shows the full xhigh reasoning label in the right status area', () => {
    const html = renderToStaticMarkup(
      <SessionHeader permissionMode="standard" effort="xhigh" planMode={false} />,
    )

    expect(html).toContain('推理:超高')
    expect(html).not.toMatch(/>推理:超</)
  })
})

import { useEffect } from 'react'
import { ipc } from '../lib/ipc-client'
import { useAgentStore } from '../stores/agent-store'

export function useAgentEvents() {
  useEffect(() => {
    const store = useAgentStore.getState()

    const unsubProgress = ipc.agent.onProgress((data) => {
      if (!useAgentStore.getState().agents[data.agentToolUseId]) {
        return
      }
      store.updateAgentTool(
        data.agentToolUseId,
        data.toolName,
        data.toolStatus as 'start' | 'complete' | 'error',
        data.toolInput,
        data.toolResult,
        data.toolCount
      )
    })

    const unsubText = ipc.agent.onText((data) => {
      store.appendAgentText(data.agentToolUseId, data.text)
    })

    const unsubComplete = ipc.agent.onComplete((data) => {
      store.completeAgent(data.agentToolUseId, data.content)
    })

    return () => {
      unsubProgress()
      unsubText()
      unsubComplete()
    }
  }, [])
}

import { beforeEach, describe, expect, it } from 'vitest'
import { useTerminalStore } from './terminal-store'

describe('terminal store', () => {
  beforeEach(() => {
    useTerminalStore.setState({
      visible: false,
      height: 200,
      terminalId: null,
    })
  })

  it('clears the active terminal id when hiding the panel', () => {
    useTerminalStore.setState({ visible: true, terminalId: 'term-1' })

    useTerminalStore.getState().hide()

    expect(useTerminalStore.getState()).toMatchObject({
      visible: false,
      terminalId: null,
    })
  })

  it('clears the active terminal id when toggling an open panel closed', () => {
    useTerminalStore.setState({ visible: true, terminalId: 'term-1' })

    useTerminalStore.getState().toggle()

    expect(useTerminalStore.getState()).toMatchObject({
      visible: false,
      terminalId: null,
    })
  })
})

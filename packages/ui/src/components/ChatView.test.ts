import { describe, expect, it } from 'vitest'
import { shouldShowProcessingIndicator } from './ChatView'

describe('ChatView processing indicator gating', () => {
  it('does not show the generic PROCESSING card while compaction is active', () => {
    expect(shouldShowProcessingIndicator({
      isStreaming: true,
      streamingText: '',
      isThinking: false,
      toolEventsLength: 0,
      isLastTurnActive: false,
      compacting: true,
    })).toBe(false)
  })
})

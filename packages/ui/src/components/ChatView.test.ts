import { describe, expect, it } from 'vitest'
import { canSyncLocalPermissionMode, resolveDisplayedPermissionMode, shouldShowProcessingIndicator } from './ChatView'

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

  it('does not auto-sync local desktop permission mode into Feishu sessions', () => {
    expect(canSyncLocalPermissionMode(undefined)).toBe(true)
    expect(canSyncLocalPermissionMode('')).toBe(true)
    expect(canSyncLocalPermissionMode('feishu')).toBe(false)
  })

  it('shows the stored Feishu session permission instead of the desktop local mode', () => {
    expect(resolveDisplayedPermissionMode('standard', 'feishu', 'relaxed')).toBe('relaxed')
    expect(resolveDisplayedPermissionMode('standard', undefined, 'relaxed')).toBe('standard')
  })
})

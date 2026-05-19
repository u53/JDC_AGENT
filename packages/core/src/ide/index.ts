export { IdeManager } from './ide-manager.js'
export { IdeClient } from './ide-client.js'
export { JsonRpcProtocol } from './protocol.js'
export { scanLockfiles, isLockfileValid, matchesWorkspace, removeStaleLockfile } from './lockfile.js'
export type {
  IdeLockfile, IdeConnection, IdeConnectionStatus,
  SelectionData, AtMentionData, OpenDiffParams, OpenDiffResult,
  Diagnostic, DiagnosticFile, IdeCallbacks,
} from './types.js'

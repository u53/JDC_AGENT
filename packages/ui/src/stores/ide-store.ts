import { create } from 'zustand'

interface IdeConnection {
  port: number
  ideId?: string
  ideName: string
  ideVersion?: string
  appName?: string
  uriScheme?: string
  workspaceFolders: string[]
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
}

interface SelectionData {
  filePath?: string
  text?: string
  selection?: { start: { line: number; character: number }; end: { line: number; character: number } } | null
}

interface AtMentionData {
  filePath: string
  lineStart?: number
  lineEnd?: number
}

interface IdeState {
  connections: IdeConnection[]
  selection: SelectionData | null
  atMentions: AtMentionData[]
  bannerDismissed: boolean
  setConnections: (connections: IdeConnection[]) => void
  setSelection: (data: SelectionData | null) => void
  addAtMention: (data: AtMentionData) => void
  removeAtMention: (index: number) => void
  clearAtMentions: () => void
  dismissBanner: () => void
}

export const useIdeStore = create<IdeState>((set) => ({
  connections: [],
  selection: null,
  atMentions: [],
  bannerDismissed: false,
  setConnections: (connections) => set({ connections }),
  setSelection: (selection) => set({ selection }),
  addAtMention: (data) => set((s) => ({ atMentions: [...s.atMentions, data] })),
  removeAtMention: (index) => set((s) => ({ atMentions: s.atMentions.filter((_, i) => i !== index) })),
  clearAtMentions: () => set({ atMentions: [] }),
  dismissBanner: () => set({ bannerDismissed: true }),
}))

export function initIdeListeners(): () => void {
  const api = (window as any).electronAPI
  if (!api?.onIdeStateChanged) return () => {}

  // Fetch current state on init (in case discovery already ran)
  api.ideGetState?.().then((connections: IdeConnection[]) => {
    if (connections) useIdeStore.getState().setConnections(connections)
  }).catch(() => {})

  const unsub1 = api.onIdeStateChanged((connections: IdeConnection[]) => {
    useIdeStore.getState().setConnections(connections)
  })
  const unsub2 = api.onIdeSelectionChanged((data: SelectionData) => {
    useIdeStore.getState().setSelection(data)
  })
  const unsub3 = api.onIdeAtMentioned((data: AtMentionData) => {
    useIdeStore.getState().addAtMention(data)
  })

  return () => { unsub1?.(); unsub2?.(); unsub3?.() }
}

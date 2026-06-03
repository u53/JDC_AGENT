interface ContextInspectorEnv {
  DEV?: boolean
  PROD?: boolean
  VITE_JDC_CONTEXT_INSPECTOR?: string
}

export function shouldShowContextInspector(env: ContextInspectorEnv = import.meta.env): boolean {
  const flag = env.VITE_JDC_CONTEXT_INSPECTOR?.toLowerCase()
  if (flag === 'true' || flag === '1') return true
  if (flag === 'false' || flag === '0') return false
  return env.DEV === true
}

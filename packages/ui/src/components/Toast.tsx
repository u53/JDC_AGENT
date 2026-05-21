import { useToastStore, type ToastVariant } from '../stores/toast-store'

const VARIANT_STYLES: Record<ToastVariant, { bg: string; border: string; icon: string }> = {
  success: { bg: 'var(--accent-soft)', border: 'var(--good)', icon: '✓' },
  error: { bg: 'var(--surface-2)', border: 'var(--bad)', icon: '✕' },
  info: { bg: 'var(--surface-2)', border: 'var(--accent)', icon: 'ⓘ' },
}

export function ToastContainer() {
  const toasts = useToastStore(s => s.toasts)
  const dismiss = useToastStore(s => s.dismissToast)

  if (toasts.length === 0) return null

  return (
    <div
      className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none"
      style={{ maxWidth: '320px' }}
    >
      {toasts.map(t => {
        const style = VARIANT_STYLES[t.variant]
        return (
          <div
            key={t.id}
            onClick={() => dismiss(t.id)}
            className="pointer-events-auto cursor-pointer flex items-start gap-2 px-3 py-2 rounded-md border text-[12px] text-[var(--text)] shadow-md animate-toast-slide-in"
            style={{
              backgroundColor: style.bg,
              borderColor: style.border,
              borderLeftWidth: '3px',
            }}
          >
            <span
              className="text-[13px] flex-shrink-0 mt-[1px]"
              style={{ color: style.border }}
            >
              {style.icon}
            </span>
            <span className="flex-1 break-words">{t.message}</span>
          </div>
        )
      })}
    </div>
  )
}

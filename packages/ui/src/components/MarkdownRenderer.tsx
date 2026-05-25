import { useState, isValidElement, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { copyToClipboard } from '../lib/clipboard'

/**
 * react-markdown sometimes hands `code` an array of children (raw text mixed
 * with already-parsed React elements from rehype-highlight). String(arr)
 * collapses that into a comma-joined "[object Object]" mess. Walk the tree
 * and concatenate only the textual leaves.
 */
function extractText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (isValidElement(node)) {
    return extractText((node.props as { children?: ReactNode }).children)
  }
  return ''
}

interface Props {
  content: string
}

function CodeBlock({ className, children }: { className?: string; children: string }) {
  const [copied, setCopied] = useState(false)
  const language = className?.replace('language-', '') || ''

  const handleCopy = () => {
    copyToClipboard(children)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="relative my-3 border border-[var(--border)] bg-[var(--surface-2)] rounded-[8px] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1 border-b border-[var(--border)] text-[10px] uppercase tracking-wider text-[var(--muted)]">
        <span>{language || 'code'}</span>
        <button
          onClick={handleCopy}
          className="text-[var(--muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
          aria-label="Copy code"
        >
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed">
        <code className={className}>{children}</code>
      </pre>
    </div>
  )
}

export function MarkdownRenderer({ content }: Props) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      className="prose"
      components={{
        code(props: ComponentPropsWithoutRef<'code'>) {
          const { className, children, ...rest } = props
          const text = extractText(children)
          const trimmed = text.trim()
          const looksStructured = /^[{\[]/.test(trimmed) && /[}\]]\s*$/.test(trimmed)
          const isBlock =
            className?.startsWith('language-') ||
            text.includes('\n') ||
            text.length > 120 ||
            (looksStructured && text.length > 60)

          if (isBlock) {
            return <CodeBlock className={className}>{text.replace(/\n$/, '')}</CodeBlock>
          }

          return (
            <code
              className="bg-[var(--surface-2)] text-[var(--text)] px-1.5 py-0.5 text-[0.85em] border border-[var(--border)] rounded-[4px]"
              style={{
                fontFamily: 'var(--font-mono)',
                boxDecorationBreak: 'clone',
                WebkitBoxDecorationBreak: 'clone',
              }}
              {...rest}
            >
              {children}
            </code>
          )
        },
        pre({ children }) {
          return <>{children}</>
        },
        a({ href, children }) {
          const handleClick = (e: React.MouseEvent) => {
            e.preventDefault()
            if (href && (window as any).electronAPI?.openExternal) {
              ;(window as any).electronAPI.openExternal(href)
            } else if (href) {
              window.open(href, '_blank', 'noopener')
            }
          }
          return (
            <a
              href={href}
              onClick={handleClick}
              className="text-[var(--accent)] underline underline-offset-2 hover:opacity-80 transition-colors"
            >
              {children}
            </a>
          )
        },
        table({ children }) {
          return (
            <div className="overflow-x-auto my-3">
              <table className="w-full border-collapse border border-[var(--border)] text-xs">
                {children}
              </table>
            </div>
          )
        },
        th({ children }) {
          return (
            <th className="border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-left text-[var(--text)] font-medium">
              {children}
            </th>
          )
        },
        td({ children }) {
          return (
            <td className="border border-[var(--border)] px-3 py-1.5">{children}</td>
          )
        },
        blockquote({ children }) {
          return (
            <blockquote className="border-l-2 border-[var(--border-strong)] pl-3 my-2 text-[var(--muted)]">
              {children}
            </blockquote>
          )
        },
        h1({ children }) {
          return <h1 className="text-xl font-bold mt-4 mb-2 text-[var(--text)]" style={{ fontFamily: 'var(--font-serif)' }}>{children}</h1>
        },
        h2({ children }) {
          return <h2 className="text-lg font-bold mt-3 mb-2 text-[var(--text)]" style={{ fontFamily: 'var(--font-serif)' }}>{children}</h2>
        },
        h3({ children }) {
          return <h3 className="text-base font-bold mt-2 mb-1 text-[var(--text)]" style={{ fontFamily: 'var(--font-serif)' }}>{children}</h3>
        },
        ul({ children }) {
          return <ul className="list-disc list-inside my-2 space-y-1">{children}</ul>
        },
        ol({ children }) {
          return <ol className="list-decimal list-inside my-2 space-y-1">{children}</ol>
        },
        hr() {
          return <hr className="border-[var(--border)] my-4" />
        },
      }}
    >
      {content}
    </ReactMarkdown>
  )
}

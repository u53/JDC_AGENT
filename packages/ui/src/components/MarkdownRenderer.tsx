import { isValidElement, memo, useState, type ComponentPropsWithoutRef, type KeyboardEvent, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { IconChevronDown, IconChevronRight } from './icons'
import {
  createMarkdownCodeBlockKey,
  getRememberedCodeExpansion,
  rememberCodeExpansion,
} from './markdown-code-state'
import { ToolCopyButton } from './tool-cards/ToolCopyButton'

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
  defaultCodeExpanded?: boolean
}

function codeLineCount(text: string): number {
  return Math.max(1, text.split('\n').length)
}

function codePreview(text: string): string {
  const firstMeaningfulLine = text.split('\n').find((line) => line.trim()) || ''
  return firstMeaningfulLine.trim().slice(0, 120)
}

function CodeBlock({
  className,
  copyText,
  defaultExpanded = false,
  positionKey = '',
  children,
}: {
  className?: string
  copyText: string
  defaultExpanded?: boolean
  positionKey?: string
  children: ReactNode
}) {
  const language = className?.match(/language-([\w-]+)/)?.[1] || ''
  const blockKey = createMarkdownCodeBlockKey(language, copyText, positionKey)
  const [expanded, setExpanded] = useState(() => getRememberedCodeExpansion(blockKey, defaultExpanded))
  const lines = codeLineCount(copyText)
  const preview = codePreview(copyText)
  const toggle = () => {
    setExpanded((value) => {
      const next = !value
      rememberCodeExpansion(blockKey, next)
      return next
    })
  }

  const handleToggleKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      toggle()
    }
  }

  return (
    <div className="markdown-code-block relative my-3 overflow-hidden" data-expanded={expanded ? 'true' : 'false'}>
      <div className="markdown-code-head">
        <button
          type="button"
          className="markdown-code-toggle"
          aria-expanded={expanded}
          onClick={toggle}
          onKeyDown={handleToggleKey}
        >
          <span className="markdown-code-chevron">
            {expanded ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
          </span>
          <span className="markdown-code-lang">{language || 'code'}</span>
          <span className="markdown-code-lines">{lines} {lines === 1 ? 'line' : 'lines'}</span>
          {!expanded && preview && <span className="markdown-code-preview">{preview}</span>}
        </button>
        <ToolCopyButton
          text={copyText}
          label="Copy"
          copiedLabel="Copied"
          title="Copy code"
          toastLabel="Code"
          className="markdown-code-copy"
        />
      </div>
      {expanded && (
        <pre className="markdown-code-pre overflow-x-auto">
          <code className={className}>{children}</code>
        </pre>
      )}
    </div>
  )
}

function MarkdownRendererView({ content, defaultCodeExpanded = false }: Props) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      className="prose"
      components={{
        code(props: ComponentPropsWithoutRef<'code'> & { node?: { position?: { start?: { line?: number; column?: number; offset?: number } } } }) {
          const { className, children, node, ...rest } = props
          const text = extractText(children)
          const start = node?.position?.start
          const positionKey = start ? `${start.offset ?? ''}:${start.line ?? ''}:${start.column ?? ''}` : ''
          const trimmed = text.trim()
          const looksStructured = /^[{\[]/.test(trimmed) && /[}\]]\s*$/.test(trimmed)
          const isBlock =
            className?.includes('language-') ||
            className?.includes('hljs') ||
            text.includes('\n') ||
            text.length > 120 ||
            (looksStructured && text.length > 60)

          if (isBlock) {
            return (
              <CodeBlock
                className={className}
                copyText={text.replace(/\n$/, '')}
                defaultExpanded={defaultCodeExpanded}
                positionKey={positionKey}
              >
                {children}
              </CodeBlock>
            )
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

export const MarkdownRenderer = memo(MarkdownRendererView)

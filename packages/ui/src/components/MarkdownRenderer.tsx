import { useState, type ComponentPropsWithoutRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

interface Props {
  content: string
}

function CodeBlock({ className, children }: { className?: string; children: string }) {
  const [copied, setCopied] = useState(false)
  const language = className?.replace('language-', '') || ''

  const handleCopy = () => {
    navigator.clipboard.writeText(children)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="relative my-3 border border-[#333] bg-[#050505]">
      <div className="flex items-center justify-between px-3 py-1 border-b border-[#333] text-[10px] uppercase tracking-wider text-[#666]">
        <span>{language || 'code'}</span>
        <button
          onClick={handleCopy}
          className="text-[#666] hover:text-[#4AF626] transition-colors cursor-pointer"
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
      components={{
        code(props: ComponentPropsWithoutRef<'code'>) {
          const { className, children, ...rest } = props
          const isBlock = className?.startsWith('language-') || (typeof children === 'string' && children.includes('\n'))

          if (isBlock) {
            const text = String(children).replace(/\n$/, '')
            return <CodeBlock className={className}>{text}</CodeBlock>
          }

          return (
            <code
              className="bg-[#1a1a1a] text-[#4AF626] px-1.5 py-0.5 text-[0.85em] border border-[#333]"
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
              className="text-[#4AF626] underline underline-offset-2 hover:text-[#6fff4a] transition-colors"
            >
              {children}
            </a>
          )
        },
        table({ children }) {
          return (
            <div className="overflow-x-auto my-3">
              <table className="w-full border-collapse border border-[#333] text-xs">
                {children}
              </table>
            </div>
          )
        },
        th({ children }) {
          return (
            <th className="border border-[#333] bg-[#111] px-3 py-1.5 text-left text-[#4AF626] font-medium">
              {children}
            </th>
          )
        },
        td({ children }) {
          return (
            <td className="border border-[#333] px-3 py-1.5">{children}</td>
          )
        },
        blockquote({ children }) {
          return (
            <blockquote className="border-l-2 border-[#4AF626] pl-3 my-2 text-[#999]">
              {children}
            </blockquote>
          )
        },
        h1({ children }) {
          return <h1 className="text-xl font-bold mt-4 mb-2 text-[#EAEAEA]">{children}</h1>
        },
        h2({ children }) {
          return <h2 className="text-lg font-bold mt-3 mb-2 text-[#EAEAEA]">{children}</h2>
        },
        h3({ children }) {
          return <h3 className="text-base font-bold mt-2 mb-1 text-[#EAEAEA]">{children}</h3>
        },
        ul({ children }) {
          return <ul className="list-disc list-inside my-2 space-y-1">{children}</ul>
        },
        ol({ children }) {
          return <ol className="list-decimal list-inside my-2 space-y-1">{children}</ol>
        },
        hr() {
          return <hr className="border-[#333] my-4" />
        },
      }}
    >
      {content}
    </ReactMarkdown>
  )
}

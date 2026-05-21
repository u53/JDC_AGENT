import { useState, useMemo } from 'react'
import type { DiffLine, InlineDiffSegment } from './shared'
import { computeInlineDiff } from './shared'

interface DiffViewProps {
  diffLines: DiffLine[]
}

type ViewMode = 'unified' | 'split'

export function DiffView({ diffLines }: DiffViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('unified')

  if (diffLines.length === 0) return null

  return (
    <div className="text-[12px]" style={{ fontFamily: 'var(--font-mono)' }}>
      <div className="flex items-center gap-2 pb-2 border-b border-[var(--border)] mb-2">
        <button
          className="px-2 py-0.5 rounded text-[11px] transition-colors"
          style={viewMode === 'unified' ? { background: 'var(--accent)', color: 'var(--accent-ink)' } : { color: 'var(--muted)' }}
          onClick={(e) => { e.stopPropagation(); setViewMode('unified') }}
        >
          对照
        </button>
        <button
          className="px-2 py-0.5 rounded text-[11px] transition-colors"
          style={viewMode === 'split' ? { background: 'var(--accent)', color: 'var(--accent-ink)' } : { color: 'var(--muted)' }}
          onClick={(e) => { e.stopPropagation(); setViewMode('split') }}
        >
          并排
        </button>
      </div>
      <div className="max-h-[400px] overflow-auto">
        {viewMode === 'unified'
          ? <UnifiedView diffLines={diffLines} />
          : <SplitView diffLines={diffLines} />
        }
      </div>
    </div>
  )
}

function InlineHighlight({ segments, type }: { segments: InlineDiffSegment[]; type: 'add' | 'remove' }) {
  const highlightStyle = type === 'add'
    ? { borderBottom: '1.5px solid var(--good)', paddingBottom: '1px' }
    : { borderBottom: '1.5px solid var(--bad)', paddingBottom: '1px' }
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === 'common') return <span key={i}>{seg.value}</span>
        return <span key={i} style={highlightStyle}>{seg.value}</span>
      })}
    </>
  )
}

function SplitView({ diffLines }: { diffLines: DiffLine[] }) {
  const rows = useMemo(() => buildSplitRows(diffLines), [diffLines])

  return (
    <table className="w-full border-collapse table-fixed">
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {/* Left (old) */}
            <td className="select-none text-right pr-1 w-[30px] align-top" style={{ color: 'var(--muted)', opacity: 0.5 }}>
              {row.left?.oldLineNum ?? ''}
            </td>
            <td
              className="w-[50%] whitespace-pre-wrap break-all pl-1 align-top"
              style={row.left?.type === 'remove' ? { color: 'var(--bad)' } : { color: 'var(--muted)' }}
            >
              {row.left?.content ?? ''}
            </td>
            {/* Right (new) */}
            <td className="select-none text-right pr-1 w-[30px] align-top border-l border-[var(--border)]" style={{ color: 'var(--muted)', opacity: 0.5 }}>
              {row.right?.newLineNum ?? ''}
            </td>
            <td
              className="w-[50%] whitespace-pre-wrap break-all pl-1 align-top"
              style={row.right?.type === 'add' ? { color: 'var(--good)' } : { color: 'var(--muted)' }}
            >
              {row.right?.content ?? ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function UnifiedView({ diffLines }: { diffLines: DiffLine[] }) {
  const inlinePairs = useMemo(() => computeInlinePairs(diffLines), [diffLines])

  return (
    <table className="w-full border-collapse">
      <tbody>
        {diffLines.map((line, i) => {
          const textColor = line.type === 'add'
            ? 'var(--good)'
            : line.type === 'remove'
            ? 'var(--bad)'
            : 'var(--muted)'
          const prefix = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '
          const inlineData = inlinePairs.get(i)

          return (
            <tr key={i}>
              <td className="select-none text-right pr-1 w-[30px] align-top" style={{ color: 'var(--muted)', opacity: 0.5 }}>
                {line.oldLineNum ?? ''}
              </td>
              <td className="select-none text-right pr-1 w-[30px] align-top" style={{ color: 'var(--muted)', opacity: 0.5 }}>
                {line.newLineNum ?? ''}
              </td>
              <td className="select-none w-[14px] text-center" style={{ color: textColor }}>{prefix}</td>
              <td className="whitespace-pre-wrap break-all pl-1" style={{ color: textColor }}>
                {inlineData
                  ? <InlineHighlight segments={inlineData} type={line.type as 'add' | 'remove'} />
                  : line.content
                }
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/** Pair adjacent remove+add lines and compute inline (word-level) diff */
function computeInlinePairs(lines: DiffLine[]): Map<number, InlineDiffSegment[]> {
  const map = new Map<number, InlineDiffSegment[]>()
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i]!.type === 'remove' && lines[i + 1]!.type === 'add') {
      const { oldSegments, newSegments } = computeInlineDiff(lines[i]!.content, lines[i + 1]!.content)
      map.set(i, oldSegments)
      map.set(i + 1, newSegments)
      i++ // skip next
    }
  }
  return map
}

interface SplitRow {
  left: DiffLine | null
  right: DiffLine | null
}

/** Build side-by-side rows from unified diff lines */
function buildSplitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (line.type === 'context') {
      rows.push({ left: line, right: line })
      i++
    } else if (line.type === 'remove') {
      const removes: DiffLine[] = []
      while (i < lines.length && lines[i]!.type === 'remove') {
        removes.push(lines[i]!)
        i++
      }
      const adds: DiffLine[] = []
      while (i < lines.length && lines[i]!.type === 'add') {
        adds.push(lines[i]!)
        i++
      }
      const maxLen = Math.max(removes.length, adds.length)
      for (let j = 0; j < maxLen; j++) {
        rows.push({
          left: j < removes.length ? removes[j]! : null,
          right: j < adds.length ? adds[j]! : null,
        })
      }
    } else {
      rows.push({ left: null, right: line })
      i++
    }
  }
  return rows
}

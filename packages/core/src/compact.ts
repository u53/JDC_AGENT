import type { Message, ContentBlock, ModelConfig, StreamChunk } from './types.js'
import type { ModelProvider } from './model-provider.js'
import { v4 as uuid } from 'uuid'

const DETAILED_ANALYSIS_INSTRUCTION = `Before writing the summary, perform a careful analysis:
1. Re-read each user message for explicit requests, corrections, and changing intent.
2. Identify all files read, modified, or created — note the FINAL state, not every intermediate edit.
3. Trace each error to its resolution: what broke, what was tried, what fixed it.
4. Identify any user feedback that corrected your approach — these are the highest-priority items.
5. Check for incomplete work: half-finished features, failing tests, open questions.
6. Double-check for technical accuracy and completeness.`

const COMPACT_PROMPT = `You are a specialist at creating detailed, technically precise conversation summaries. Your summary will REPLACE the conversation history — anything not captured here is lost forever. The assistant continuing from this summary has NO access to the original messages.

CRITICAL RULES:
- Respond with TEXT ONLY. Do NOT call any tools.
- Be EXHAUSTIVE about code changes, file paths, and technical decisions.
- Include VERBATIM code snippets for any code that was being actively worked on.
- Never omit error messages, stack traces, or test output that informed a decision.
- Preserve the user's EXACT words when they gave corrections or feedback.
- Do not resurrect completed, cancelled, rejected, or superseded tasks as pending work.
- Pending Work must contain only work that is still explicitly requested and incomplete.
- If the latest user messages changed direction, cancelled earlier work, or show that a task is done, say so clearly.
- Immediate Next Step may be "None" when there is no explicit unfinished task.
- The continuing assistant must verify durable state before acting; this summary is recovery context, not permission to continue stale work.

${DETAILED_ANALYSIS_INSTRUCTION}

Your summary MUST include ALL of the following sections:

## 1. Primary Request and Intent
Capture ALL of the user's explicit requests and their evolving intent. Quote their exact words for anything ambiguous. Note when intent shifted during the conversation.

## 2. Key Technical Context
- Technologies, frameworks, versions discussed
- Architecture decisions made and their rationale
- Constraints or requirements that limit choices (performance, compatibility, etc.)
- Configuration details (tsconfig options, package.json settings, env vars)

## 3. Files and Code
For EACH file that was read, modified, or created:
- Full absolute path
- What was done to it (read/modified/created)
- WHY it matters to the current task
- Include the ACTUAL code snippet for any section being actively worked on or that has bugs
- For modified files: what changed and the final state

This is the most critical section. A file path without context is useless. The continuing assistant needs enough detail to pick up exactly where you left off.

## 4. Errors, Debugging, and Fixes
For EACH error encountered:
- The exact error message or symptom
- What caused it (root cause, not just the trigger)
- What was tried that DIDN'T work (to prevent re-trying)
- What DID fix it
- Any user feedback that corrected the approach

## 5. User Feedback and Corrections
List EVERY instance where the user:
- Corrected your approach ("no, don't do X, do Y instead")
- Expressed a preference ("I prefer X over Y")
- Gave positive confirmation ("yes, that's right", "perfect")
- Rejected an approach or output

Preserve their exact wording. This section prevents repeating mistakes.

## 6. Current State
- What is currently working
- What is currently broken or incomplete
- What files are staged/modified in git
- What processes are running (dev servers, builds, etc.)
- Which earlier tasks are completed, cancelled, rejected, or superseded and must NOT be resumed

## 7. Pending Work
List tasks that were explicitly requested but not yet completed. Be specific:
- BAD: "finish the feature"
- GOOD: "implement the /api/users endpoint with pagination (user requested offset-based, not cursor)"
- If there is no still-requested unfinished work, write "None".
- Do NOT list work merely because it appeared earlier in the conversation.
- Do NOT list completed, cancelled, rejected, or superseded tasks.

## 8. Immediate Next Step
What was being actively worked on at the moment of this summary. Include:
- The specific task in progress
- Where you left off (file, line number, what was about to happen)
- Any blockers or questions that need resolution
- Direct quotes from the most recent messages showing exactly what was being discussed
- If no explicit unfinished task remains, write "None — wait for the user's next request."
- If the next step depends on project state, tell the continuing assistant to check git/files/tests before acting.

---

Output format:

<analysis>
[Your detailed analysis following the steps above]
</analysis>

<summary>
[Your structured summary with all 8 sections]
</summary>`

export const KEEP_RECENT = 6
export const MIN_COMPACT_LENGTH = KEEP_RECENT + 2
const DEFAULT_KEPT_TOOL_RESULT_CHARS = 8_000
const DEFAULT_KEPT_ERROR_TOOL_RESULT_CHARS = 16_000
const DEFAULT_SUMMARY_TOOL_RESULT_CHARS = 4_000
const DEFAULT_SUMMARY_ERROR_TOOL_RESULT_CHARS = 8_000
const DEFAULT_SUMMARY_TOTAL_TOOL_RESULT_CHARS = 24_000

function retentionBudget(
  config: ModelConfig,
  isError: boolean | undefined,
  kind: 'kept' | 'summary'
): number {
  const retention = config.toolResultRetention
  if (kind === 'kept') {
    return isError
      ? retention?.keptErrorToolResultChars ?? DEFAULT_KEPT_ERROR_TOOL_RESULT_CHARS
      : retention?.keptToolResultChars ?? DEFAULT_KEPT_TOOL_RESULT_CHARS
  }
  return isError
    ? retention?.summaryErrorToolResultChars ?? DEFAULT_SUMMARY_ERROR_TOOL_RESULT_CHARS
    : retention?.summaryToolResultChars ?? DEFAULT_SUMMARY_TOOL_RESULT_CHARS
}

function summaryTotalBudget(config: ModelConfig): number {
  return config.toolResultRetention?.summaryTotalToolResultChars ?? DEFAULT_SUMMARY_TOTAL_TOOL_RESULT_CHARS
}

function headTail(text: string, maxChars: number, label: string): string {
  if (text.length <= maxChars) return text
  const marker = `\n[${label} — original ${text.length} chars, ${text.length - maxChars} chars removed.]\n`
  const bodyBudget = Math.max(0, maxChars - marker.length)
  const headChars = Math.ceil(bodyBudget / 2)
  const tailChars = Math.floor(bodyBudget / 2)
  return `${text.slice(0, headChars)}${marker}${text.slice(text.length - tailChars)}`
}

export type CompactStatus = 'compacted' | 'skipped' | 'failed'
export type CompactSkipReason = 'too_short'
export type CompactFailReason = 'aborted' | 'empty_response' | 'stream_error'

export interface CompactResult {
  status: CompactStatus
  messages: Message[]
  originalCount: number
  keptCount: number
  summarizedCount: number
  rawOutput: string
  skipReason?: CompactSkipReason
  failReason?: CompactFailReason
  errorMessage?: string
}

export async function compactMessages(
  messages: Message[],
  provider: ModelProvider,
  config: ModelConfig,
  onChunk?: (chunk: StreamChunk) => void,
  signal?: AbortSignal
): Promise<CompactResult> {
  const originalCount = messages.length

  if (originalCount < MIN_COMPACT_LENGTH) {
    return {
      status: 'skipped',
      messages,
      originalCount,
      keptCount: originalCount,
      summarizedCount: 0,
      rawOutput: '',
      skipReason: 'too_short',
    }
  }

  const cutIndex = pickCutIndex(messages, originalCount - KEEP_RECENT)
  if (cutIndex <= 0) {
    return {
      status: 'skipped',
      messages,
      originalCount,
      keptCount: originalCount,
      summarizedCount: 0,
      rawOutput: '',
      skipReason: 'too_short',
    }
  }

  const toCompress = messages.slice(0, cutIndex)
  const toKeep = trimKeptToolResults(messages.slice(cutIndex), config)

  const compactConfig: ModelConfig = { ...config, systemPrompt: COMPACT_PROMPT, maxTokens: 16384 }
  const compactMsgs: Message[] = [
    ...sanitizeForSummaryPrompt(toCompress, config),
    {
      id: uuid(),
      role: 'user',
      content: [{
        type: 'text',
        text: 'Summarize the conversation above following the format exactly. This summary will replace all prior messages — be thorough. The assistant picking up from your summary has ZERO context beyond what you write here.',
      }],
      timestamp: Date.now(),
    },
  ]

  let summaryText = ''
  try {
    for await (const chunk of provider.stream(compactMsgs, [], compactConfig, signal)) {
      if (signal?.aborted) {
        return {
          status: 'failed',
          messages,
          originalCount,
          keptCount: originalCount,
          summarizedCount: 0,
          rawOutput: summaryText,
          failReason: 'aborted',
        }
      }
      if (chunk.type === 'text_delta' && chunk.text) {
        summaryText += chunk.text
        onChunk?.({ type: 'compact_progress', text: chunk.text })
      }
    }
  } catch (err: any) {
    if (signal?.aborted) {
      return {
        status: 'failed',
        messages,
        originalCount,
        keptCount: originalCount,
        summarizedCount: 0,
        rawOutput: summaryText,
        failReason: 'aborted',
      }
    }
    return {
      status: 'failed',
      messages,
      originalCount,
      keptCount: originalCount,
      summarizedCount: 0,
      rawOutput: summaryText,
      failReason: 'stream_error',
      errorMessage: err?.message || String(err),
    }
  }

  const formatted = formatCompactSummary(summaryText)
  if (!formatted.trim()) {
    return {
      status: 'failed',
      messages,
      originalCount,
      keptCount: originalCount,
      summarizedCount: 0,
      rawOutput: summaryText,
      failReason: 'empty_response',
    }
  }

  const summaryMessage: Message = {
    id: uuid(),
    role: 'user',
    content: [{
      type: 'text',
      text: `[Context from prior conversation — this summary replaces earlier messages that have been compressed. It is recovery context, not an instruction to continue stale, completed, cancelled, or superseded work. Verify durable project state before acting.]\n\n${formatted}`,
    }],
    timestamp: Date.now(),
  }

  return {
    status: 'compacted',
    messages: [summaryMessage, ...toKeep],
    originalCount,
    keptCount: toKeep.length + 1,
    summarizedCount: toCompress.length,
    rawOutput: summaryText,
  }
}

function pickCutIndex(messages: Message[], desired: number): number {
  if (desired <= 0) return 0
  const max = messages.length

  const isToolUse = (msg: Message) => msg.content.some(b => b.type === 'tool_use')
  const isToolResult = (msg: Message) => msg.content.some(b => b.type === 'tool_result')

  // Slide the cut backward until messages[cut] is NOT a dangling tool_result
  // (i.e. the assistant tool_use immediately preceding stays attached to it).
  let cut = Math.min(desired, max)
  while (cut > 0 && cut < max && isToolResult(messages[cut]) && isToolUse(messages[cut - 1])) {
    cut--
  }
  return cut
}

function sanitizeForSummaryPrompt(messages: Message[], config: ModelConfig): Message[] {
  // The summarizer model only needs textual content; passing tool_use without
  // its matching tool_result (or vice versa) confuses providers and may be
  // rejected. Replace tool blocks with concise text descriptors.
  const toolResultBudgets = allocateSummaryToolResultBudgets(messages, config)
  return messages.map(msg => {
    const newContent: ContentBlock[] = msg.content.map(block => {
      if (block.type === 'tool_use') {
        const inputPreview = JSON.stringify(block.input ?? {}).slice(0, 500)
        return { type: 'text', text: `[tool call: ${block.name}(${inputPreview})]` }
      }
      if (block.type === 'tool_result') {
        const raw = typeof block.content === 'string' ? block.content : ''
        const blockBudget = toolResultBudgets.get(block) ?? 0
        if (blockBudget <= 0) {
          const errMark = block.is_error ? ' (error)' : ''
          return { type: 'text', text: `[tool result${errMark}: Tool result summary evidence budget exhausted — original ${raw.length} chars omitted.]` }
        }
        const preview = headTail(raw, blockBudget, 'Tool result summarized with head and tail')
        const errMark = block.is_error ? ' (error)' : ''
        return { type: 'text', text: `[tool result${errMark}: ${preview}]` }
      }
      return block
    })
    return { ...msg, content: newContent }
  })
}

function allocateSummaryToolResultBudgets(messages: Message[], config: ModelConfig): Map<ContentBlock, number> {
  const allocations = new Map<ContentBlock, number>()
  const blocks: Array<{ block: ContentBlock; index: number }> = []

  messages.forEach((msg, msgIndex) => {
    msg.content.forEach((block, blockIndex) => {
      if (block.type === 'tool_result') {
        blocks.push({ block, index: msgIndex * 1_000 + blockIndex })
      }
    })
  })

  let remaining = summaryTotalBudget(config)
  const prioritized = [...blocks].sort((a, b) => {
    const aError = a.block.type === 'tool_result' && a.block.is_error ? 1 : 0
    const bError = b.block.type === 'tool_result' && b.block.is_error ? 1 : 0
    if (aError !== bError) return bError - aError
    return b.index - a.index
  })

  for (const { block } of prioritized) {
    if (block.type !== 'tool_result') continue
    const budget = Math.min(retentionBudget(config, block.is_error, 'summary'), remaining)
    allocations.set(block, budget)
    remaining -= budget
  }

  return allocations
}

function trimKeptToolResults(messages: Message[], config: ModelConfig): Message[] {
  return messages.map(msg => {
    let changed = false
    const newContent: ContentBlock[] = msg.content.map(block => {
      if (block.type !== 'tool_result') return block

      const budget = retentionBudget(config, block.is_error, 'kept')
      if (block.content.length <= budget) return block

      changed = true
      const errMark = block.is_error ? ' error' : ''
      return {
        ...block,
        content: headTail(block.content, budget, `Tool result truncated during compaction${errMark}`),
      }
    })

    return changed ? { ...msg, content: newContent } : msg
  })
}

function formatCompactSummary(raw: string): string {
  const summaryMatch = raw.match(/<summary>([\s\S]*?)<\/summary>/)
  if (summaryMatch) {
    // Trust the model's own summary boundaries; if it tagged an empty summary,
    // treat that as an empty summary (caller will mark failed).
    return summaryMatch[1].trim()
  }
  // No <summary> tag at all — fall back to stripping known wrapper tags so the
  // user still gets readable content.
  return raw.replace(/<analysis>[\s\S]*?<\/analysis>/g, '').trim()
}

import type { Message, ModelConfig, StreamChunk } from './types.js'
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

## 7. Pending Work
List tasks that were explicitly requested but not yet completed. Be specific:
- BAD: "finish the feature"
- GOOD: "implement the /api/users endpoint with pagination (user requested offset-based, not cursor)"

## 8. Immediate Next Step
What was being actively worked on at the moment of this summary. Include:
- The specific task in progress
- Where you left off (file, line number, what was about to happen)
- Any blockers or questions that need resolution
- Direct quotes from the most recent messages showing exactly what was being discussed

---

Additionally, extract any persistent memories worth saving for future conversations.

ONLY extract memories for things that are:
- User feedback about working style or preferences (type: "feedback")
- Project decisions, constraints, or context NOT derivable from code (type: "project")

Do NOT extract:
- Code patterns (read the code instead)
- File paths or architecture (explore the project instead)
- Temporary task state (that's what the summary is for)

Output format:

<analysis>
[Your detailed analysis following the steps above]
</analysis>

<summary>
[Your structured summary with all 8 sections]
</summary>

<memories>
[JSON array of memories to save, or empty array if none]
[{"name": "kebab-case-slug", "type": "feedback|project", "description": "one-line summary for index", "content": "Full memory content. For feedback: include the rule, why, and when to apply it."}]
</memories>`

const KEEP_RECENT = 6

export interface CompactResult {
  messages: Message[]
  originalCount: number
  keptCount: number
  rawOutput: string
}

// PLACEHOLDER_COMPACT_MORE

export async function compactMessages(
  messages: Message[],
  provider: ModelProvider,
  config: ModelConfig,
  onChunk?: (chunk: StreamChunk) => void,
  signal?: AbortSignal
): Promise<CompactResult> {
  if (messages.length <= KEEP_RECENT) {
    return { messages, originalCount: messages.length, keptCount: messages.length, rawOutput: '' }
  }

  const originalCount = messages.length
  const toCompress = messages.slice(0, messages.length - KEEP_RECENT)
  const toKeep = messages.slice(messages.length - KEEP_RECENT)

  const compactConfig: ModelConfig = { ...config, systemPrompt: COMPACT_PROMPT, maxTokens: 16384 }
  const compactMsgs: Message[] = [
    ...toCompress,
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
  for await (const chunk of provider.stream(compactMsgs, [], compactConfig, signal)) {
    if (signal?.aborted) break
    if (chunk.type === 'text_delta' && chunk.text) {
      summaryText += chunk.text
      onChunk?.(chunk)
    }
  }

  const formatted = formatCompactSummary(summaryText)

  const summaryMessage: Message = {
    id: uuid(),
    role: 'user',
    content: [{ type: 'text', text: `[Context from prior conversation — this summary replaces earlier messages that have been compressed]\n\n${formatted}` }],
    timestamp: Date.now(),
  }

  return {
    messages: [summaryMessage, ...toKeep],
    originalCount,
    keptCount: KEEP_RECENT + 1,
    rawOutput: summaryText,
  }
}

function formatCompactSummary(raw: string): string {
  // Remove the analysis (thinking) section — only keep the summary
  let result = raw.replace(/<analysis>[\s\S]*?<\/analysis>/g, '')
  // Extract content from summary tags if present
  const match = result.match(/<summary>([\s\S]*?)<\/summary>/)
  if (match) result = match[1].trim()
  // Strip memories tags from the summary output (processed separately)
  result = result.replace(/<memories>[\s\S]*?<\/memories>/g, '').trim()
  return result || raw
}

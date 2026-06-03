import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertCitationsValid,
  containsRawReasoningCitation,
  validateCitation,
  validateCitations,
} from './citations.js'

const message = { id: 'msg_1', role: 'user' as const, content: [{ type: 'text' as const, text: 'Remember this.' }], timestamp: 1 }
const toolEvent = { id: 'tool_1', name: 'Read', status: 'completed' }
const gitEvidence = { id: 'git_1', ref: 'commit:abc123', hash: 'abc123' }
const memoryRecord = { id: 'memory_1' }

describe('context citation validation', () => {
  it('validates files, messages, tool events, git evidence, and accepted memories against provided sources', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'jdc-context-citations-'))
    writeFileSync(join(cwd, 'existing.ts'), 'export const ok = true\n')

    const result = validateCitations(
      [
        { id: 'file_cit', type: 'file', ref: 'existing.ts' },
        { id: 'message_cit', type: 'message', ref: 'msg_1' },
        { id: 'tool_cit', type: 'tool_event', ref: 'tool_1' },
        { id: 'git_cit', type: 'git', ref: 'commit:abc123', hash: 'abc123' },
        { id: 'memory_cit', type: 'memory', ref: 'memory_1' },
      ],
      { cwd, messages: [message], toolEvents: [toolEvent], gitEvidence: [gitEvidence], memoryRecords: [memoryRecord] }
    )

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
    expect(assertCitationsValid([{ id: 'message_cit', type: 'message', ref: 'msg_1' }], { messages: [message] }).valid).toBe(true)
  })

  it('rejects missing citations, missing source references, hash mismatches, and raw reasoning evidence', () => {
    expect(validateCitations([], {}).valid).toBe(false)
    expect(validateCitation({ id: 'file_cit', type: 'file', ref: 'missing.ts' }, { cwd: tmpdir() }).valid).toBe(false)
    expect(validateCitation({ id: 'message_cit', type: 'message', ref: 'missing' }, { messages: [message] }).valid).toBe(false)
    expect(validateCitation({ id: 'tool_cit', type: 'tool_event', ref: 'missing' }, { toolEvents: [toolEvent] }).valid).toBe(false)
    expect(validateCitation({ id: 'git_cit', type: 'git', ref: 'commit:abc123', hash: 'wrong' }, { gitEvidence: [gitEvidence] }).valid).toBe(false)
    expect(validateCitation({ id: 'memory_cit', type: 'memory', ref: 'missing' }, { memoryRecords: [memoryRecord] }).valid).toBe(false)
    expect(validateCitation({ id: 'diagnostic_cit', type: 'diagnostic', ref: 'diag_1' }, {}).valid).toBe(false)
    expect(containsRawReasoningCitation([{ id: 'bad', type: 'thinking' as any, ref: 'raw' }])).toBe(true)
  })
})

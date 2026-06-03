import { describe, expect, it } from 'vitest'
import type { HarvestCandidate, RawEvidence } from './types.js'
import {
  containsSensitiveContext,
  redactForDurableStorage,
  redactHarvestCandidateForDistillation,
  redactRawEvidenceForDistillation,
  redactText,
} from './redaction.js'

const evidence: RawEvidence = {
  id: 'raw_1',
  sessionId: 'session_1',
  cwd: '/repo',
  sourceProvider: 'RuntimeProvider',
  kind: 'tool_event',
  content: 'OPENAI_API_KEY=sk-proj-1234567890abcdef1234567890abcdef',
  metadata: {
    request: {
      headers: { authorization: 'Bearer abcdef1234567890abcdef1234567890' },
      databaseUrl: 'postgres://user:super-secret-password@localhost:5432/app',
    },
  },
  capturedAt: 1,
  hash: 'hash_1',
}

const candidate: HarvestCandidate = {
  sessionId: 'session_1',
  runLoopId: 'run_1',
  userMessage: 'Please remember password = hunter2 for this test account.',
  assistantMessages: [
    {
      id: 'msg_1',
      role: 'assistant',
      content: [{ type: 'text', text: 'Use Authorization: Bearer zyxwvutsrqponmlkjihgfedcba123456.' }],
      timestamp: 1,
    },
  ],
  toolEvents: [{ id: 'tool_1', name: 'Bash', output: 'github_pat_1234567890abcdefghijklmnopqrstuvwxyz' }],
  changedFiles: [],
  createdAt: 1,
}

describe('context redaction', () => {
  it('redacts sensitive raw evidence content and metadata before distillation', () => {
    const result = redactRawEvidenceForDistillation(evidence)

    expect(result.redacted).toBe(true)
    expect(result.value.content).toBe('OPENAI_API_KEY=[REDACTED:secret]')
    expect(JSON.stringify(result.value.metadata)).not.toContain('abcdef1234567890')
    expect(JSON.stringify(result.value.metadata)).not.toContain('super-secret-password')
    expect(result.hits.map((hit) => hit.path)).toEqual(expect.arrayContaining(['content', 'metadata.request.headers.authorization', 'metadata.request.databaseUrl']))
    expect(result.value.id).toBe(evidence.id)
    expect(result.value.hash).toBe(evidence.hash)
  })

  it('redacts harvest candidates before they are sent to distillers', () => {
    const result = redactHarvestCandidateForDistillation(candidate)
    const serialized = JSON.stringify(result.value)

    expect(result.redacted).toBe(true)
    expect(serialized).not.toContain('hunter2')
    expect(serialized).not.toContain('zyxwvutsrqponmlkjihgfedcba123456')
    expect(serialized).not.toContain('github_pat_1234567890')
    expect(result.value.userMessage).toContain('[REDACTED:secret]')
    expect(result.hits.map((hit) => hit.path)).toEqual(expect.arrayContaining(['userMessage', 'assistantMessages.0.content.0.text', 'toolEvents.0.output']))
  })

  it('redacts quoted assigned secret values without redacting non-sensitive quoted text', () => {
    const text = [
      'API_KEY="quoted-api-secret"',
      "token='quoted-token-secret'",
      'password: "quoted-password-secret"',
      'secret = `quoted-template-secret`',
      'title = "release notes"',
      'status: "healthy"',
    ].join('\n')

    const result = redactText(text)

    expect(result.redacted).toBe(true)
    expect(result.value).toContain('API_KEY="[REDACTED:secret]"')
    expect(result.value).toContain("token='[REDACTED:secret]'")
    expect(result.value).toContain('password: "[REDACTED:secret]"')
    expect(result.value).toContain('secret = `[REDACTED:secret]`')
    expect(result.value).toContain('title = "release notes"')
    expect(result.value).toContain('status: "healthy"')
    expect(result.value).not.toContain('quoted-api-secret')
    expect(result.value).not.toContain('quoted-token-secret')
    expect(result.value).not.toContain('quoted-password-secret')
    expect(result.value).not.toContain('quoted-template-secret')
  })

  it('uses the same sensitive assignment keys for quoted and unquoted text secrets', () => {
    const text = [
      'bearer = "quoted-bearer-secret"',
      "cookie: 'quoted-cookie-secret'",
      'session_key=`quoted-session-secret`',
      'session-key = session-secret-123456',
      'bearer=bearer-secret-123456',
      'cookie: cookie-secret-123456',
      'comment = "cookie preferences are documented"',
    ].join('\n')

    const result = redactText(text)

    expect(result.redacted).toBe(true)
    expect(result.value).toContain('bearer = "[REDACTED:secret]"')
    expect(result.value).toContain("cookie: '[REDACTED:secret]'")
    expect(result.value).toContain('session_key=`[REDACTED:secret]`')
    expect(result.value).toContain('session-key = [REDACTED:secret]')
    expect(result.value).toContain('bearer=[REDACTED:secret]')
    expect(result.value).toContain('cookie: [REDACTED:secret]')
    expect(result.value).toContain('comment = "cookie preferences are documented"')
    expect(result.value).not.toContain('quoted-bearer-secret')
    expect(result.value).not.toContain('quoted-cookie-secret')
    expect(result.value).not.toContain('quoted-session-secret')
    expect(result.value).not.toContain('session-secret-123456')
    expect(result.value).not.toContain('bearer-secret-123456')
    expect(result.value).not.toContain('cookie-secret-123456')
    expect(containsSensitiveContext('session_key="quoted-session-secret"')).toBe(true)
    expect(containsSensitiveContext("cookie: 'quoted-cookie-secret'")).toBe(true)
    expect(containsSensitiveContext('bearer = "quoted-bearer-secret"')).toBe(true)
  })

  it('redacts quoted assigned secrets from durable storage payloads before persistence', () => {
    const storagePayload = {
      acceptedFact: {
        id: 'fact_1',
        kind: 'workflow_rule',
        scope: 'project',
        content: 'Production deploy uses password: "quoted-fact-secret".',
        citations: [{ id: 'cit_msg_1', type: 'message', ref: 'msg_1' }],
        confidence: 0.9,
        freshness: 'recent',
        sourceProvider: 'TestDistiller',
        createdAt: 1,
        updatedAt: 1,
      },
      rawEvidence: {
        id: 'raw_quoted',
        sessionId: 'session_1',
        cwd: '/repo',
        sourceProvider: 'RuntimeProvider',
        kind: 'tool_event',
        content: 'API_KEY="quoted-raw-secret"',
        metadata: { command: "token='quoted-metadata-secret'" },
        capturedAt: 1,
        hash: 'hash_quoted',
      },
      rejectedCandidateRetention: {
        status: 'rejected',
        candidate: {
          userMessage: 'Please remember client_secret = "quoted-rejected-secret".',
          assistantMessages: [],
          toolEvents: [{ id: 'tool_1', output: 'secret = `quoted-tool-secret`' }],
          changedFiles: [],
        },
      },
      diagnosticPayload: {
        level: 'warning',
        message: 'redaction diagnostic password: "quoted-diagnostic-secret"',
        payload: { raw: 'token="quoted-diagnostic-payload-secret"' },
      },
    }

    const result = redactForDurableStorage(storagePayload)
    const serialized = JSON.stringify(result.value)

    expect(result.redacted).toBe(true)
    expect(serialized).not.toContain('quoted-fact-secret')
    expect(serialized).not.toContain('quoted-raw-secret')
    expect(serialized).not.toContain('quoted-metadata-secret')
    expect(serialized).not.toContain('quoted-rejected-secret')
    expect(serialized).not.toContain('quoted-tool-secret')
    expect(serialized).not.toContain('quoted-diagnostic-secret')
    expect(serialized).not.toContain('quoted-diagnostic-payload-secret')
    expect(result.value.acceptedFact.content).toContain('password: "[REDACTED:secret]"')
    expect(result.value.rawEvidence.content).toBe('API_KEY="[REDACTED:secret]"')
    expect(result.value.rawEvidence.metadata.command).toBe("token='[REDACTED:secret]'")
    expect(result.value.rejectedCandidateRetention.candidate.userMessage).toContain('client_secret = "[REDACTED:secret]"')
    expect(result.value.rejectedCandidateRetention.candidate.toolEvents[0].output).toBe('secret = `[REDACTED:secret]`')
    expect(result.value.diagnosticPayload.message).toContain('password: "[REDACTED:secret]"')
    expect(result.value.diagnosticPayload.payload.raw).toBe('token="[REDACTED:secret]"')
    expect(result.hits.map((hit) => hit.path)).toEqual(
      expect.arrayContaining([
        'acceptedFact.content',
        'rawEvidence.content',
        'rawEvidence.metadata.command',
        'rejectedCandidateRetention.candidate.userMessage',
        'rejectedCandidateRetention.candidate.toolEvents.0.output',
        'diagnosticPayload.message',
        'diagnosticPayload.payload.raw',
      ])
    )
  })

  it('redacts quoted bearer, cookie, and session-key assignments from durable storage payloads', () => {
    const storagePayload = {
      acceptedFact: {
        id: 'fact_2',
        kind: 'workflow_rule',
        scope: 'project',
        content: 'Runtime notes include session_key="quoted-fact-session-secret".',
        citations: [{ id: 'cit_msg_1', type: 'message', ref: 'msg_1' }],
        confidence: 0.9,
        freshness: 'recent',
        sourceProvider: 'TestDistiller',
        createdAt: 1,
        updatedAt: 1,
      },
      rawEvidence: {
        id: 'raw_quoted_sensitive_keys',
        sessionId: 'session_1',
        cwd: '/repo',
        sourceProvider: 'RuntimeProvider',
        kind: 'tool_event',
        content: "cookie: 'quoted-raw-cookie-secret'",
        metadata: { command: 'bearer = "quoted-metadata-bearer-secret"' },
        capturedAt: 1,
        hash: 'hash_quoted_sensitive_keys',
      },
      rejectedCandidateRetention: {
        status: 'rejected',
        candidate: {
          userMessage: 'Please remember session-key = `quoted-rejected-session-secret`.',
          assistantMessages: [],
          toolEvents: [{ id: 'tool_1', output: 'cookie = "quoted-tool-cookie-secret"' }],
          changedFiles: [],
        },
      },
      diagnosticPayload: {
        level: 'warning',
        message: 'redaction diagnostic bearer: "quoted-diagnostic-bearer-secret"',
        payload: { raw: "session_key='quoted-diagnostic-session-secret'" },
      },
    }

    const result = redactForDurableStorage(storagePayload)
    const serialized = JSON.stringify(result.value)

    expect(result.redacted).toBe(true)
    expect(serialized).not.toContain('quoted-fact-session-secret')
    expect(serialized).not.toContain('quoted-raw-cookie-secret')
    expect(serialized).not.toContain('quoted-metadata-bearer-secret')
    expect(serialized).not.toContain('quoted-rejected-session-secret')
    expect(serialized).not.toContain('quoted-tool-cookie-secret')
    expect(serialized).not.toContain('quoted-diagnostic-bearer-secret')
    expect(serialized).not.toContain('quoted-diagnostic-session-secret')
    expect(result.value.acceptedFact.content).toContain('session_key="[REDACTED:secret]"')
    expect(result.value.rawEvidence.content).toBe("cookie: '[REDACTED:secret]'")
    expect(result.value.rawEvidence.metadata.command).toBe('bearer = "[REDACTED:secret]"')
    expect(result.value.rejectedCandidateRetention.candidate.userMessage).toContain('session-key = `[REDACTED:secret]`')
    expect(result.value.rejectedCandidateRetention.candidate.toolEvents[0].output).toBe('cookie = "[REDACTED:secret]"')
    expect(result.value.diagnosticPayload.message).toContain('bearer: "[REDACTED:secret]"')
    expect(result.value.diagnosticPayload.payload.raw).toBe("session_key='[REDACTED:secret]'")
    expect(result.hits.map((hit) => hit.path)).toEqual(
      expect.arrayContaining([
        'acceptedFact.content',
        'rawEvidence.content',
        'rawEvidence.metadata.command',
        'rejectedCandidateRetention.candidate.userMessage',
        'rejectedCandidateRetention.candidate.toolEvents.0.output',
        'diagnosticPayload.message',
        'diagnosticPayload.payload.raw',
      ])
    )
  })

  it('can detect sensitive content without mutating input when redaction is disabled', () => {
    const text = 'api_key: sk-live-1234567890abcdef1234567890abcdef'
    const result = redactText(text, { enabled: false })

    expect(result.redacted).toBe(false)
    expect(result.value).toBe(text)
    expect(result.hits).toHaveLength(0)
    expect(containsSensitiveContext(text)).toBe(true)
  })
})

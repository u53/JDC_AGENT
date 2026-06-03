import { containsRawReasoningData, redactText } from './redaction.js'
import type { ContextBundle, ContextCitation, ContextSection } from './types.js'

export interface PromptRenderOptions {
  injectionEnabled?: boolean
}

export function renderContextBundle(bundle: ContextBundle, options: PromptRenderOptions = {}): string {
  if (options.injectionEnabled === false || bundle.sections.length === 0) return ''

  const lines: string[] = [`<jdc-context-engine bundle="${escapeAttribute(bundle.id)}">`]
  for (const section of bundle.sections) {
    lines.push(renderSection(section))
  }
  if (bundle.citations.length) lines.push(renderCitations(bundle.citations))
  lines.push('</jdc-context-engine>')
  return lines.join('\n')
}

function renderSection(section: ContextSection): string {
  const attrs = [
    `kind="${escapeAttribute(section.kind)}"`,
    `confidence="${formatConfidence(section.confidence)}"`,
    `freshness="${escapeAttribute(section.freshness)}"`,
    `source="${escapeAttribute(section.sourceProvider)}"`,
  ].join(' ')
  const markers = contextMarkers(section)
  const content = sanitizeForPrompt(section.content)
  return [`  <section ${attrs}>`, indent([markers, content].filter(Boolean).join('\n'), 4), '  </section>'].join('\n')
}

function renderCitations(citations: ContextCitation[]): string {
  const rows = citations.map((citation) => `- ${citation.id}: ${citation.type} ${citation.ref}${citation.line ? `:${citation.line}` : ''}${citation.hash ? ` #${citation.hash.slice(0, 12)}` : ''}`)
  return ['  <citations>', indent(rows.map(sanitizeForPrompt).join('\n'), 4), '  </citations>'].join('\n')
}

function contextMarkers(section: ContextSection): string {
  const markers: string[] = []
  if (section.freshness === 'stale') markers.push('[stale]')
  if (section.confidence < 0.75) markers.push('[low-confidence]')
  return markers.join(' ')
}

function sanitizeForPrompt(value: string): string {
  if (containsRawReasoningData(value)) return '[redacted protected model-thought]'
  return escapeXml(redactText(value).value).replace(/\[REDACTED:secret\]/g, '[redacted secret]')
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeAttribute(value: string): string {
  return escapeXml(value).replace(/"/g, '&quot;')
}

function indent(value: string, spaces: number): string {
  const prefix = ' '.repeat(spaces)
  return value.split('\n').map((line) => `${prefix}${line}`).join('\n')
}

function formatConfidence(confidence: number): string {
  return confidence.toFixed(2).replace(/0$/, '').replace(/\.0$/, '')
}

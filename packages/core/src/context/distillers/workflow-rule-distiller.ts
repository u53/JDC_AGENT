import type { ContextCitation, DistillerOutput, HarvestCandidate } from '../types.js'
import type { ContextDistiller } from './index.js'
import { completeDistillerEnvelopeWithModel } from './model-client.js'

export const workflowRuleDistiller: ContextDistiller = {
  name: 'WorkflowRuleDistiller',
  async distill(candidate, context) {
    const deterministic = deterministicWorkflowRule(candidate)
    if (deterministic) return deterministic
    if (!context.modelClient) {
      return { schemaVersion: 1, distiller: 'WorkflowRuleDistiller', action: 'skip', reason: 'model_noop', confidence: 0.9, diagnostic: 'no workflow files in candidate' }
    }
    return completeDistillerEnvelopeWithModel({
      distiller: 'WorkflowRuleDistiller',
      candidate,
      binding: context.modelBinding,
      maxOutputTokens: context.maxOutputTokens,
    }, context.modelClient)
  },
}

function deterministicWorkflowRule(candidate: HarvestCandidate): DistillerOutput | undefined {
  const files = candidate.changedFiles.map(normalizePath).filter(isWorkflowFile)
  if (!files.length) return undefined
  const workflowType = inferWorkflowType(`${candidate.userMessage}\n${files.join('\n')}`)
  return {
    schemaVersion: 1,
    distiller: 'WorkflowRuleDistiller',
    confidence: 0.9,
    citations: files.map(fileCitation),
    payload: {
      content: `Project ${workflowType} workflow changed in ${files.join(', ')}. Re-read cited workflow/package files before release/build/test actions.`,
      workflowType,
      commands: [],
      files,
      confidence: 0.9,
    },
  }
}

function fileCitation(ref: string): ContextCitation {
  return { id: `cit_workflow_${ref.replace(/[^A-Za-z0-9]+/g, '_')}`, type: 'file', ref }
}

function inferWorkflowType(text: string): 'release' | 'build' | 'test' | 'package' | 'ci' {
  const normalized = text.toLowerCase()
  if (/release|publish|tag|发布/.test(normalized)) return 'release'
  if (/package|pack|electron-builder|vsce/.test(normalized)) return 'package'
  if (/test|vitest|jest|playwright/.test(normalized)) return 'test'
  if (/build|tsc|gradle/.test(normalized)) return 'build'
  return 'ci'
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '')
}

function isWorkflowFile(filePath: string): boolean {
  return /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(filePath) ||
    filePath === 'package.json' ||
    /^packages\/[^/]+\/package\.json$/i.test(filePath)
}

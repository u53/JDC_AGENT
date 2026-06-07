import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assembleSystemPrompt, joinSegments, loadInstructionSources } from './context.js'
import { strictToolGroundingProfile } from './model-profile.js'

const tmpDirs: string[] = []

afterEach(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true })
  tmpDirs.length = 0
})

describe('system prompt carried context', () => {
  it('returns refs for project instructions loaded into the system prompt', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'jdc-system-carried-'))
    tmpDirs.push(cwd)
    writeFileSync(path.join(cwd, 'JDCAGNET.md'), 'Project instruction.')
    mkdirSync(path.join(cwd, '.jdcagnet', 'rules'), { recursive: true })
    writeFileSync(path.join(cwd, '.jdcagnet', 'rules', 'style.md'), 'Use local style.')

    const sources = (await loadInstructionSources(cwd)).filter((source) => source.scope !== 'global')

    expect(sources.map((source) => source.ref)).toEqual(['JDCAGNET.md', '.jdcagnet/rules/style.md'])
    expect(sources.map((source) => source.scope)).toEqual(['project', 'rule'])
  })

  it('keeps current date but does not inject detailed git status in the generic system prompt', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'jdc-system-git-'))
    tmpDirs.push(cwd)

    const text = (await assembleSystemPrompt({ cwd, toolDefs: [], toolNames: [] }))
      .map((segment) => segment.content)
      .join('\n')

    expect(text).toContain('# Current Date')
    expect(text).not.toContain('# Git Status')
  })
})

describe('model profile adaptation in system prompt', () => {
  it('renders strict model profile adaptation in the system prompt', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'jdc-phase6-prompt-'))
    tmpDirs.push(cwd)

    const text = joinSegments(await assembleSystemPrompt({
      cwd,
      toolDefs: [],
      toolNames: [],
      modelProfile: strictToolGroundingProfile({ id: 'strict_local', providerPattern: 'ollama', modelPattern: 'glm*' }),
    }))

    expect(text).toContain('# Model Profile Adaptation')
    expect(text).toContain('Profile: strict_local')
    expect(text).toContain('Evidence strictness: strict')
    expect(text).toContain('Contract verbosity: explicit')
    expect(text).toContain('Default plan depth: detailed')
    expect(text).toContain('Use short, explicit, stepwise action contracts')
    expect(text).toContain('Treat missing file or symbol evidence as blocking')
    expect(text).toContain('run verification or clearly disclose why verification is pending')
    expect(text).toContain('Prefer no more than 2 parallel read tool calls')
  })

  it('renders standard model profile adaptation without strict-only wording', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'jdc-phase6-prompt-'))
    tmpDirs.push(cwd)

    const text = joinSegments(await assembleSystemPrompt({
      cwd,
      toolDefs: [],
      toolNames: [],
      modelProfile: {
        id: 'standard_default',
        label: 'Standard default',
        match: { providerPattern: '*', modelPattern: '*' },
        reasoningReliability: 'high',
        toolDiscipline: 'high',
        contextUseDiscipline: 'high',
        evidenceStrictness: 'standard',
        contractVerbosity: 'normal',
        requiresCompactActionContracts: false,
        defaultPlanDepth: 'normal',
        maxParallelToolCalls: 5,
        requireStepwiseVerification: false,
      },
    }))

    expect(text).toContain('# Model Profile Adaptation')
    expect(text).toContain('Profile: standard_default')
    expect(text).toContain('Evidence strictness: standard')
    expect(text).toContain('Contract verbosity: normal')
    expect(text).toContain('Default plan depth: normal')
    expect(text).toContain('Parallel read tool preference: no more than 5 parallel read tool calls.')
    expect(text).toContain('Use the normal JDC CODE operating contract')
    expect(text).toContain('Runtime gates still control mutation and final verification disclosure')
    expect(text).not.toContain('Use short, explicit, stepwise action contracts')
    expect(text).not.toContain('Treat missing file or symbol evidence as blocking')
  })

  it('renders strict profile with custom maxParallelToolCalls using the profile-derived value', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'jdc-phase6-prompt-'))
    tmpDirs.push(cwd)

    const customProfile = {
      ...strictToolGroundingProfile({ id: 'strict_custom', providerPattern: 'openai', modelPattern: 'o3*' }),
      maxParallelToolCalls: 4,
    }

    const text = joinSegments(await assembleSystemPrompt({
      cwd,
      toolDefs: [],
      toolNames: [],
      modelProfile: customProfile,
    }))

    expect(text).toContain('Prefer no more than 4 parallel read tool calls')
    expect(text).not.toContain('Prefer no more than 2 parallel read tool calls')
    expect(text).toContain('Parallel read tool preference: no more than 4 parallel read tool calls.')
  })
})

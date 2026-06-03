import { describe, it, expect } from 'vitest'
import { PermissionChecker } from '../permissions.js'

const JDC_CODE_TOOLS = [
  'JdcContext', 'JdcSearch', 'JdcNode', 'JdcCallers', 'JdcCallees',
  'JdcImpact', 'JdcTrace', 'JdcExplore', 'JdcFiles',
]

const JDC_READ_ONLY_CONTEXT_TOOLS = [
  'JdcMemorySearch',
]

const JDC_DURABLE_WRITE_CONTEXT_TOOLS = [
  'JdcMemoryWrite',
]

describe('permissions: JDC Context Engine tools are read-only', () => {
  it('allows Jdc* code intelligence tools without prompting in standard mode', () => {
    const checker = new PermissionChecker('standard', '/project', {
      projectRules: [],
      globalRules: [],
    })
    for (const tool of JDC_CODE_TOOLS) {
      expect(checker.check(tool, {}), `${tool} should be allowed`).toBe('allow')
    }
  })

  it('keeps Jdc* code intelligence tools allowed even in strict mode (not downgraded to ask)', () => {
    const checker = new PermissionChecker('strict', '/project', {
      projectRules: [],
      globalRules: [],
    })
    for (const tool of JDC_CODE_TOOLS) {
      expect(checker.check(tool, {}), `${tool} should stay allowed in strict`).toBe('allow')
    }
  })

  it('allows read-only context tools without prompting in standard mode', () => {
    const checker = new PermissionChecker('standard', '/project', {
      projectRules: [],
      globalRules: [],
    })
    for (const tool of JDC_READ_ONLY_CONTEXT_TOOLS) {
      expect(checker.check(tool, {}), `${tool} should be allowed`).toBe('allow')
    }
  })

  it('keeps read-only context tools allowed even in strict mode', () => {
    const checker = new PermissionChecker('strict', '/project', {
      projectRules: [],
      globalRules: [],
    })
    for (const tool of JDC_READ_ONLY_CONTEXT_TOOLS) {
      expect(checker.check(tool, {}), `${tool} should stay allowed in strict`).toBe('allow')
    }
  })

  it('keeps durable context writes behind a permission prompt in standard and strict modes', () => {
    const standard = new PermissionChecker('standard', '/project', {
      projectRules: [],
      globalRules: [],
    })
    const strict = new PermissionChecker('strict', '/project', {
      projectRules: [],
      globalRules: [],
    })

    for (const tool of JDC_DURABLE_WRITE_CONTEXT_TOOLS) {
      expect(standard.check(tool, {}), `${tool} should ask in standard mode`).toBe('ask')
      expect(strict.check(tool, {}), `${tool} should ask in strict mode`).toBe('ask')
    }
  })
})

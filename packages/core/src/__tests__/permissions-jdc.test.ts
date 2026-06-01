import { describe, it, expect } from 'vitest'
import { PermissionChecker } from '../permissions.js'

const JDC_TOOLS = [
  'JdcContext', 'JdcSearch', 'JdcNode', 'JdcCallers', 'JdcCallees',
  'JdcImpact', 'JdcTrace', 'JdcExplore', 'JdcFiles',
]

describe('permissions: JDC Context Engine tools are read-only', () => {
  it('allows Jdc* without prompting in standard mode', () => {
    const checker = new PermissionChecker('standard', '/project', {
      projectRules: [],
      globalRules: [],
    })
    for (const tool of JDC_TOOLS) {
      expect(checker.check(tool, {}), `${tool} should be allowed`).toBe('allow')
    }
  })

  it('keeps Jdc* allowed even in strict mode (not downgraded to ask)', () => {
    const checker = new PermissionChecker('strict', '/project', {
      projectRules: [],
      globalRules: [],
    })
    for (const tool of JDC_TOOLS) {
      expect(checker.check(tool, {}), `${tool} should stay allowed in strict`).toBe('allow')
    }
  })
})

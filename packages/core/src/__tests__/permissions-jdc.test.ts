import { describe, it, expect } from 'vitest'
import { PermissionChecker } from '../permissions.js'

const JDC_TOOLS = [
  'jdc_context', 'jdc_search', 'jdc_node', 'jdc_callers', 'jdc_callees',
  'jdc_impact', 'jdc_trace', 'jdc_explore', 'jdc_files',
]

describe('permissions: JDC Context Engine tools are read-only', () => {
  it('allows jdc_* without prompting in standard mode', () => {
    const checker = new PermissionChecker('standard', '/project', {
      projectRules: [],
      globalRules: [],
    })
    for (const tool of JDC_TOOLS) {
      expect(checker.check(tool, {}), `${tool} should be allowed`).toBe('allow')
    }
  })

  it('keeps jdc_* allowed even in strict mode (not downgraded to ask)', () => {
    const checker = new PermissionChecker('strict', '/project', {
      projectRules: [],
      globalRules: [],
    })
    for (const tool of JDC_TOOLS) {
      expect(checker.check(tool, {}), `${tool} should stay allowed in strict`).toBe('allow')
    }
  })
})

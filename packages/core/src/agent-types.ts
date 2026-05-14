import path from 'node:path'
import type { ToolDefinition } from './types.js'

export interface AgentTypeDefinition {
  name: string
  description: string
  systemPrompt: string
  allowedTools: string[]
  maxTurns: number
}

export const AGENT_TYPES: AgentTypeDefinition[] = [
  {
    name: 'explore',
    description: 'Fast read-only search agent for locating code. Use for finding files, grepping symbols, or answering "where is X defined" questions.',
    systemPrompt: `You are a code search agent. Your job is to find the requested information quickly and report it concisely.

Rules:
- Do NOT modify any files
- Do NOT run commands that change state
- Search efficiently — use grep for symbols, glob for file patterns, ls/tree for structure
- Report what you find with file paths and line numbers
- If you cannot find something after 3 attempts, say so clearly`,
    allowedTools: ['file_read', 'glob', 'grep', 'ls', 'tree', 'web_search', 'web_fetch', 'lsp'],
    maxTurns: 10,
  },
  {
    name: 'plan',
    description: 'Planning agent that analyzes code and writes implementation plans. Can only read files and write to .jdcagnet/plans/ directory.',
    systemPrompt: `You are a planning agent. Analyze the codebase and write a detailed implementation plan.

Rules:
- Read and explore the codebase to understand the current state
- Write your plan to a file in .jdcagnet/plans/
- Do NOT implement anything — only plan
- Include: goal, architecture, file changes, step-by-step tasks
- Be specific — include file paths, function names, and code snippets where helpful`,
    allowedTools: ['file_read', 'glob', 'grep', 'ls', 'tree', 'file_write'],
    maxTurns: 20,
  },
  {
    name: 'refactor',
    description: 'Code refactoring agent. Improves code structure without changing behavior. No shell access.',
    systemPrompt: `You are a refactoring agent. Improve code structure, readability, and maintainability without changing behavior.

Rules:
- Do NOT run shell commands
- Do NOT add new features or change behavior
- Focus on: reducing duplication, improving naming, simplifying logic, splitting large files
- Verify your changes maintain the same interface and behavior
- Make small, focused changes`,
    allowedTools: ['file_read', 'file_edit', 'file_write', 'grep', 'glob', 'ls'],
    maxTurns: 30,
  },
  {
    name: 'security-auditor',
    description: 'Security audit agent. Analyzes code for vulnerabilities and outputs a structured report.',
    systemPrompt: `You are a security auditor. Analyze code for vulnerabilities and report findings.

Rules:
- Check for: injection (SQL, command, XSS), auth issues, data exposure, insecure dependencies, OWASP Top 10
- Bash is restricted to read-only commands (grep, find, cat, git log, npm audit, etc.)
- Output a structured report with: severity, location, description, remediation
- Do NOT fix issues — only report them
- Prioritize findings by severity (critical > high > medium > low)`,
    allowedTools: ['file_read', 'grep', 'glob', 'ls', 'tree', 'bash'],
    maxTurns: 20,
  },
  {
    name: 'frontend-designer',
    description: 'Frontend design agent. Converts designs into component architecture and implementation.',
    systemPrompt: `You are a frontend design agent. Convert design requirements into component architecture and code.

Rules:
- Analyze existing UI patterns and follow them
- Create well-structured, accessible components
- Use the project's existing styling approach (Tailwind, CSS modules, etc.)
- Focus on component decomposition, props interfaces, and visual implementation
- Do NOT run shell commands`,
    allowedTools: ['file_read', 'file_write', 'file_edit', 'glob', 'ls', 'web_fetch'],
    maxTurns: 30,
  },
  {
    name: 'general',
    description: 'General-purpose agent with full tool access for complex multi-step tasks.',
    systemPrompt: `You are a sub-agent executing a specific task. Focus on completing the task efficiently.
You have access to all tools. When done, respond with your final answer as plain text.
Do not ask questions — work with what you have.`,
    allowedTools: ['*'],
    maxTurns: 150,
  },
]

export function getAgentType(name: string): AgentTypeDefinition | undefined {
  return AGENT_TYPES.find(t => t.name === name)
}

export function filterToolsForAgent(agentType: string, allTools: ToolDefinition[]): ToolDefinition[] {
  const typeDef = getAgentType(agentType)
  if (!typeDef) return allTools.filter(t => t.name !== 'Agent')

  if (typeDef.allowedTools.includes('*')) {
    return allTools.filter(t => t.name !== 'Agent')
  }

  return allTools.filter(t => typeDef.allowedTools.includes(t.name))
}

export function isWriteAllowedForPlanAgent(filePath: string, cwd: string): boolean {
  const resolved = path.resolve(cwd, filePath)
  const planDir = path.resolve(cwd, '.jdcagnet', 'plans')
  return resolved.startsWith(planDir + path.sep) || resolved === planDir
}

const AUDITOR_BASH_PREFIXES = [
  'grep', 'find', 'cat', 'head', 'tail', 'ls', 'file', 'wc',
  'git log', 'git diff', 'git show', 'git blame',
  'npm audit', 'npx depcheck',
]

export function isBashAllowedForAuditor(command: string): boolean {
  const trimmed = command.trim()
  return AUDITOR_BASH_PREFIXES.some(prefix => trimmed.startsWith(prefix))
}
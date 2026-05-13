import { z } from 'zod'

export const CommandHookSchema = z.object({
  type: z.literal('command'),
  command: z.string(),
  timeout: z.number().default(10000),
})

export type CommandHook = z.infer<typeof CommandHookSchema>

export const HookRuleSchema = z.object({
  matcher: z.string().optional(),
  hooks: z.array(CommandHookSchema),
})

export type HookRule = z.infer<typeof HookRuleSchema>

export const HookConfigSchema = z.object({
  hooks: z.object({
    PreToolUse: z.array(HookRuleSchema).optional(),
    PostToolUse: z.array(HookRuleSchema).optional(),
    SessionStart: z.array(HookRuleSchema).optional(),
    SessionEnd: z.array(HookRuleSchema).optional(),
  }),
})

export type HookConfig = z.infer<typeof HookConfigSchema>

export type HookEvent = 'PreToolUse' | 'PostToolUse' | 'SessionStart' | 'SessionEnd'

export interface HookInput {
  hook_event: HookEvent
  session_id: string
  cwd: string
  tool_name?: string
  tool_input?: unknown
  tool_result?: string
  project_name?: string
  message_count?: number
}

export interface HookOutput {
  decision?: 'allow' | 'block'
  reason?: string
  message?: string
}

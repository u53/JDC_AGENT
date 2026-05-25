export interface SkillDefinition {
  name: string
  description: string
  content: string
  userInvocable: boolean
  trigger?: string
  arguments: string[]
  argumentHint?: string
  allowedTools?: string[]
  source: 'global' | 'project'
  filePath: string
}

import type { TeamRuntime } from './team-runtime.js'

export class TeamRegistry {
  private teams = new Map<string, TeamRuntime>()

  register(team: TeamRuntime): void {
    this.teams.set(team.id, team)
  }

  get(id: string): TeamRuntime | undefined {
    return this.teams.get(id)
  }

  remove(id: string): void {
    this.teams.delete(id)
  }

  getAll(): TeamRuntime[] {
    return [...this.teams.values()]
  }
}

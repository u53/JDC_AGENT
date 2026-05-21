import type { TeamRuntime } from './team-runtime.js'

export class TeamRegistry {
  private teams = new Map<string, TeamRuntime>()
  private archived = new Map<string, TeamRuntime>()

  register(team: TeamRuntime): void {
    this.teams.set(team.id, team)
  }

  get(id: string): TeamRuntime | undefined {
    return this.teams.get(id) ?? this.archived.get(id)
  }

  remove(id: string): void {
    const team = this.teams.get(id)
    if (team) {
      this.archived.set(id, team)
      this.teams.delete(id)
    }
  }

  getAll(): TeamRuntime[] {
    return [...this.teams.values()]
  }

  getAllIncludingArchived(): TeamRuntime[] {
    return [...this.teams.values(), ...this.archived.values()]
  }

  isArchived(id: string): boolean {
    return this.archived.has(id)
  }
}

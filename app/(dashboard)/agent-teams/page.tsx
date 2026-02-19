export const dynamic = "force-dynamic"
import Link from "next/link"
import { Topbar } from "@/components/layout/topbar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { CreateTeamDialog } from "@/components/agent-teams/create-team-dialog"
import { SmartCreateDialog } from "@/components/agent-teams/smart-create-dialog"
import { TeamActionsMenu } from "@/components/agent-teams/team-actions-menu"
import { TeamHealthBadge } from "@/components/agent-teams/team-health-badge"
import { CheckCircle2, Users } from "lucide-react"
import type { Team, TeamHealthStatus } from "@/types"

interface TaskStats {
  total: number
  completed: number
  pending: number
  inProgress: number
}

interface TeamWithHealth extends Team {
  health?: {
    status: TeamHealthStatus
    lastActivity: string | null
    staleTaskCount: number
  }
  taskStats?: TaskStats
}

async function getTeams(): Promise<TeamWithHealth[]> {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3777"
  try {
    const res = await fetch(`${base}/api/teams`, { cache: "no-store" })
    if (!res.ok) return []
    const json = await res.json()
    return json.data ?? []
  } catch {
    return []
  }
}

export default async function AgentTeamsPage() {
  const teams = await getTeams()

  return (
    <div className="flex flex-col">
      <Topbar title="Agent Teams" subtitle={`${teams.length} team${teams.length !== 1 ? "s" : ""} configured`}>
        <SmartCreateDialog />
        <CreateTeamDialog />
      </Topbar>

      <div className="space-y-8 p-6">
        {teams.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
            <Users className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">No agent teams yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Create a team to start coordinating agents
            </p>
            <div className="mt-4">
              <CreateTeamDialog triggerLabel="Create your first team" />
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {teams.map((team) => (
              <Card key={team.name} className="relative transition-colors hover:bg-accent/50">
                <div className="absolute right-3 top-3 z-10">
                  <TeamActionsMenu teamName={team.name} />
                </div>
                <Link href={`/agent-teams/${encodeURIComponent(team.name)}`}>
                  <CardHeader className="pb-3 pr-12">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-base font-semibold text-foreground">
                          {team.name}
                        </CardTitle>
                        {team.health && (
                          <TeamHealthBadge
                            status={team.health.status}
                            staleTaskCount={team.health.staleTaskCount}
                          />
                        )}
                      </div>
                      <Badge variant="secondary" className="shrink-0 text-xs">
                        {team.members.length} member{team.members.length !== 1 ? "s" : ""}
                      </Badge>
                    </div>
                    {team.description && (
                      <p className="text-xs text-muted-foreground">{team.description}</p>
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-1">
                      {team.members.slice(0, 4).map((member) => (
                        <Badge
                          key={member.agentId}
                          variant={
                            member.status === "active"
                              ? "success"
                              : member.status === "idle"
                              ? "secondary"
                              : "outline"
                          }
                          className="text-[10px]"
                        >
                          {member.name}
                        </Badge>
                      ))}
                      {team.members.length > 4 && (
                        <Badge variant="outline" className="text-[10px]">
                          +{team.members.length - 4} more
                        </Badge>
                      )}
                    </div>
                    {team.taskStats && team.taskStats.total > 0 ? (
                      <div className="mt-3 space-y-1">
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="text-muted-foreground">
                            {team.taskStats.completed}/{team.taskStats.total} tasks
                          </span>
                          {team.taskStats.completed === team.taskStats.total && (
                            <span className="inline-flex items-center gap-0.5 font-medium text-green-500">
                              <CheckCircle2 className="h-3 w-3" />
                              Done
                            </span>
                          )}
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-emerald-500 transition-all"
                            style={{ width: `${Math.round((team.taskStats.completed / team.taskStats.total) * 100)}%` }}
                          />
                        </div>
                      </div>
                    ) : team.taskStats && team.taskStats.total === 0 ? (
                      <div className="mt-3">
                        <span className="text-[10px] text-amber-500">No tasks — exiting</span>
                      </div>
                    ) : null}
                    {team.createdAt && (
                      <p className="mt-2 text-[10px] text-muted-foreground">
                        Created {new Date(team.createdAt).toLocaleDateString()}
                      </p>
                    )}
                  </CardContent>
                </Link>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

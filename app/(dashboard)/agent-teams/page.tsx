export const dynamic = "force-dynamic"
import Link from "next/link"
import { Topbar } from "@/components/layout/topbar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CreateTeamDialog } from "@/components/agent-teams/create-team-dialog"
import { Users, Plus } from "lucide-react"
import type { Team } from "@/types"

async function getTeams(): Promise<Team[]> {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
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
        <CreateTeamDialog />
      </Topbar>

      <div className="p-6">
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
              <Link key={team.name} href={`/agent-teams/${encodeURIComponent(team.name)}`}>
                <Card className="cursor-pointer transition-colors hover:bg-accent/50">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <CardTitle className="text-base font-semibold text-foreground">
                        {team.name}
                      </CardTitle>
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
                    {team.createdAt && (
                      <p className="mt-2 text-[10px] text-muted-foreground">
                        Created {new Date(team.createdAt).toLocaleDateString()}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

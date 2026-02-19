export const dynamic = "force-dynamic"
import { notFound } from "next/navigation"
import { FolderOpen } from "lucide-react"
import { Topbar } from "@/components/layout/topbar"
import { TeamDetailLive } from "@/components/agent-teams/team-detail-live"
import type { Team, TeamTask, TeamPlan } from "@/types"

interface TeamWithTasks extends Team {
  tasks: TeamTask[]
  plan?: TeamPlan | null
}

async function getTeamWithTasks(name: string): Promise<TeamWithTasks | null> {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:31777"
  try {
    const res = await fetch(`${base}/api/teams/${encodeURIComponent(name)}`, { cache: "no-store" })
    if (!res.ok) return null
    const json = await res.json()
    return json.data ?? null
  } catch {
    return null
  }
}

export default async function TeamDetailPage({
  params,
}: {
  params: Promise<{ name: string }>
}) {
  const { name } = await params
  const teamName = decodeURIComponent(name)
  const data = await getTeamWithTasks(teamName)

  if (!data) notFound()

  const { tasks, plan, ...team } = data

  return (
    <div className="flex flex-col">
      <Topbar
        title={team.name}
        subtitle={team.description ?? `${team.members.length} member${team.members.length !== 1 ? "s" : ""}`}
        live
      />
      {team.projectPath && (
        <div className="flex items-center gap-1.5 border-b border-border bg-muted/30 px-6 py-1.5 text-xs text-muted-foreground">
          <FolderOpen className="h-3.5 w-3.5 shrink-0" />
          <span className="font-mono">{team.projectPath}</span>
        </div>
      )}
      <TeamDetailLive initialData={{ team, tasks, plan }} />
    </div>
  )
}

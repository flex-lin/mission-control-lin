export const dynamic = "force-dynamic"
import { notFound } from "next/navigation"
import { Topbar } from "@/components/layout/topbar"
import { TeamDetailLive } from "@/components/agent-teams/team-detail-live"
import type { Team, TeamTask } from "@/types"

interface TeamWithTasks extends Team {
  tasks: TeamTask[]
}

async function getTeamWithTasks(name: string): Promise<TeamWithTasks | null> {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3777"
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

  const { tasks, ...team } = data

  return (
    <div className="flex flex-col">
      <Topbar
        title={team.name}
        subtitle={team.description ?? `${team.members.length} member${team.members.length !== 1 ? "s" : ""}`}
        live
      />
      <TeamDetailLive initialData={{ team, tasks }} />
    </div>
  )
}

"use client"

import { useAutoRefresh } from "@/lib/hooks/use-auto-refresh"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { TeamHealthBadge } from "@/components/agent-teams/team-health-badge"
import { WakeButton } from "@/components/agent-teams/wake-button"
import { StuckTasksFeed } from "@/components/agent-teams/stuck-tasks-feed"
import { TmuxAttachBar } from "@/components/agent-teams/tmux-attach-bar"
import type { TeamHealthStatus, TeamTask } from "@/types"

interface MemberHealth {
  name: string
  status: TeamHealthStatus
  lastSeen: string | null
  tmuxAlive?: boolean
  attachCmd?: string
}

interface LeaderSession {
  alive: boolean
  sessionName: string
  attachCmd: string
}

interface TeamHealthData {
  status: TeamHealthStatus
  lastActivity: string | null
  staleTasks: TeamTask[]
  memberHealth: MemberHealth[]
  leaderSession?: LeaderSession
}

interface TeamHealthPanelProps {
  teamName: string
}

function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return "never"

  const now = Date.now()
  const then = new Date(isoString).getTime()
  const diffMs = now - then

  if (diffMs < 0) return "just now"

  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 60) return "just now"

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function TeamHealthPanel({ teamName }: TeamHealthPanelProps) {
  const { data, loading, error } = useAutoRefresh<TeamHealthData>({
    url: `/api/teams/${encodeURIComponent(teamName)}/health`,
    intervalMs: 5000,
  })

  if (loading && !data) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-xs text-muted-foreground">Loading health data...</p>
        </CardContent>
      </Card>
    )
  }

  if (error && !data) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-xs text-red-400">Failed to load health: {error}</p>
        </CardContent>
      </Card>
    )
  }

  if (!data) return null

  return (
    <div className="space-y-4">
      {/* Overall status */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Team Health</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <TeamHealthBadge
              status={data.status}
              staleTaskCount={data.staleTasks.length}
            />
            <span className="text-xs text-muted-foreground">
              Last activity: {formatRelativeTime(data.lastActivity)}
            </span>
          </div>
          {data.status !== "exited" && (
            <WakeButton teamName={teamName} />
          )}
        </CardContent>
      </Card>

      {/* tmux attach bar */}
      {data.leaderSession && (
        <TmuxAttachBar
          attachCmd={data.leaderSession.attachCmd}
          alive={data.leaderSession.alive}
          sessionName={data.leaderSession.sessionName}
        />
      )}

      {/* Member health table */}
      {data.memberHealth.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Member Health</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.memberHealth.map((member) => (
                  <TableRow key={member.name}>
                    <TableCell className="font-medium">{member.name}</TableCell>
                    <TableCell>
                      <TeamHealthBadge status={member.status} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatRelativeTime(member.lastSeen)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Stuck tasks feed */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-amber-400">
            Stuck Tasks
          </CardTitle>
        </CardHeader>
        <CardContent>
          <StuckTasksFeed teamName={teamName} />
        </CardContent>
      </Card>
    </div>
  )
}

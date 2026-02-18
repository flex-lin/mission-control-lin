"use client"

import { useAutoRefresh } from "@/lib/hooks/use-auto-refresh"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
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
import type { TeamHealthStatus, TeamTask } from "@/types"

interface MemberHealth {
  name: string
  status: TeamHealthStatus
  lastSeen: string | null
}

interface TeamHealthData {
  status: TeamHealthStatus
  lastActivity: string | null
  staleTasks: TeamTask[]
  memberHealth: MemberHealth[]
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
          {data.status === "asleep" && (
            <WakeButton teamName={teamName} />
          )}
        </CardContent>
      </Card>

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

      {/* Stale tasks */}
      {data.staleTasks.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-amber-400">
              Stale Tasks ({data.staleTasks.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Stuck</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.staleTasks.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell className="text-muted-foreground">{task.id}</TableCell>
                    <TableCell className="max-w-xs">
                      <p className="truncate text-sm">{task.subject}</p>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {task.owner ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="warning" className="text-[10px]">
                        {task.metadata?.stuckSince
                          ? `stuck ${formatRelativeTime(task.metadata.stuckSince as string)}`
                          : "stuck"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

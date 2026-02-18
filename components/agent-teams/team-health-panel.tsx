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
import { Button } from "@/components/ui/button"
import { TeamHealthBadge } from "@/components/agent-teams/team-health-badge"
import { WakeButton } from "@/components/agent-teams/wake-button"
import { StuckTasksFeed } from "@/components/agent-teams/stuck-tasks-feed"
import { Terminal, Copy } from "lucide-react"
import { toast } from "sonner"
import type { TeamHealthStatus, TeamTask } from "@/types"

interface MemberHealth {
  name: string
  status: TeamHealthStatus
  lastSeen: string | null
  tmuxAlive?: boolean
  attachCmd?: string
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
          {data.status !== "exited" && (
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
                  <TableHead>tmux</TableHead>
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
                    <TableCell>
                      {member.tmuxAlive ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 gap-1 px-1.5 text-[10px] text-emerald-400 hover:text-emerald-300"
                          onClick={() => {
                            const cmd = member.attachCmd ?? ""
                            if (navigator.clipboard?.writeText) {
                              navigator.clipboard.writeText(cmd).then(
                                () => toast.success("Attach command copied!"),
                                () => {
                                  window.prompt("Copy this command:", cmd)
                                }
                              )
                            } else {
                              window.prompt("Copy this command:", cmd)
                            }
                          }}
                        >
                          <Terminal className="h-3 w-3" />
                          running
                          <Copy className="h-2.5 w-2.5" />
                        </Button>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">stopped</span>
                      )}
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

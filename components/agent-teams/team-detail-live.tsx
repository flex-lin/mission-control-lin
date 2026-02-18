"use client"

import { useAutoRefresh } from "@/lib/hooks/use-auto-refresh"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { SendMessageForm } from "@/components/agent-teams/send-message-form"
import { CreateTaskForm } from "@/components/agent-teams/create-task-form"
import { ShutdownButton } from "@/components/agent-teams/shutdown-button"
import { TeamHealthPanel } from "@/components/agent-teams/team-health-panel"
import { TmuxSessionBar } from "@/components/agent-teams/tmux-session-bar"
import { Play } from "lucide-react"
import { toast } from "sonner"
import type { Team, TeamTask } from "@/types"

interface SessionInfo {
  name: string
  sessionName: string
  alive: boolean
  attachCmd: string
}

interface TeamDetailLiveProps {
  initialData: {
    team: Team
    tasks: TeamTask[]
  }
}

interface TeamWithTasks extends Team {
  tasks: TeamTask[]
}

function statusBadgeVariant(status: TeamTask["status"]) {
  switch (status) {
    case "completed": return "success" as const
    case "in_progress": return "default" as const
    case "pending": return "warning" as const
    case "deleted": return "outline" as const
  }
}

export function TeamDetailLive({ initialData }: TeamDetailLiveProps) {
  const { data: liveData } = useAutoRefresh<TeamWithTasks>({
    url: `/api/teams/${encodeURIComponent(initialData.team.name)}`,
    intervalMs: 3000,
  })

  const { data: sessionData } = useAutoRefresh<{ sessions: SessionInfo[] }>({
    url: `/api/teams/${encodeURIComponent(initialData.team.name)}/sessions`,
    intervalMs: 5000,
  })

  const sessionMap = new Map<string, SessionInfo>(
    (sessionData?.sessions ?? []).map((s) => [s.name, s])
  )

  async function handleLaunchMember(memberName: string) {
    try {
      const res = await fetch(
        `/api/teams/${encodeURIComponent(initialData.team.name)}/wake`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: `Wake up ${memberName} — check your tasks.` }),
        }
      )
      if (res.ok) {
        toast.success(`Launched ${memberName}`)
      } else {
        toast.error("Failed to launch member")
      }
    } catch {
      toast.error("Network error")
    }
  }

  const tasks = liveData?.tasks ?? initialData.tasks
  const teamForForms: Team = liveData
    ? { name: liveData.name, members: liveData.members, description: liveData.description, createdAt: liveData.createdAt }
    : initialData.team

  const activeTasks = tasks.filter((t) => t.status === "in_progress").length
  const pendingTasks = tasks.filter((t) => t.status === "pending").length
  const completedTasks = tasks.filter((t) => t.status === "completed").length

  return (
    <div className="space-y-6 p-6">
      {/* Summary row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Members</p>
            <p className="text-2xl font-bold">{teamForForms.members.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Active Tasks</p>
            <p className="text-2xl font-bold text-blue-400">{activeTasks}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Pending</p>
            <p className="text-2xl font-bold text-amber-400">{pendingTasks}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Completed</p>
            <p className="text-2xl font-bold text-emerald-400">{completedTasks}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tmux sessions bar */}
      <TmuxSessionBar sessions={sessionData?.sessions ?? []} />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: tabs for tasks + members */}
        <div className="lg:col-span-2">
          <Tabs defaultValue="tasks">
            <TabsList>
              <TabsTrigger value="tasks">Tasks ({tasks.length})</TabsTrigger>
              <TabsTrigger value="members">Members ({teamForForms.members.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="tasks">
              <Card>
                <CardContent className="p-0">
                  {tasks.length === 0 ? (
                    <p className="p-6 text-center text-xs text-muted-foreground">
                      No tasks yet
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10">#</TableHead>
                          <TableHead>Subject</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Owner</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {tasks.map((task) => (
                          <TableRow key={task.id}>
                            <TableCell className="text-muted-foreground">{task.id}</TableCell>
                            <TableCell className="max-w-xs">
                              <p className="truncate text-sm">{task.subject}</p>
                              {task.description && (
                                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                  {task.description}
                                </p>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant={statusBadgeVariant(task.status)} className="text-[10px]">
                                {task.status.replace("_", " ")}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {task.owner ?? "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="members">
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {teamForForms.members.map((member) => {
                        const session = sessionMap.get(member.name)
                        return (
                          <TableRow key={member.agentId}>
                            <TableCell className="font-medium">{member.name}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {member.agentType}
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                {!session?.alive && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 gap-1 px-1.5 text-[10px]"
                                    onClick={() => handleLaunchMember(member.name)}
                                  >
                                    <Play className="h-3 w-3" />
                                    Launch
                                  </Button>
                                )}
                                <ShutdownButton teamName={teamForForms.name} memberName={member.name} />
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Right: actions */}
        <div className="space-y-4">
          <TeamHealthPanel teamName={teamForForms.name} />

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Send Message</CardTitle>
            </CardHeader>
            <CardContent>
              <SendMessageForm team={teamForForms} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Create Task</CardTitle>
            </CardHeader>
            <CardContent>
              <CreateTaskForm team={teamForForms} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

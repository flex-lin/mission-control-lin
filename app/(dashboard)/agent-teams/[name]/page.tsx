export const dynamic = "force-dynamic"
import { notFound } from "next/navigation"
import { Topbar } from "@/components/layout/topbar"
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
import { SendMessageForm } from "@/components/agent-teams/send-message-form"
import { CreateTaskForm } from "@/components/agent-teams/create-task-form"
import { ShutdownButton } from "@/components/agent-teams/shutdown-button"
import type { Team, TeamTask } from "@/types"

interface TeamWithTasks extends Team {
  tasks: TeamTask[]
}

async function getTeamWithTasks(name: string): Promise<TeamWithTasks | null> {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  try {
    const res = await fetch(`${base}/api/teams/${encodeURIComponent(name)}`, { cache: "no-store" })
    if (!res.ok) return null
    const json = await res.json()
    return json.data ?? null
  } catch {
    return null
  }
}

function statusBadgeVariant(status: TeamTask["status"]) {
  switch (status) {
    case "completed": return "success" as const
    case "in_progress": return "default" as const
    case "pending": return "warning" as const
    case "deleted": return "outline" as const
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
  const activeTasks = tasks.filter((t) => t.status === "in_progress").length
  const pendingTasks = tasks.filter((t) => t.status === "pending").length
  const completedTasks = tasks.filter((t) => t.status === "completed").length

  return (
    <div className="flex flex-col">
      <Topbar
        title={team.name}
        subtitle={team.description ?? `${team.members.length} member${team.members.length !== 1 ? "s" : ""}`}
      />

      <div className="space-y-6 p-6">
        {/* Summary row */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Members</p>
              <p className="text-2xl font-bold">{team.members.length}</p>
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

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left: tabs for tasks + members */}
          <div className="lg:col-span-2">
            <Tabs defaultValue="tasks">
              <TabsList>
                <TabsTrigger value="tasks">Tasks ({tasks.length})</TabsTrigger>
                <TabsTrigger value="members">Members ({team.members.length})</TabsTrigger>
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
                          <TableHead>Status</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {team.members.map((member) => (
                          <TableRow key={member.agentId}>
                            <TableCell className="font-medium">{member.name}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {member.agentType}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  member.status === "active"
                                    ? "success"
                                    : member.status === "idle"
                                    ? "secondary"
                                    : "outline"
                                }
                                className="text-[10px]"
                              >
                                {member.status ?? "unknown"}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <ShutdownButton teamName={team.name} memberName={member.name} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          {/* Right: actions */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">Send Message</CardTitle>
              </CardHeader>
              <CardContent>
                <SendMessageForm team={team} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">Create Task</CardTitle>
              </CardHeader>
              <CardContent>
                <CreateTaskForm team={team} />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}

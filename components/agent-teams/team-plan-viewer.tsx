"use client"

import { useState } from "react"
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
import { ChevronDown, ChevronRight, Brain, Users, ListTodo } from "lucide-react"
import type { TeamPlan } from "@/types"

interface TeamPlanViewerProps {
  plan: TeamPlan
}

export function TeamPlanViewer({ plan }: TeamPlanViewerProps) {
  const [expanded, setExpanded] = useState(false)

  const source = (plan as TeamPlan & { _source?: string })._source
  const fallbackReason = (plan as TeamPlan & { _fallbackReason?: string })._fallbackReason

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="flex items-center gap-2 p-0 hover:bg-transparent"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <CardTitle className="text-sm font-semibold">Team Plan</CardTitle>
          </Button>
          <div className="flex items-center gap-2">
            {source === "ai" && (
              <Badge className="bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 text-[10px]">
                <Brain className="mr-1 h-3 w-3" />
                AI Generated
              </Badge>
            )}
            {source === "local" && (
              <Badge variant="secondary" className="text-[10px]">
                Local
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-4 pt-0">
          {/* Description */}
          {plan.description && (
            <p className="text-sm text-muted-foreground">{plan.description}</p>
          )}

          {/* Fallback reason */}
          {fallbackReason && (
            <div className="rounded-md bg-amber-500/10 px-3 py-2">
              <p className="text-xs text-amber-400">
                Fallback: {fallbackReason}
              </p>
            </div>
          )}

          {/* Personas */}
          {(plan.personas?.length ?? 0) > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Personas ({plan.personas?.length ?? 0})
                </h4>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plan.personas.map((persona) => (
                    <TableRow key={persona.name}>
                      <TableCell className="font-medium">{persona.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {persona.role}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {persona.agentType}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-xs text-xs text-muted-foreground">
                        {persona.description}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Initial Tasks */}
          {(plan.initialTasks?.length ?? 0) > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-1.5">
                <ListTodo className="h-3.5 w-3.5 text-muted-foreground" />
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Initial Tasks ({plan.initialTasks?.length ?? 0})
                </h4>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Assignee</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plan.initialTasks.map((task, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-medium">{task.subject}</TableCell>
                      <TableCell>
                        {task.assignTo ? (
                          <Badge variant="secondary" className="text-[10px]">
                            {task.assignTo}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">unassigned</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-xs text-xs text-muted-foreground">
                        {task.description}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}

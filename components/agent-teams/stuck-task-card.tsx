"use client"

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AlertCircle, Clock, ChevronDown, ChevronUp, MessageSquare } from "lucide-react"
import type { StuckTask } from "@/types"

interface StuckTaskCardProps {
  task: StuckTask
  showTeamName?: boolean
  onRespond?: (task: StuckTask) => void
}

const blockerColors: Record<string, string> = {
  decision_needed: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  missing_info: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  dependency: "bg-gray-500/15 text-gray-400 border-gray-500/30",
  error: "bg-red-500/15 text-red-400 border-red-500/30",
  permission: "bg-purple-500/15 text-purple-400 border-purple-500/30",
}

const blockerLabels: Record<string, string> = {
  decision_needed: "Decision Needed",
  missing_info: "Missing Info",
  dependency: "Dependency",
  error: "Error",
  permission: "Permission",
}

function formatRelativeTime(isoString: string | undefined): string {
  if (!isoString) return ""
  const diffMs = Date.now() - new Date(isoString).getTime()
  if (diffMs < 0) return "just now"
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

export function StuckTaskCard({ task, showTeamName, onRespond }: StuckTaskCardProps) {
  const [expanded, setExpanded] = useState(false)

  const colorClass = task.blockerType
    ? blockerColors[task.blockerType] ?? blockerColors.dependency
    : blockerColors.dependency

  const label = task.blockerType
    ? blockerLabels[task.blockerType] ?? task.blockerType
    : "Stale"

  return (
    <Card className="border-border/50">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground">#{task.id}</span>
              {showTeamName && (
                <Badge variant="outline" className="text-[10px] h-4 px-1">
                  {task.teamName}
                </Badge>
              )}
              <Badge className={`text-[10px] h-4 px-1.5 border ${colorClass}`}>
                {label}
              </Badge>
            </div>
            <p className="text-sm font-medium mt-1 truncate">{task.subject}</p>
          </div>
          {task.blockerSince && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
              <Clock className="h-3 w-3" />
              {formatRelativeTime(task.blockerSince)}
            </span>
          )}
        </div>

        {task.blockerSummary && (
          <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <AlertCircle className="h-3 w-3 mt-0.5 shrink-0 text-amber-400" />
            <span>{task.blockerSummary}</span>
          </div>
        )}

        {task.blockerDetails && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? "Less" : "Details"}
          </button>
        )}

        {expanded && task.blockerDetails && (
          <p className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
            {task.blockerDetails}
          </p>
        )}

        <div className="flex items-center justify-between pt-1">
          <span className="text-[10px] text-muted-foreground">
            {task.owner && <>Owner: {task.owner}</>}
            {task.blockerFrom && <> &middot; From: {task.blockerFrom}</>}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-6 gap-1 px-2 text-[10px]"
            onClick={() => onRespond?.(task)}
          >
            <MessageSquare className="h-3 w-3" />
            Respond
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { ActivityEvent } from "@/types"
import { formatDistanceToNow } from "date-fns"

const eventTypeLabels: Record<string, string> = {
  task_created: "Task Created",
  task_updated: "Task Updated",
  task_completed: "Task Completed",
  team_created: "Team Created",
  message_sent: "Message Sent",
  build_started: "Build Started",
  build_completed: "Build Completed",
  proxy_request: "API Request",
}

const eventTypeBadgeVariant: Record<string, "default" | "secondary" | "success" | "warning"> = {
  task_completed: "success",
  build_completed: "success",
  task_created: "default",
  team_created: "default",
  task_updated: "secondary",
  message_sent: "secondary",
  build_started: "warning",
  proxy_request: "secondary",
}

export function ActivityFeed() {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/activity")
      .then((r) => r.json())
      .then((res) => {
        if (res.data) setEvents(res.data)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Recent Activity</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 p-0">
        <ScrollArea className="h-72 px-4 pb-4">
          {loading ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              Loading activity…
            </div>
          ) : events.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No recent activity
            </p>
          ) : (
            <div className="space-y-3">
              {events.map((event, i) => (
                <div key={i} className="flex items-start gap-3">
                  <Badge
                    variant={eventTypeBadgeVariant[event.type] ?? "secondary"}
                    className="mt-0.5 shrink-0 text-[10px]"
                  >
                    {eventTypeLabels[event.type] ?? event.type}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-foreground">{event.description}</p>
                    <div className="mt-0.5 flex items-center gap-2">
                      {event.team && (
                        <span className="text-[10px] text-muted-foreground">
                          {event.team}
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground">
                        {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

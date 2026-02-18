"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useAutoRefresh } from "@/lib/hooks/use-auto-refresh"
import { toast } from "sonner"
import type { StuckTask } from "@/types"

interface UnblockDialogProps {
  task: StuckTask | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function UnblockDialog({ task, open, onOpenChange }: UnblockDialogProps) {
  const [action, setAction] = useState("message")
  const [message, setMessage] = useState("")
  const [assignTo, setAssignTo] = useState("")
  const [submitting, setSubmitting] = useState(false)

  // Fetch team members for reassignment
  const { data: teamData } = useAutoRefresh<{
    memberHealth: { name: string }[]
  }>({
    url: task ? `/api/teams/${encodeURIComponent(task.teamName)}/health` : "",
    intervalMs: 30000,
    enabled: open && !!task,
  })

  const memberNames = teamData?.memberHealth?.map((m) => m.name) ?? []

  async function handleSubmit() {
    if (!task) return
    setSubmitting(true)

    try {
      const body: Record<string, string> = { action }
      if (action === "message") body.message = message
      if (action === "reassign") body.assignTo = assignTo

      const res = await fetch(
        `/api/teams/${encodeURIComponent(task.teamName)}/tasks/${encodeURIComponent(task.id)}/respond`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      )

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }

      toast.success(
        action === "message"
          ? "Response sent to agent"
          : action === "reassign"
            ? `Task reassigned to ${assignTo}`
            : "Task cancelled"
      )

      setMessage("")
      setAssignTo("")
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to respond")
    } finally {
      setSubmitting(false)
    }
  }

  if (!task) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Respond to Blocker</DialogTitle>
          <DialogDescription className="text-xs">
            Task #{task.id}: {task.subject}
          </DialogDescription>
        </DialogHeader>

        {task.blockerSummary && (
          <div className="rounded bg-muted/50 p-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="text-[10px] mb-1">
              {task.blockerType ?? "stuck"}
            </Badge>
            <p>{task.blockerSummary}</p>
          </div>
        )}

        <Tabs value={action} onValueChange={setAction}>
          <TabsList className="w-full">
            <TabsTrigger value="message" className="flex-1 text-xs">
              Send Response
            </TabsTrigger>
            <TabsTrigger value="reassign" className="flex-1 text-xs">
              Reassign
            </TabsTrigger>
            <TabsTrigger value="cancel" className="flex-1 text-xs">
              Cancel Task
            </TabsTrigger>
          </TabsList>

          <TabsContent value="message" className="space-y-2 mt-2">
            <Textarea
              placeholder={`Re: ${task.subject} — type your response...`}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              className="text-xs"
            />
          </TabsContent>

          <TabsContent value="reassign" className="space-y-2 mt-2">
            <Select value={assignTo} onValueChange={setAssignTo}>
              <SelectTrigger className="text-xs">
                <SelectValue placeholder="Select team member..." />
              </SelectTrigger>
              <SelectContent>
                {memberNames
                  .filter((n) => n !== task.owner)
                  .map((name) => (
                    <SelectItem key={name} value={name} className="text-xs">
                      {name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </TabsContent>

          <TabsContent value="cancel" className="mt-2">
            <p className="text-xs text-muted-foreground">
              This will cancel the task and notify the team. This action cannot
              be undone.
            </p>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
          <Button
            size="sm"
            className="text-xs"
            onClick={handleSubmit}
            disabled={
              submitting ||
              (action === "message" && !message.trim()) ||
              (action === "reassign" && !assignTo)
            }
          >
            {submitting
              ? "Sending..."
              : action === "cancel"
                ? "Confirm Cancel"
                : "Send"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

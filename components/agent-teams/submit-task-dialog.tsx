"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ListPlus } from "lucide-react"
import { toast } from "sonner"
import type { Team } from "@/types"

interface SubmitTaskDialogProps {
  /** Pre-select a team (skip the team picker) */
  teamName?: string
  triggerLabel?: string
  triggerVariant?: "default" | "outline" | "secondary"
}

export function SubmitTaskDialog({
  teamName: preselectedTeam,
  triggerLabel,
  triggerVariant = "outline",
}: SubmitTaskDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [teams, setTeams] = useState<Team[]>([])
  const [selectedTeam, setSelectedTeam] = useState(preselectedTeam ?? "")
  const [subject, setSubject] = useState("")
  const [description, setDescription] = useState("")
  const [loading, setLoading] = useState(false)
  const [teamsLoading, setTeamsLoading] = useState(false)

  // Fetch teams when dialog opens (unless preselected)
  useEffect(() => {
    if (!open || preselectedTeam) return
    setTeamsLoading(true)
    fetch("/api/teams")
      .then((r) => r.json())
      .then((json) => {
        const list = json.data ?? []
        setTeams(list)
        if (list.length === 1) setSelectedTeam(list[0].name)
      })
      .catch(() => toast.error("Failed to load teams"))
      .finally(() => setTeamsLoading(false))
  }, [open, preselectedTeam])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!subject.trim() || !selectedTeam) return

    setLoading(true)
    try {
      const res = await fetch(
        `/api/teams/${encodeURIComponent(selectedTeam)}/tasks`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject: subject.trim(),
            description: description.trim(),
          }),
        }
      )
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? "Failed to submit task")
        return
      }
      toast.success(`Task submitted to ${selectedTeam}`)
      setOpen(false)
      setSubject("")
      setDescription("")
      if (!preselectedTeam) setSelectedTeam("")
      router.refresh()
    } catch {
      toast.error("Network error")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={triggerVariant} className="gap-1.5">
          <ListPlus className="h-3.5 w-3.5" />
          {triggerLabel ?? "Submit Task"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Submit Task to Team Queue</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Team selector (hidden if preselected) */}
          {!preselectedTeam && (
            <div className="space-y-1.5">
              <Label>Team</Label>
              {teamsLoading ? (
                <p className="text-xs text-muted-foreground">Loading teams...</p>
              ) : teams.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No teams available. Create a team first.
                </p>
              ) : (
                <Select value={selectedTeam} onValueChange={setSelectedTeam}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a team" />
                  </SelectTrigger>
                  <SelectContent>
                    {teams.map((t) => (
                      <SelectItem key={t.name} value={t.name}>
                        {t.name}
                        {t.members.length > 0 && ` (${t.members.length} members)`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="submit-task-subject">Task Subject</Label>
            <Input
              id="submit-task-subject"
              placeholder="e.g. Add dark mode toggle to settings"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="submit-task-desc">Description (optional)</Label>
            <Textarea
              id="submit-task-desc"
              placeholder="Acceptance criteria, context, links..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || !subject.trim() || !selectedTeam}
            >
              {loading ? "Submitting..." : "Submit Task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

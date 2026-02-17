"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
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
import type { Team } from "@/types"
import { Plus } from "lucide-react"

interface CreateTaskFormProps {
  team: Team
  onSuccess?: () => void
}

export function CreateTaskForm({ team, onSuccess }: CreateTaskFormProps) {
  const router = useRouter()
  const [subject, setSubject] = useState("")
  const [description, setDescription] = useState("")
  const [owner, setOwner] = useState("__unassigned__")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!subject.trim()) return

    setLoading(true)
    setError(null)
    setSuccess(false)

    try {
      const body: Record<string, string> = {
        subject: subject.trim(),
        description: description.trim(),
      }
      if (owner !== "__unassigned__") body.owner = owner

      const res = await fetch(`/api/teams/${encodeURIComponent(team.name)}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? "Failed to create task")
        return
      }
      setSubject("")
      setDescription("")
      setOwner("__unassigned__")
      setSuccess(true)
      router.refresh()
      onSuccess?.()
    } catch {
      setError("Network error")
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="task-subject">Subject</Label>
        <Input
          id="task-subject"
          placeholder="e.g. Build authentication page"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="task-desc">Description (optional)</Label>
        <Textarea
          id="task-desc"
          placeholder="Task details and acceptance criteria…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
        />
      </div>

      <div className="space-y-1.5">
        <Label>Assign to</Label>
        <Select value={owner} onValueChange={setOwner}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__unassigned__">Unassigned</SelectItem>
            {team.members.map((m) => (
              <SelectItem key={m.agentId} value={m.name}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {success && <p className="text-xs text-emerald-400">Task created successfully</p>}

      <Button type="submit" disabled={loading || !subject.trim()} className="gap-1.5">
        <Plus className="h-3.5 w-3.5" />
        {loading ? "Creating…" : "Create Task"}
      </Button>
    </form>
  )
}

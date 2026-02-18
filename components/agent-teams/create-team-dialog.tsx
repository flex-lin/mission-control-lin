"use client"

import { useState } from "react"
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
import { Plus, Sparkles, Loader2 } from "lucide-react"
import { toast } from "sonner"

interface CreateTeamDialogProps {
  triggerLabel?: string
}

export function CreateTeamDialog({ triggerLabel }: CreateTeamDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [loading, setLoading] = useState(false)
  const [suggesting, setSuggesting] = useState(false)

  async function handleSuggestName() {
    if (!description.trim()) {
      toast.error("Enter a description first so AI can suggest a name")
      return
    }
    setSuggesting(true)
    try {
      const res = await fetch("/api/teams/smart-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: description.trim() }),
      })
      const json = await res.json()
      if (res.ok && json.data?.teamName) {
        setName(json.data.teamName)
        toast.success("Name suggested by AI")
      } else {
        toast.error("Could not generate a name")
      }
    } catch {
      toast.error("Network error")
    } finally {
      setSuggesting(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return

    setLoading(true)

    try {
      const res = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? "Failed to create team")
        return
      }
      toast.success(`Team "${name.trim()}" created`)
      setOpen(false)
      setName("")
      setDescription("")
      router.refresh()
    } catch {
      toast.error("Network error — please try again")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          {triggerLabel ?? "New Team"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Agent Team</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="team-name">Team Name</Label>
            <div className="flex gap-2">
              <Input
                id="team-name"
                placeholder="e.g. mission-control"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 gap-1 text-xs"
                disabled={suggesting || !description.trim()}
                onClick={handleSuggestName}
              >
                {suggesting ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="h-3 w-3" />
                )}
                Suggest
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="team-desc">Description (optional)</Label>
            <Textarea
              id="team-desc"
              placeholder="What does this team do?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !name.trim()}>
              {loading ? "Creating…" : "Create Team"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

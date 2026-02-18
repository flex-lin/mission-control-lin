"use client"

import { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import type { KnowledgeBaseEntry } from "@/types"

interface EditPathDialogProps {
  entry: KnowledgeBaseEntry | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdated: () => void
}

export function EditPathDialog({
  entry,
  open,
  onOpenChange,
  onUpdated,
}: EditPathDialogProps) {
  const [path, setPath] = useState("")
  const [name, setName] = useState("")
  const [tags, setTags] = useState("")
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (entry) {
      setPath(entry.path)
      setName(entry.name)
      setTags((entry.tags ?? []).join(", "))
    }
  }, [entry])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!entry) return

    setLoading(true)
    try {
      const res = await fetch(`/api/knowledge-base/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: path.trim(),
          name: name.trim() || undefined,
          tags: tags.trim()
            ? tags.split(",").map((t) => t.trim()).filter(Boolean)
            : [],
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? "Failed to update entry")
        return
      }
      toast.success(`Updated "${json.data.name}"`)
      onOpenChange(false)
      onUpdated()
    } catch {
      toast.error("Network error — please try again")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Knowledge Base Entry</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-path">Directory Path</Label>
            <Input
              id="edit-path"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              required
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-name">Display Name</Label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-tags">Tags</Label>
            <Input
              id="edit-tags"
              placeholder="react, frontend, typescript"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated list of tags
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !path.trim()}>
              {loading ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

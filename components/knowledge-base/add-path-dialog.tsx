"use client"

import { useState } from "react"
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
import { Plus, Loader2 } from "lucide-react"
import { toast } from "sonner"

interface AddPathDialogProps {
  onAdded: () => void
}

export function AddPathDialog({ onAdded }: AddPathDialogProps) {
  const [open, setOpen] = useState(false)
  const [path, setPath] = useState("")
  const [name, setName] = useState("")
  const [tags, setTags] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!path.trim()) return

    setLoading(true)
    try {
      const res = await fetch("/api/knowledge-base", {
        method: "POST",
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
        toast.error(json.error ?? "Failed to add path")
        return
      }
      toast.success(`Added "${json.data.name}" to knowledge base`)
      setOpen(false)
      setPath("")
      setName("")
      setTags("")
      onAdded()
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
          Add Path
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Path to Knowledge Base</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="kb-path">Directory Path</Label>
            <Input
              id="kb-path"
              placeholder="/home/user/projects/my-app"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              required
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Absolute path to a directory on disk
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kb-name">Display Name (optional)</Label>
            <Input
              id="kb-name"
              placeholder="Auto-derived from folder name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kb-tags">Tags (optional)</Label>
            <Input
              id="kb-tags"
              placeholder="react, frontend, typescript"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated list of tags
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !path.trim()}>
              {loading ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Adding…
                </>
              ) : (
                "Add Path"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

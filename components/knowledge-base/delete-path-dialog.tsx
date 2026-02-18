"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import type { KnowledgeBaseEntry } from "@/types"

interface DeletePathDialogProps {
  entry: KnowledgeBaseEntry | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeleted: () => void
}

export function DeletePathDialog({
  entry,
  open,
  onOpenChange,
  onDeleted,
}: DeletePathDialogProps) {
  const [loading, setLoading] = useState(false)

  async function handleDelete() {
    if (!entry) return

    setLoading(true)
    try {
      const url = entry.id === -1
        ? `/api/knowledge-base/${entry.id}?path=${encodeURIComponent(entry.path)}`
        : `/api/knowledge-base/${entry.id}`
      const res = await fetch(url, {
        method: "DELETE",
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? "Failed to delete entry")
        return
      }
      toast.success(`Removed "${entry.name}" from knowledge base`)
      onOpenChange(false)
      onDeleted()
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
          <DialogTitle>Remove from Knowledge Base</DialogTitle>
          <DialogDescription>
            Are you sure you want to remove this path from the knowledge base?
            This only removes the index entry — your files on disk are not affected.
          </DialogDescription>
        </DialogHeader>
        {entry && (
          <div className="rounded-md border border-border bg-muted/50 px-3 py-2">
            <p className="text-sm font-medium text-foreground">{entry.name}</p>
            <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
              {entry.path}
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Removing…
              </>
            ) : (
              "Remove"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

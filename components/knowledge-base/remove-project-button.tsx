"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import { Loader2, Trash2 } from "lucide-react"
import { toast } from "sonner"

interface RemoveProjectButtonProps {
  /** DB id of the entry */
  entryId: number
  name: string
  path: string
}

export function RemoveProjectButton({ entryId, name, path: entryPath }: RemoveProjectButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleRemove() {
    setLoading(true)
    try {
      const res = await fetch(`/api/knowledge-base/${entryId}`, { method: "DELETE" })
      const json = await res.json()

      if (!res.ok) {
        toast.error(json.error ?? "Failed to remove entry")
        return
      }

      toast.success(`Removed "${name}" from knowledge base`)
      router.push("/knowledge-base")
    } catch {
      toast.error("Network error — please try again")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 text-destructive hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="h-3.5 w-3.5" />
        Remove
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove from Knowledge Base</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove this path from the knowledge base?
              This only removes the index entry — your files on disk are not affected.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-border bg-muted/50 px-3 py-2">
            <p className="text-sm font-medium text-foreground">{name}</p>
            <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
              {entryPath}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleRemove} disabled={loading}>
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
    </>
  )
}

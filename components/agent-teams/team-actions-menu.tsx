"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { MoreHorizontal, Archive, Trash2, ExternalLink } from "lucide-react"
import { toast } from "sonner"

interface TeamActionsMenuProps {
  teamName: string
}

export function TeamActionsMenu({ teamName }: TeamActionsMenuProps) {
  const router = useRouter()
  const [confirmDialog, setConfirmDialog] = useState<"archive" | "delete" | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleAction(mode: "archive" | "delete") {
    setLoading(true)
    try {
      const res = await fetch(
        `/api/teams/${encodeURIComponent(teamName)}?mode=${mode}`,
        { method: "DELETE" }
      )
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? `Failed to ${mode} team`)
        return
      }
      toast.success(
        mode === "archive"
          ? `Team "${teamName}" archived`
          : `Team "${teamName}" permanently deleted`
      )
      setConfirmDialog(null)
      router.refresh()
    } catch {
      toast.error("Network error")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={(e) => e.preventDefault()}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={(e) => {
              e.preventDefault()
              router.push(`/agent-teams/${encodeURIComponent(teamName)}`)
            }}
          >
            <ExternalLink className="mr-2 h-3.5 w-3.5" />
            View Details
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={(e) => {
              e.preventDefault()
              setConfirmDialog("archive")
            }}
          >
            <Archive className="mr-2 h-3.5 w-3.5" />
            Archive Team
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-red-400 focus:text-red-300"
            onClick={(e) => {
              e.preventDefault()
              setConfirmDialog("delete")
            }}
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            Delete Permanently
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirmDialog !== null} onOpenChange={() => setConfirmDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmDialog === "archive" ? "Archive" : "Delete"} team &ldquo;{teamName}&rdquo;?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {confirmDialog === "archive"
              ? "The team and its tasks will be moved to the archive. You can restore it later from the Past Teams section."
              : "This will permanently delete the team and all its tasks. This action cannot be undone."}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialog(null)}>
              Cancel
            </Button>
            <Button
              variant={confirmDialog === "delete" ? "destructive" : "default"}
              onClick={() => confirmDialog && handleAction(confirmDialog)}
              disabled={loading}
            >
              {loading
                ? "Processing..."
                : confirmDialog === "archive"
                ? "Archive Team"
                : "Delete Permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

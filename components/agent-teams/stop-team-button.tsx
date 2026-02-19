"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Square } from "lucide-react"

interface StopTeamButtonProps {
  teamName: string
  disabled?: boolean
}

export function StopTeamButton({ teamName, disabled }: StopTeamButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleStop() {
    setLoading(true)
    try {
      const res = await fetch(
        `/api/teams/${encodeURIComponent(teamName)}/shutdown`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force: true }),
        }
      )
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? "Failed to stop team")
        return
      }
      toast.success("Team stopped — all sessions killed")
      setOpen(false)
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
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300"
          disabled={disabled}
        >
          <Square className="h-3.5 w-3.5" />
          Stop Team
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Stop team &ldquo;{teamName}&rdquo;?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          This will force-kill all tmux sessions for the team. In-progress work
          may be interrupted. You can restart the team later using{" "}
          <strong className="text-foreground">Wake Team</strong>.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleStop}
            disabled={loading}
          >
            {loading ? "Stopping…" : "Stop Team"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

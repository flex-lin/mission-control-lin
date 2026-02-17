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
  DialogTrigger,
} from "@/components/ui/dialog"
import { Power } from "lucide-react"

interface ShutdownButtonProps {
  teamName: string
  memberName: string
}

export function ShutdownButton({ teamName, memberName }: ShutdownButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleShutdown() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/teams/${encodeURIComponent(teamName)}/shutdown`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipient: memberName,
            reason: "Graceful shutdown requested from Mission Control dashboard",
          }),
        }
      )
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? "Failed to send shutdown request")
        return
      }
      setOpen(false)
      router.refresh()
    } catch {
      setError("Network error")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 text-red-400 hover:text-red-300">
          <Power className="h-3.5 w-3.5" />
          Shutdown
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Shutdown {memberName}?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          A graceful shutdown request will be sent to{" "}
          <strong className="text-foreground">{memberName}</strong>.
          The teammate can reject if they are still working on a task.
        </p>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleShutdown}
            disabled={loading}
          >
            {loading ? "Sending…" : "Send Shutdown Request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

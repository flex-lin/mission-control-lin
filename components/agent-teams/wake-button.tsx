"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Bell } from "lucide-react"

interface WakeButtonProps {
  teamName: string
  disabled?: boolean
}

export function WakeButton({ teamName, disabled }: WakeButtonProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleWake() {
    setLoading(true)
    try {
      const res = await fetch(
        `/api/teams/${encodeURIComponent(teamName)}/wake`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }
      )
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? "Failed to wake team")
        return
      }
      toast.success("Team woken — check task list")
      router.refresh()
    } catch {
      toast.error("Network error")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5 text-amber-400 hover:text-amber-300"
      onClick={handleWake}
      disabled={disabled || loading}
    >
      <Bell className="h-3.5 w-3.5" />
      {loading ? "Waking…" : "Wake Team"}
    </Button>
  )
}

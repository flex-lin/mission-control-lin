"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Download } from "lucide-react"
import { toast } from "sonner"

export function IngestButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleIngest() {
    setLoading(true)
    try {
      const res = await fetch("/api/analytics/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ daysBack: 30 }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? "Failed to ingest data")
        return
      }
      const { ingested, skipped, projectsScanned } = json.data
      toast.success(
        `Imported ${ingested} entries from ${projectsScanned} projects (${skipped} skipped)`
      )
      router.refresh()
    } catch {
      toast.error("Network error")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={handleIngest}
      disabled={loading}
      className="gap-1.5"
    >
      <Download className="h-3.5 w-3.5" />
      {loading ? "Importing..." : "Import Session Data"}
    </Button>
  )
}

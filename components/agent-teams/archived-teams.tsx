"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Archive, RotateCcw, Trash2 } from "lucide-react"
import { toast } from "sonner"
import type { Team } from "@/types"

interface ArchivedTeam extends Team {
  archivedAt?: string
}

export function ArchivedTeams() {
  const router = useRouter()
  const [teams, setTeams] = useState<ArchivedTeam[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/teams/archived")
      .then((r) => r.json())
      .then((json) => setTeams(json.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function handleRestore(name: string) {
    setActionLoading(name)
    try {
      const res = await fetch("/api/teams/archived", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? "Failed to restore team")
        return
      }
      toast.success(`Team "${name}" restored`)
      setTeams((prev) => prev.filter((t) => t.name !== name))
      router.refresh()
    } catch {
      toast.error("Network error")
    } finally {
      setActionLoading(null)
    }
  }

  async function handleDelete(name: string) {
    setActionLoading(name)
    try {
      const res = await fetch(
        `/api/teams/${encodeURIComponent(name)}?mode=delete`,
        { method: "DELETE" }
      )
      if (!res.ok) {
        toast.error("Failed to delete team")
        return
      }
      toast.success(`Team "${name}" permanently deleted`)
      setTeams((prev) => prev.filter((t) => t.name !== name))
    } catch {
      toast.error("Network error")
    } finally {
      setActionLoading(null)
    }
  }

  if (loading) return null
  if (teams.length === 0) return null

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Archive className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-muted-foreground">Past Teams</h2>
        <Badge variant="secondary" className="text-[10px]">
          {teams.length}
        </Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {teams.map((team) => (
          <Card key={team.name} className="border-dashed opacity-75">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {team.name}
                </CardTitle>
                <Badge variant="outline" className="text-[10px]">
                  Archived
                </Badge>
              </div>
              {team.description && (
                <p className="text-xs text-muted-foreground/70">{team.description}</p>
              )}
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                {team.members.length > 0 && (
                  <span className="text-[10px] text-muted-foreground">
                    {team.members.length} member{team.members.length !== 1 ? "s" : ""}
                  </span>
                )}
                {team.archivedAt && (
                  <span className="text-[10px] text-muted-foreground">
                    Archived {new Date(team.archivedAt).toLocaleDateString()}
                  </span>
                )}
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 text-xs"
                  disabled={actionLoading === team.name}
                  onClick={() => handleRestore(team.name)}
                >
                  <RotateCcw className="h-3 w-3" />
                  Restore
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 text-xs text-red-400 hover:text-red-300"
                  disabled={actionLoading === team.name}
                  onClick={() => handleDelete(team.name)}
                >
                  <Trash2 className="h-3 w-3" />
                  Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

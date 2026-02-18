"use client"

import { useState, useCallback, useEffect } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { FolderOpen, Pencil, Trash2, BookOpen, ChevronRight } from "lucide-react"
import { useRouter } from "next/navigation"
import { AddPathDialog } from "./add-path-dialog"
import { EditPathDialog } from "./edit-path-dialog"
import { DeletePathDialog } from "./delete-path-dialog"
import type { KnowledgeBaseEntry } from "@/types"

/** Convert an absolute path to the ~/.claude/projects/ folder name format */
function pathToProjectId(p: string): string {
  return p.replace(/\//g, "-")
}

interface KnowledgeBaseClientProps {
  initialEntries: KnowledgeBaseEntry[]
}

export function KnowledgeBaseClient({ initialEntries }: KnowledgeBaseClientProps) {
  const router = useRouter()
  const [entries, setEntries] = useState<KnowledgeBaseEntry[]>(initialEntries)
  const [editTarget, setEditTarget] = useState<KnowledgeBaseEntry | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<KnowledgeBaseEntry | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/knowledge-base")
      const json = await res.json()
      if (res.ok) setEntries(json.data ?? [])
    } catch {
      // silent — keep stale data
    }
  }, [])

  // Poll for updates every 30s
  useEffect(() => {
    const id = setInterval(refresh, 30_000)
    return () => clearInterval(id)
  }, [refresh])

  const isDbEntry = (entry: KnowledgeBaseEntry) =>
    entry.source === "db" || entry.source === "both"

  if (entries.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex justify-end">
          <AddPathDialog onAdded={refresh} />
        </div>
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
          <BookOpen className="mb-3 h-10 w-10 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">No paths indexed</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add project directories to build your knowledge base.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <AddPathDialog onAdded={refresh} />
      </div>

      <div className="rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[200px]">Name</TableHead>
              <TableHead>Path</TableHead>
              <TableHead className="w-[200px]">Tags</TableHead>
              <TableHead className="w-[100px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow
                key={`${entry.source}-${entry.id}`}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => {
                  // DB entries use numeric ID for reliable lookup; filesystem-only entries use path-encoded ID
                  const projectId = entry.id > 0 ? String(entry.id) : encodeURIComponent(pathToProjectId(entry.path))
                  router.push(`/knowledge-base/${projectId}`)
                }}
              >
                <TableCell>
                  <div className="flex items-center gap-2">
                    <FolderOpen className="h-4 w-4 shrink-0 text-amber-400" />
                    <span className="text-sm font-medium">{entry.name}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {entry.path}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {(entry.tags ?? []).map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-[10px]">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    {isDbEntry(entry) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={(e) => { e.stopPropagation(); setEditTarget(entry) }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(entry) }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <EditPathDialog
        entry={editTarget}
        open={editTarget !== null}
        onOpenChange={(open) => { if (!open) setEditTarget(null) }}
        onUpdated={refresh}
      />

      <DeletePathDialog
        entry={deleteTarget}
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        onDeleted={refresh}
      />
    </div>
  )
}

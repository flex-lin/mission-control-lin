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
import { FolderOpen, Pencil, Trash2, BookOpen, Lock } from "lucide-react"
import { AddPathDialog } from "./add-path-dialog"
import { EditPathDialog } from "./edit-path-dialog"
import { DeletePathDialog } from "./delete-path-dialog"
import type { KnowledgeBaseEntry } from "@/types"

interface KnowledgeBaseClientProps {
  initialEntries: KnowledgeBaseEntry[]
}

export function KnowledgeBaseClient({ initialEntries }: KnowledgeBaseClientProps) {
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

  const isEditable = (entry: KnowledgeBaseEntry) =>
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
              <TableHead className="w-[100px]">Source</TableHead>
              <TableHead className="w-[120px]">Last Scanned</TableHead>
              <TableHead className="w-[80px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={`${entry.source}-${entry.id}`}>
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
                <TableCell>
                  <Badge
                    variant={entry.source === "filesystem" ? "outline" : "secondary"}
                    className="text-[10px]"
                  >
                    {entry.source === "filesystem" && (
                      <Lock className="mr-1 h-2.5 w-2.5" />
                    )}
                    {entry.source}
                  </Badge>
                </TableCell>
                <TableCell>
                  <span className="text-xs text-muted-foreground">
                    {entry.lastScanned
                      ? new Date(entry.lastScanned).toLocaleDateString()
                      : "Never"}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  {isEditable(entry) ? (
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setEditTarget(entry)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(entry)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">Read-only</span>
                  )}
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

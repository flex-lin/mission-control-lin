"use client"

import { useState } from "react"
import { Trash2, MessageSquare, Clock, Pencil, Check, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export interface ChatSessionSummary {
  id: string
  title: string | null
  messageCount: number
  createdAt: string
  updatedAt: string
}

interface ChatSessionListProps {
  sessions: ChatSessionSummary[]
  activeSessionId: string | null
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onRename: (id: string, title: string) => void
  onClearAll: () => void
}

export function ChatSessionList({
  sessions,
  activeSessionId,
  onSelect,
  onDelete,
  onRename,
  onClearAll,
}: ChatSessionListProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState("")

  const startEditing = (session: ChatSessionSummary) => {
    setEditingId(session.id)
    setEditTitle(session.title || "")
  }

  const commitEdit = (id: string) => {
    if (editTitle.trim()) {
      onRename(id, editTitle.trim())
    }
    setEditingId(null)
  }

  const cancelEdit = () => {
    setEditingId(null)
  }

  function formatRelative(dateStr: string): string {
    const d = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1) return "just now"
    if (diffMin < 60) return `${diffMin}m ago`
    const diffHr = Math.floor(diffMin / 60)
    if (diffHr < 24) return `${diffHr}h ago`
    const diffDay = Math.floor(diffHr / 24)
    if (diffDay < 7) return `${diffDay}d ago`
    return d.toLocaleDateString()
  }

  if (sessions.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <Clock className="h-8 w-8 text-[hsl(var(--muted-foreground))]" />
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          No past sessions
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        {sessions.map((session) => (
          <div
            key={session.id}
            className={cn(
              "group flex items-center gap-2 border-b border-[hsl(var(--border))] px-3 py-2.5 cursor-pointer hover:bg-[hsl(var(--muted))]",
              session.id === activeSessionId && "bg-[hsl(var(--muted))]"
            )}
            onClick={() => {
              if (editingId !== session.id) onSelect(session.id)
            }}
          >
            <MessageSquare className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
            <div className="flex-1 min-w-0">
              {editingId === session.id ? (
                <div className="flex items-center gap-1">
                  <input
                    className="flex-1 bg-transparent text-sm border-b border-[hsl(var(--border))] outline-none"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitEdit(session.id)
                      if (e.key === "Escape") cancelEdit()
                    }}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                  />
                  <button
                    className="p-0.5 hover:text-green-400"
                    onClick={(e) => { e.stopPropagation(); commitEdit(session.id) }}
                  >
                    <Check className="h-3 w-3" />
                  </button>
                  <button
                    className="p-0.5 hover:text-red-400"
                    onClick={(e) => { e.stopPropagation(); cancelEdit() }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <p className="text-sm truncate text-[hsl(var(--foreground))]">
                  {session.title || "Untitled session"}
                </p>
              )}
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                {session.messageCount} messages · {formatRelative(session.updatedAt)}
              </p>
            </div>
            {editingId !== session.id && (
              <div className="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  className="p-1 rounded hover:bg-[hsl(var(--background))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                  onClick={(e) => { e.stopPropagation(); startEditing(session) }}
                  title="Rename"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  className="p-1 rounded hover:bg-red-500/10 text-[hsl(var(--muted-foreground))] hover:text-red-400"
                  onClick={(e) => { e.stopPropagation(); onDelete(session.id) }}
                  title="Delete"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {sessions.length > 1 && (
        <div className="border-t border-[hsl(var(--border))] p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10"
            onClick={onClearAll}
          >
            <Trash2 className="mr-1 h-3 w-3" />
            Clear all sessions
          </Button>
        </div>
      )}
    </div>
  )
}

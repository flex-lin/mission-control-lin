"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight, Wrench, CheckCircle2, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ToolCall, ToolResult } from "./chat-message"

interface ChatToolResultProps {
  toolCall: ToolCall
  result?: ToolResult
}

export function ChatToolResult({ toolCall, result }: ChatToolResultProps) {
  const [expanded, setExpanded] = useState(false)
  const hasResult = !!result

  return (
    <div className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-sm">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[hsl(var(--accent))] transition-colors rounded-lg"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
        )}
        <Wrench className="h-3.5 w-3.5 shrink-0 text-amber-400" />
        <span className="flex-1 truncate font-medium text-[hsl(var(--foreground))]">
          {formatToolName(toolCall.name)}
        </span>
        {hasResult ? (
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
        ) : (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[hsl(var(--muted-foreground))]" />
        )}
      </button>
      {expanded && (
        <div className="border-t border-[hsl(var(--border))] px-3 py-2 space-y-2">
          {Object.keys(toolCall.input).length > 0 && (
            <div>
              <p className="text-xs font-medium text-[hsl(var(--muted-foreground))] mb-1">
                Input
              </p>
              <pre className="overflow-x-auto rounded bg-[hsl(var(--muted))] p-2 text-xs text-[hsl(var(--foreground))]">
                {JSON.stringify(toolCall.input, null, 2)}
              </pre>
            </div>
          )}
          {hasResult && (
            <div>
              <p className="text-xs font-medium text-[hsl(var(--muted-foreground))] mb-1">
                Result
              </p>
              <pre
                className={cn(
                  "overflow-x-auto rounded p-2 text-xs max-h-48",
                  "bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]"
                )}
              >
                {typeof result.result === "string"
                  ? result.result
                  : JSON.stringify(result.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function formatToolName(name: string): string {
  return name
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

"use client"

import { Terminal, Copy } from "lucide-react"
import { toast } from "sonner"

interface TmuxAttachBarProps {
  attachCmd: string
  alive: boolean
}

export function TmuxAttachBar({ attachCmd, alive }: TmuxAttachBarProps) {
  if (!alive) return null

  function handleCopy() {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(attachCmd).then(
        () => toast.success("Copied to clipboard"),
        () => window.prompt("Copy this command:", attachCmd)
      )
    } else {
      window.prompt("Copy this command:", attachCmd)
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-1.5">
      <Terminal className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
      <code className="flex-1 truncate text-xs text-emerald-300">{attachCmd}</code>
      <button
        type="button"
        onClick={handleCopy}
        className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        title="Copy attach command"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

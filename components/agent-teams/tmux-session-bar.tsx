"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Terminal, Copy, Check } from "lucide-react"
import { toast } from "sonner"
import { useState } from "react"

interface SessionInfo {
  name: string
  sessionName: string
  alive: boolean
  attachCmd: string
}

interface TmuxSessionBarProps {
  sessions: SessionInfo[]
}

function CopyButton({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(cmd).then(
        () => {
          setCopied(true)
          toast.success("Copied to clipboard")
          setTimeout(() => setCopied(false), 2000)
        },
        () => {
          window.prompt("Copy this command:", cmd)
        }
      )
    } else {
      window.prompt("Copy this command:", cmd)
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
      onClick={handleCopy}
    >
      {copied ? (
        <Check className="h-3 w-3 text-emerald-400" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
    </Button>
  )
}

export function TmuxSessionBar({ sessions }: TmuxSessionBarProps) {
  if (sessions.length === 0) return null

  return (
    <Card>
      <CardContent className="flex items-center gap-2 px-3 py-2">
        <Terminal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 text-[11px] font-medium text-muted-foreground">
          Sessions
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {sessions.map((session) => (
            <div
              key={session.name}
              className={`flex items-center gap-1.5 rounded-md border px-2 py-1 ${
                session.alive
                  ? "border-border bg-background"
                  : "border-border/40 bg-muted/30 opacity-60"
              }`}
            >
              <span
                className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                  session.alive ? "bg-emerald-400" : "bg-muted-foreground/50"
                }`}
              />
              <span className="text-[11px] font-medium">{session.name}</span>
              {session.alive && (
                <>
                  <code className="text-[10px] text-muted-foreground">
                    {session.attachCmd}
                  </code>
                  <CopyButton cmd={session.attachCmd} />
                </>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

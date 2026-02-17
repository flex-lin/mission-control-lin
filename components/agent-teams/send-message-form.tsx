"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Team } from "@/types"
import { Send } from "lucide-react"

interface SendMessageFormProps {
  team: Team
  onSuccess?: () => void
}

export function SendMessageForm({ team, onSuccess }: SendMessageFormProps) {
  const [recipient, setRecipient] = useState("__broadcast__")
  const [content, setContent] = useState("")
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!content.trim()) return

    setLoading(true)
    setResult(null)

    try {
      const res = await fetch(`/api/teams/${encodeURIComponent(team.name)}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: recipient === "__broadcast__" ? "broadcast" : "message",
          recipient: recipient === "__broadcast__" ? undefined : recipient,
          content: content.trim(),
          summary: content.trim().slice(0, 60),
        }),
      })
      const json = await res.json()
      if (res.ok) {
        setResult({ ok: true, message: "Message sent" })
        setContent("")
        onSuccess?.()
      } else {
        setResult({ ok: false, message: json.error ?? "Failed to send message" })
      }
    } catch {
      setResult({ ok: false, message: "Network error" })
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label>Recipient</Label>
        <Select value={recipient} onValueChange={setRecipient}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__broadcast__">Broadcast to all</SelectItem>
            {team.members.map((m) => (
              <SelectItem key={m.agentId} value={m.name}>
                {m.name} ({m.agentType})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="msg-content">Message</Label>
        <Textarea
          id="msg-content"
          placeholder="Type your message…"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={4}
          required
        />
      </div>

      {result && (
        <p className={`text-xs ${result.ok ? "text-emerald-400" : "text-red-400"}`}>
          {result.message}
        </p>
      )}

      <Button type="submit" disabled={loading || !content.trim()} className="gap-1.5">
        <Send className="h-3.5 w-3.5" />
        {loading ? "Sending…" : "Send Message"}
      </Button>
    </form>
  )
}

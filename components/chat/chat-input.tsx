"use client"

import { useRef, useCallback } from "react"
import { Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

interface ChatInputProps {
  onSend: (message: string) => void
  disabled?: boolean
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSend = useCallback(() => {
    const value = textareaRef.current?.value.trim()
    if (!value || disabled) return
    onSend(value)
    if (textareaRef.current) {
      textareaRef.current.value = ""
      textareaRef.current.style.height = "auto"
    }
  }, [onSend, disabled])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const el = e.target
      el.style.height = "auto"
      el.style.height = Math.min(el.scrollHeight, 120) + "px"
    },
    []
  )

  return (
    <div className="flex items-end gap-2 border-t border-[hsl(var(--border))] p-3">
      <Textarea
        ref={textareaRef}
        placeholder="Ask about teams, tasks, or knowledge base..."
        className="min-h-[40px] max-h-[120px] resize-none border-0 bg-[hsl(var(--muted))] focus-visible:ring-0 text-sm"
        rows={1}
        onKeyDown={handleKeyDown}
        onChange={handleInput}
        disabled={disabled}
      />
      <Button
        size="icon"
        variant="ghost"
        onClick={handleSend}
        disabled={disabled}
        className="shrink-0 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
      >
        <Send className="h-4 w-4" />
      </Button>
    </div>
  )
}

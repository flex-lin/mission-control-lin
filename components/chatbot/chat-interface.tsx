"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Bot,
  User,
  Send,
  Loader2,
  RotateCcw,
  ChevronDown,
  Sparkles,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: Date
  error?: boolean
}

const QUICK_ACTIONS = [
  { label: "Show all teams", prompt: "List all agent teams and their current status" },
  { label: "Queue status", prompt: "What is the current queue worker status and how many tasks are pending?" },
  { label: "Stuck tasks", prompt: "Are there any stuck or blocked tasks I should know about?" },
  { label: "Dashboard stats", prompt: "Give me a quick overview of the dashboard statistics" },
  { label: "Submit a task", prompt: "I want to submit a new task to the queue. Can you help me?" },
  { label: "Analytics", prompt: "Show me the token usage analytics for the past 7 days" },
]

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user"

  return (
    <div
      className={cn(
        "flex gap-3 px-4 py-3",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
          isUser
            ? "bg-blue-500/20 text-blue-400"
            : "bg-emerald-500/20 text-emerald-400"
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>

      {/* Content */}
      <div
        className={cn(
          "flex max-w-[80%] flex-col gap-1",
          isUser ? "items-end" : "items-start"
        )}
      >
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
            isUser
              ? "bg-blue-600 text-white rounded-tr-sm"
              : message.error
                ? "bg-red-500/10 text-red-400 border border-red-500/20 rounded-tl-sm"
                : "bg-[hsl(var(--muted))] text-[hsl(var(--foreground))] rounded-tl-sm"
          )}
        >
          <MessageContent content={message.content} />
        </div>
        <span className="px-1 text-[10px] text-[hsl(var(--muted-foreground))]">
          {formatTime(message.timestamp)}
        </span>
      </div>
    </div>
  )
}

// Simple markdown-like renderer for assistant messages
function MessageContent({ content }: { content: string }) {
  const lines = content.split("\n")
  const elements: React.ReactNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Code block
    if (line.startsWith("```")) {
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i])
        i++
      }
      elements.push(
        <pre
          key={i}
          className="my-1.5 overflow-x-auto rounded-lg bg-black/30 px-3 py-2 text-xs font-mono leading-relaxed"
        >
          {codeLines.join("\n")}
        </pre>
      )
      i++
      continue
    }

    // Heading
    if (line.startsWith("### ")) {
      elements.push(
        <p key={i} className="mt-2 mb-1 font-semibold text-sm">
          {line.slice(4)}
        </p>
      )
      i++
      continue
    }
    if (line.startsWith("## ")) {
      elements.push(
        <p key={i} className="mt-2 mb-1 font-semibold">
          {line.slice(3)}
        </p>
      )
      i++
      continue
    }

    // Bullet list item
    if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(
        <div key={i} className="flex gap-1.5 my-0.5">
          <span className="mt-0.5 shrink-0 text-[hsl(var(--muted-foreground))]">•</span>
          <span>{renderInline(line.slice(2))}</span>
        </div>
      )
      i++
      continue
    }

    // Numbered list item
    if (/^\d+\. /.test(line)) {
      const num = line.match(/^(\d+)\. /)?.[1]
      elements.push(
        <div key={i} className="flex gap-1.5 my-0.5">
          <span className="mt-0 shrink-0 text-[hsl(var(--muted-foreground))] tabular-nums">{num}.</span>
          <span>{renderInline(line.replace(/^\d+\. /, ""))}</span>
        </div>
      )
      i++
      continue
    }

    // Empty line → spacing
    if (line.trim() === "") {
      elements.push(<div key={i} className="h-1.5" />)
      i++
      continue
    }

    // Regular paragraph
    elements.push(
      <p key={i} className="my-0.5 leading-relaxed">
        {renderInline(line)}
      </p>
    )
    i++
  }

  return <>{elements}</>
}

// Render inline elements: bold, code, italic
function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} className="rounded bg-black/20 px-1 py-0.5 text-xs font-mono">
          {part.slice(1, -1)}
        </code>
      )
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={i}>{part.slice(1, -1)}</em>
    }
    return part
  })
}

export function ChatInterface() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = useCallback((smooth = true) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "instant" })
  }, [])

  // Auto-scroll when new messages arrive
  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  // Track whether to show scroll-to-bottom button
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el
      setShowScrollButton(scrollHeight - scrollTop - clientHeight > 200)
    }
    el.addEventListener("scroll", handleScroll, { passive: true })
    return () => el.removeEventListener("scroll", handleScroll)
  }, [])

  async function sendMessage(text: string) {
    const trimmed = text.trim()
    if (!trimmed || loading) return

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMsg])
    setInput("")
    setLoading(true)

    // Build message history for the API
    const history = [...messages, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }))

    try {
      const res = await fetch("/api/chatbot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      })

      const data = await res.json() as { reply?: string; error?: string }

      if (!res.ok || data.error) {
        throw new Error(data.error ?? `Request failed: HTTP ${res.status}`)
      }

      const assistantMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: data.reply ?? "(no response)",
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, assistantMsg])
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: err instanceof Error ? err.message : "An unexpected error occurred",
        timestamp: new Date(),
        error: true,
      }
      setMessages((prev) => [...prev, errorMsg])
    } finally {
      setLoading(false)
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  function clearChat() {
    setMessages([])
    setInput("")
    textareaRef.current?.focus()
  }

  const isEmpty = messages.length === 0

  return (
    <div className="flex h-full flex-col">
      {/* Message list */}
      <div className="relative flex-1 overflow-hidden">
        <div ref={viewportRef} className="h-full overflow-y-auto">
          {isEmpty ? (
            /* Empty state with quick actions */
            <div className="flex h-full flex-col items-center justify-center px-4 py-12">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10">
                <Sparkles className="h-6 w-6 text-emerald-400" />
              </div>
              <h2 className="mb-1 text-base font-semibold">Mission Control Assistant</h2>
              <p className="mb-8 max-w-sm text-center text-sm text-[hsl(var(--muted-foreground))]">
                Ask me anything about your agent teams, tasks, analytics, or have me take actions on your behalf.
              </p>
              <div className="grid w-full max-w-lg grid-cols-2 gap-2">
                {QUICK_ACTIONS.map((action) => (
                  <button
                    key={action.label}
                    onClick={() => sendMessage(action.prompt)}
                    className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/50 px-3 py-2.5 text-left text-xs text-[hsl(var(--foreground))] transition-colors hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--accent-foreground))]"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="pb-4 pt-2">
              {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))}
              {loading && (
                <div className="flex gap-3 px-4 py-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm bg-[hsl(var(--muted))] px-4 py-2.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-[hsl(var(--muted-foreground))]" />
                    <span className="text-xs text-[hsl(var(--muted-foreground))]">Thinking...</span>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Scroll to bottom button */}
        {showScrollButton && (
          <button
            onClick={() => scrollToBottom()}
            className="absolute bottom-4 right-4 flex h-8 w-8 items-center justify-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--background))] shadow-md transition-opacity hover:bg-[hsl(var(--accent))]"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-[hsl(var(--border))] bg-[hsl(var(--background))] p-4">
        <div className="flex items-end gap-2">
          <div className="relative flex-1">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about teams, submit tasks, check analytics... (Enter to send, Shift+Enter for newline)"
              disabled={loading}
              rows={1}
              className="min-h-[40px] max-h-[160px] resize-none pr-2 text-sm leading-relaxed"
              style={{
                height: "auto",
                overflowY: input.split("\n").length > 4 ? "auto" : "hidden",
              }}
              onInput={(e) => {
                const el = e.currentTarget
                el.style.height = "auto"
                el.style.height = Math.min(el.scrollHeight, 160) + "px"
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Button
              size="icon"
              onClick={() => sendMessage(input)}
              disabled={loading || !input.trim()}
              className="h-9 w-9 shrink-0"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
            {messages.length > 0 && (
              <Button
                size="icon"
                variant="outline"
                onClick={clearChat}
                disabled={loading}
                className="h-9 w-9 shrink-0"
                title="Clear conversation"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
        <p className="mt-1.5 text-[10px] text-[hsl(var(--muted-foreground))]">
          Powered by Claude Sonnet — can read and manage teams, queue, and analytics
        </p>
      </div>
    </div>
  )
}

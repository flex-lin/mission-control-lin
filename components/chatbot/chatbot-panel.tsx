"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Bot, Send, Loader2, User, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

export interface Message {
  role: "user" | "assistant"
  content: string
  timestamp: Date
}

interface ChatbotPanelProps {
  className?: string
}

export function ChatbotPanel({ className }: ChatbotPanelProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Hello! I'm the Mission Control assistant. I can help you manage agent teams, submit tasks, check analytics, debug issues, and more. What would you like to do?",
      timestamp: new Date(),
    },
  ])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim()
    if (!trimmed || isLoading) return

    const userMessage: Message = {
      role: "user",
      content: trimmed,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput("")
    setIsLoading(true)

    try {
      // Build the conversation history (exclude timestamps, just role+content)
      const history = [...messages, userMessage].map((m) => ({
        role: m.role,
        content: m.content,
      }))

      const res = await fetch("/api/chatbot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      })

      if (!res.ok) {
        const body = (await res.json()) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }

      const body = (await res.json()) as { data?: { message?: string }; reply?: string }
      const reply = body.data?.message ?? body.reply ?? "No response received."

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: reply,
          timestamp: new Date(),
        },
      ])
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to get response"
      toast.error(`Chatbot error: ${message}`)
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Sorry, I encountered an error: ${message}`,
          timestamp: new Date(),
        },
      ])
    } finally {
      setIsLoading(false)
      textareaRef.current?.focus()
    }
  }, [input, isLoading, messages])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void sendMessage()
    }
  }

  const clearConversation = () => {
    setMessages([
      {
        role: "assistant",
        content:
          "Conversation cleared. How can I help you?",
        timestamp: new Date(),
      },
    ])
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))]">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-blue-400" />
          <span className="text-sm font-semibold">Mission Control Assistant</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={clearConversation}
          className="h-7 px-2 text-xs text-[hsl(var(--muted-foreground))]"
          title="Clear conversation"
        >
          <Trash2 className="h-3.5 w-3.5 mr-1" />
          Clear
        </Button>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 px-4 py-3">
        <div className="space-y-4">
          {messages.map((msg, idx) => (
            <MessageBubble key={idx} message={msg} />
          ))}
          {isLoading && <TypingIndicator />}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="px-4 py-3 border-t border-[hsl(var(--border))]">
        <div className="flex gap-2 items-end">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask me to submit a task, check team status, view analytics..."
            className="min-h-[60px] max-h-[120px] resize-none text-sm"
            disabled={isLoading}
            rows={2}
          />
          <Button
            onClick={() => void sendMessage()}
            disabled={isLoading || !input.trim()}
            size="sm"
            className="h-9 w-9 p-0 shrink-0"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-1.5">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user"
  return (
    <div className={cn("flex gap-3", isUser ? "flex-row-reverse" : "flex-row")}>
      {/* Avatar */}
      <div
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
          isUser
            ? "bg-blue-500/20 text-blue-400"
            : "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"
        )}
      >
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>

      {/* Bubble */}
      <div
        className={cn(
          "max-w-[80%] rounded-lg px-3 py-2 text-sm",
          isUser
            ? "bg-blue-500/15 text-[hsl(var(--foreground))]"
            : "bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]"
        )}
      >
        <pre className="whitespace-pre-wrap font-sans leading-relaxed">{message.content}</pre>
        <span className="block text-[10px] text-[hsl(var(--muted-foreground))] mt-1">
          {message.timestamp.toLocaleTimeString()}
        </span>
      </div>
    </div>
  )
}

function TypingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]">
        <Bot className="h-3.5 w-3.5" />
      </div>
      <div className="flex items-center gap-1 rounded-lg bg-[hsl(var(--muted))] px-3 py-2">
        <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--muted-foreground))] animate-bounce [animation-delay:0ms]" />
        <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--muted-foreground))] animate-bounce [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--muted-foreground))] animate-bounce [animation-delay:300ms]" />
      </div>
    </div>
  )
}

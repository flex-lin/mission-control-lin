"use client"

import { useEffect, useRef } from "react"
import { ChatMessage, type ChatMessageData } from "./chat-message"
import { Bot } from "lucide-react"

interface ChatMessagesProps {
  messages: ChatMessageData[]
}

export function ChatMessages({ messages }: ChatMessagesProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, messages[messages.length - 1]?.content])

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
          <Bot className="h-6 w-6 text-emerald-400" />
        </div>
        <div>
          <p className="text-sm font-medium text-[hsl(var(--foreground))]">
            Mission Control Assistant
          </p>
          <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
            Ask about agent teams, submit tasks, or query the knowledge base.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex flex-col gap-1 py-4">
        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

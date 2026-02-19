"use client"

import { cn } from "@/lib/utils"
import { Bot, User } from "lucide-react"
import { ChatToolResult } from "./chat-tool-result"

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolResult {
  toolCallId: string
  name: string
  result: unknown
}

export interface ChatMessageData {
  id: string
  role: "user" | "assistant"
  content: string
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
  isStreaming?: boolean
}

export function ChatMessage({ message }: { message: ChatMessageData }) {
  const isUser = message.role === "user"

  return (
    <div className={cn("flex gap-3 px-4 py-3", isUser && "flex-row-reverse")}>
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
      <div
        className={cn(
          "flex max-w-[85%] flex-col gap-2",
          isUser && "items-end"
        )}
      >
        {message.content && (
          <div
            className={cn(
              "rounded-lg px-3 py-2 text-sm leading-relaxed",
              isUser
                ? "bg-blue-600/20 text-[hsl(var(--foreground))]"
                : "bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]"
            )}
          >
            <MessageContent content={message.content} />
          </div>
        )}
        {message.toolCalls?.map((tool) => {
          const result = message.toolResults?.find(
            (r) => r.toolCallId === tool.id
          )
          return (
            <ChatToolResult key={tool.id} toolCall={tool} result={result} />
          )
        })}
        {message.isStreaming && !message.content && !message.toolCalls?.length && (
          <div className="flex items-center gap-1 px-3 py-2">
            <span className="h-2 w-2 animate-bounce rounded-full bg-[hsl(var(--muted-foreground))] [animation-delay:0ms]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-[hsl(var(--muted-foreground))] [animation-delay:150ms]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-[hsl(var(--muted-foreground))] [animation-delay:300ms]" />
          </div>
        )}
        {!isUser && !message.isStreaming && !message.content && !message.toolCalls?.length && (
          <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
            Failed to get a response. Check that ANTHROPIC_API_KEY is set.
          </div>
        )}
      </div>
    </div>
  )
}

function MessageContent({ content }: { content: string }) {
  // Simple markdown-like rendering: bold, code blocks, inline code, line breaks
  const parts = content.split(/(```[\s\S]*?```|`[^`]+`|\*\*[^*]+\*\*|\n)/g)

  return (
    <div className="whitespace-pre-wrap break-words">
      {parts.map((part, i) => {
        if (part.startsWith("```") && part.endsWith("```")) {
          const code = part.slice(3, -3).replace(/^\w+\n/, "")
          return (
            <pre
              key={i}
              className="my-2 overflow-x-auto rounded bg-[hsl(var(--background))] p-2 text-xs"
            >
              <code>{code}</code>
            </pre>
          )
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <code
              key={i}
              className="rounded bg-[hsl(var(--background))] px-1 py-0.5 text-xs"
            >
              {part.slice(1, -1)}
            </code>
          )
        }
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={i} className="font-semibold">
              {part.slice(2, -2)}
            </strong>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </div>
  )
}

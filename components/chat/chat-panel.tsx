"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { MessageSquare, RotateCcw, History, ArrowLeft, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { ChatMessages } from "./chat-messages"
import { ChatInput } from "./chat-input"
import { ChatSessionList, type ChatSessionSummary } from "./chat-session-list"
import type { ChatMessageData, ToolCall, ToolResult } from "./chat-message"

function generateId(): string {
  return crypto.randomUUID()
}

type View = "chat" | "sessions"

export function ChatPanel() {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<View>("chat")
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessageData[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // Fetch sessions list
  const fetchSessions = useCallback(async () => {
    setSessionsLoading(true)
    try {
      const res = await fetch("/api/chat/sessions")
      if (res.ok) {
        const json = await res.json()
        setSessions(json.data ?? [])
      }
    } catch {
      // ignore
    } finally {
      setSessionsLoading(false)
    }
  }, [])

  // When opening sessions view, refresh the list
  useEffect(() => {
    if (view === "sessions") {
      fetchSessions()
    }
  }, [view, fetchSessions])

  // Start a fresh session
  const handleNewChat = useCallback(() => {
    abortRef.current?.abort()
    setSessionId(null)
    setMessages([])
    setIsStreaming(false)
    setView("chat")
  }, [])

  // Load a session from history
  const handleLoadSession = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/chat/sessions/${id}`)
      if (!res.ok) return
      const json = await res.json()
      const data = json.data
      setSessionId(data.id)
      setMessages(
        (data.messages ?? []).map((m: { id: string; role: string; content: string; toolCalls?: ToolCall[]; toolResults?: ToolResult[] }) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
          toolCalls: m.toolCalls,
          toolResults: m.toolResults,
          isStreaming: false,
        }))
      )
      setView("chat")
    } catch {
      // ignore
    }
  }, [])

  // Delete a session
  const handleDeleteSession = useCallback(async (id: string) => {
    try {
      await fetch(`/api/chat/sessions/${id}`, { method: "DELETE" })
      setSessions((prev) => prev.filter((s) => s.id !== id))
      // If we deleted the active session, clear it
      if (id === sessionId) {
        setSessionId(null)
        setMessages([])
      }
    } catch {
      // ignore
    }
  }, [sessionId])

  // Rename a session
  const handleRenameSession = useCallback(async (id: string, title: string) => {
    try {
      await fetch(`/api/chat/sessions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      })
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, title } : s))
      )
    } catch {
      // ignore
    }
  }, [])

  // Clear all sessions
  const handleClearAll = useCallback(async () => {
    try {
      await fetch("/api/chat/sessions", { method: "DELETE" })
      setSessions([])
      setSessionId(null)
      setMessages([])
      setView("chat")
    } catch {
      // ignore
    }
  }, [])

  const handleSend = useCallback(
    async (content: string) => {
      const userMsg: ChatMessageData = {
        id: generateId(),
        role: "user",
        content,
      }

      const assistantMsg: ChatMessageData = {
        id: generateId(),
        role: "assistant",
        content: "",
        toolCalls: [],
        toolResults: [],
        isStreaming: true,
      }

      const updatedMessages = [...messages, userMsg]
      setMessages([...updatedMessages, assistantMsg])
      setIsStreaming(true)

      // Build the message history for the API (exclude streaming metadata)
      const apiMessages = updatedMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }))

      const controller = new AbortController()
      abortRef.current = controller

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: apiMessages,
            sessionId,
          }),
          signal: controller.signal,
        })

        if (!res.ok) {
          const errText = await res.text()
          let errorDetail = errText
          try {
            const parsed = JSON.parse(errText) as { error?: string; message?: string }
            errorDetail = parsed.error ?? parsed.message ?? errText
          } catch { /* use raw text */ }
          assistantMsg.content = `Error: ${errorDetail}`
          assistantMsg.isStreaming = false
          const finalMsgs = [...updatedMessages, assistantMsg]
          setMessages(finalMsgs)
          setIsStreaming(false)
          return
        }

        const reader = res.body?.getReader()
        if (!reader) {
          assistantMsg.content = "Error: No response stream"
          assistantMsg.isStreaming = false
          const finalMsgs = [...updatedMessages, assistantMsg]
          setMessages(finalMsgs)
          setIsStreaming(false)
          return
        }

        const decoder = new TextDecoder()
        let buffer = ""
        const toolCalls: ToolCall[] = []
        const toolResults: ToolResult[] = []
        let textContent = ""

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })

          // Parse SSE events
          const lines = buffer.split("\n")
          buffer = lines.pop() || ""

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue
            const data = line.slice(6).trim()
            if (data === "[DONE]") continue

            try {
              const event = JSON.parse(data)

              // Capture sessionId from the server
              if (event.type === "session" && event.sessionId) {
                setSessionId(event.sessionId)
                continue
              }

              processStreamEvent(
                event,
                toolCalls,
                toolResults,
                (delta) => {
                  textContent += delta
                },
              )
            } catch {
              // skip unparseable lines
            }
          }

          // Update the assistant message in state
          setMessages([
            ...updatedMessages,
            {
              ...assistantMsg,
              content: textContent,
              toolCalls: [...toolCalls],
              toolResults: [...toolResults],
              isStreaming: true,
            },
          ])
        }

        // Finalize
        const finalAssistant: ChatMessageData = {
          ...assistantMsg,
          content: textContent,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          toolResults: toolResults.length > 0 ? toolResults : undefined,
          isStreaming: false,
        }
        const finalMsgs = [...updatedMessages, finalAssistant]
        setMessages(finalMsgs)
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return
        assistantMsg.content =
          `Error: ${err instanceof Error ? err.message : "Unknown error"}`
        assistantMsg.isStreaming = false
        const finalMsgs = [...updatedMessages, assistantMsg]
        setMessages(finalMsgs)
      } finally {
        setIsStreaming(false)
      }
    },
    [messages, sessionId]
  )

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 h-12 w-12 rounded-full bg-blue-600 text-white shadow-lg hover:bg-blue-700 hover:text-white"
      >
        <MessageSquare className="h-5 w-5" />
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="flex w-full flex-col p-0 sm:max-w-md"
        >
          {view === "chat" ? (
            <>
              <SheetHeader className="flex flex-row items-center justify-between border-b border-[hsl(var(--border))] px-4 py-3 space-y-0">
                <div className="flex-1 min-w-0">
                  <SheetTitle className="text-base">Assistant</SheetTitle>
                  <SheetDescription className="text-xs">
                    {sessionId ? "Session active" : "New session"}
                  </SheetDescription>
                </div>
                <div className="flex items-center gap-1 shrink-0 mr-6">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setView("sessions")}
                    className="h-8 w-8"
                    title="Session history"
                  >
                    <History className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleNewChat}
                    className="h-8 w-8"
                    title="New session"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </SheetHeader>

              <ChatMessages messages={messages} />

              <ChatInput onSend={handleSend} disabled={isStreaming} />
            </>
          ) : (
            <>
              <SheetHeader className="flex flex-row items-center gap-2 border-b border-[hsl(var(--border))] px-4 py-3 space-y-0">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setView("chat")}
                  className="h-8 w-8 shrink-0"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="flex-1 min-w-0">
                  <SheetTitle className="text-base">Sessions</SheetTitle>
                  <SheetDescription className="text-xs">
                    {sessions.length} past {sessions.length === 1 ? "session" : "sessions"}
                  </SheetDescription>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => { handleNewChat() }}
                  className="h-8 w-8 shrink-0 mr-6"
                  title="New session"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </SheetHeader>

              {sessionsLoading ? (
                <div className="flex flex-1 items-center justify-center">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-[hsl(var(--muted-foreground))] border-t-transparent" />
                </div>
              ) : (
                <ChatSessionList
                  sessions={sessions}
                  activeSessionId={sessionId}
                  onSelect={handleLoadSession}
                  onDelete={handleDeleteSession}
                  onRename={handleRenameSession}
                  onClearAll={handleClearAll}
                />
              )}
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}

/**
 * Process Anthropic streaming events.
 * Handles content_block_start, content_block_delta, and content_block_stop.
 */
function processStreamEvent(
  event: Record<string, unknown>,
  toolCalls: ToolCall[],
  toolResults: ToolResult[],
  onTextDelta: (text: string) => void,
) {
  const type = event.type as string

  switch (type) {
    case "content_block_start": {
      const block = event.content_block as Record<string, unknown> | undefined
      if (block?.type === "tool_use") {
        toolCalls.push({
          id: block.id as string,
          name: block.name as string,
          input: {},
        })
      }
      break
    }

    case "content_block_delta": {
      const delta = event.delta as Record<string, unknown> | undefined
      if (delta?.type === "text_delta") {
        onTextDelta(delta.text as string)
      } else if (delta?.type === "input_json_delta") {
        const lastTool = toolCalls[toolCalls.length - 1]
        if (lastTool) {
          const rec = lastTool as unknown as Record<string, unknown>
          const existing = (rec._partialJson as string) || ""
          rec._partialJson = existing + (delta.partial_json as string)
        }
      }
      break
    }

    case "content_block_stop": {
      const lastTool = toolCalls[toolCalls.length - 1]
      if (lastTool) {
        const rec = lastTool as unknown as Record<string, unknown>
        if (rec._partialJson) {
          try {
            lastTool.input = JSON.parse(rec._partialJson as string)
          } catch {
            // keep empty input
          }
          delete rec._partialJson
        }
      }
      break
    }

    case "tool_result": {
      toolResults.push({
        toolCallId: event.tool_use_id as string,
        name: event.name as string || "tool",
        result: event.content,
      })
      break
    }

    case "text": {
      onTextDelta(event.text as string)
      break
    }

    case "message_delta": {
      break
    }

    case "error": {
      const errorMsg = (event.error as string) || "An error occurred"
      onTextDelta(`Error: ${errorMsg}`)
      break
    }
  }
}

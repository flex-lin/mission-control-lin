import { Topbar } from "@/components/layout/topbar"
import { ChatInterface } from "@/components/chatbot/chat-interface"

export default function ChatbotPage() {
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Topbar
        title="Chatbot"
        subtitle="AI assistant for managing teams, tasks, and analytics"
      />
      <div className="flex-1 overflow-hidden">
        <ChatInterface />
      </div>
    </div>
  )
}

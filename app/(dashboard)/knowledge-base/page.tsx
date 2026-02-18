export const dynamic = "force-dynamic"

import { Topbar } from "@/components/layout/topbar"
import { KnowledgeBaseClient } from "@/components/knowledge-base/knowledge-base-client"
import type { KnowledgeBaseEntry } from "@/types"

async function getEntries(): Promise<KnowledgeBaseEntry[]> {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3777"
  try {
    const res = await fetch(`${base}/api/knowledge-base`, { cache: "no-store" })
    if (!res.ok) return []
    const json = await res.json()
    return json.data ?? []
  } catch {
    return []
  }
}

export default async function KnowledgeBasePage() {
  const entries = await getEntries()

  return (
    <div className="flex flex-col">
      <Topbar
        title="Knowledge Base"
        subtitle={`${entries.length} indexed path${entries.length !== 1 ? "s" : ""}`}
      />
      <div className="p-6">
        <KnowledgeBaseClient initialEntries={entries} />
      </div>
    </div>
  )
}

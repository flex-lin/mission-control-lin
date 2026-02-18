export const dynamic = "force-dynamic"
import { Topbar } from "@/components/layout/topbar"
import { SettingsForm } from "@/components/settings/settings-form"
import type { Settings } from "@/types"

async function getSettings(): Promise<Settings> {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3777"
  try {
    const res = await fetch(`${base}/api/settings`, { cache: "no-store" })
    if (!res.ok) return {}
    const json = await res.json()
    return json.data ?? {}
  } catch {
    return {}
  }
}

export default async function SettingsPage() {
  const settings = await getSettings()

  return (
    <div className="flex flex-col">
      <Topbar title="Settings" subtitle="Configure Mission Control Lin" />
      <div className="max-w-2xl p-6">
        <SettingsForm initialSettings={settings} />
      </div>
    </div>
  )
}

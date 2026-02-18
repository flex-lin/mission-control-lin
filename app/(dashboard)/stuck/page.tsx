import { Topbar } from "@/components/layout/topbar"
import { StuckPageClient } from "@/components/stuck/stuck-page-client"

export default function StuckPage() {
  return (
    <>
      <Topbar
        title="Stuck Teams"
        subtitle="Blockers across all teams that need your attention"
        live
      />
      <div className="p-6">
        <StuckPageClient />
      </div>
    </>
  )
}

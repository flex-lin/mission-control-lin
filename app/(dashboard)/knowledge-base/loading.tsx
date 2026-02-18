import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardHeader } from "@/components/ui/card"

export default function KnowledgeBaseLoading() {
  return (
    <div className="flex flex-col">
      {/* Topbar */}
      <div className="flex h-14 items-center border-b px-6">
        <div className="space-y-1">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-40" />
        </div>
      </div>

      <div className="p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <div className="flex items-start gap-2">
                  <Skeleton className="mt-0.5 h-4 w-4" />
                  <Skeleton className="h-4 w-36" />
                </div>
              </CardHeader>
              <CardContent>
                <Skeleton className="h-3 w-full" />
                <div className="mt-2 flex flex-wrap gap-1">
                  {Array.from({ length: 2 }).map((_, j) => (
                    <Skeleton key={j} className="h-5 w-14 rounded-full" />
                  ))}
                </div>
                <Skeleton className="mt-2 h-3 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}

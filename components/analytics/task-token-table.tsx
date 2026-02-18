"use client"

import { useState } from "react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Input } from "@/components/ui/input"
import { Search } from "lucide-react"

export interface TaskTokenEntry {
  taskId: string
  subject: string
  status: string
  owner: string | null
  teamName: string
  totalInput: number
  totalOutput: number
  totalTokens: number
  estimatedCost: number
  requests: number
  attribution?: "exact" | "team-level"
}

interface TaskTokenTableProps {
  data: TaskTokenEntry[]
}

export function TaskTokenTable({ data }: TaskTokenTableProps) {
  const [filter, setFilter] = useState("")

  const sorted = [...data].sort((a, b) => b.estimatedCost - a.estimatedCost)

  const filtered = filter
    ? sorted.filter(
        (t) =>
          t.subject.toLowerCase().includes(filter.toLowerCase()) ||
          t.teamName.toLowerCase().includes(filter.toLowerCase()) ||
          (t.owner ?? "").toLowerCase().includes(filter.toLowerCase())
      )
    : sorted

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Filter by name, team, or member…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="pl-9 text-xs"
        />
      </div>

      <ScrollArea className="h-96 rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Team</TableHead>
              <TableHead>Member</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Input</TableHead>
              <TableHead className="text-right">Output</TableHead>
              <TableHead className="text-right">Requests</TableHead>
              <TableHead className="text-right">Est. Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-xs text-muted-foreground">
                  {filter ? "No matching entries" : "No token data available"}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((entry) => {
                const isExact = entry.attribution === "exact"
                return (
                  <TableRow key={`${entry.teamName}:${entry.taskId}`}>
                    <TableCell className="text-xs max-w-[200px] truncate" title={entry.subject}>
                      {entry.subject}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {entry.teamName}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {entry.owner ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={isExact ? "default" : "secondary"}
                        className="text-[10px]"
                      >
                        {isExact ? "Member" : "Team"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {entry.totalInput.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {entry.totalOutput.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {entry.requests.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right text-xs font-medium text-emerald-400">
                      ${entry.estimatedCost.toFixed(4)}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  )
}

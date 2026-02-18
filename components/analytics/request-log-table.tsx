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
import type { ProxyLog } from "@/types"
import { format } from "date-fns"
import { Search } from "lucide-react"

interface RequestLogTableProps {
  logs: ProxyLog[]
}

export function RequestLogTable({ logs }: RequestLogTableProps) {
  const [filter, setFilter] = useState("")

  const filtered = filter
    ? logs.filter(
        (l) =>
          l.model.toLowerCase().includes(filter.toLowerCase()) ||
          (l.teamName ?? "").toLowerCase().includes(filter.toLowerCase()) ||
          (l.memberName ?? "").toLowerCase().includes(filter.toLowerCase()) ||
          l.endpoint.toLowerCase().includes(filter.toLowerCase())
      )
    : logs

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Filter by model, team, member, or endpoint…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="pl-9 text-xs"
        />
      </div>

      <ScrollArea className="h-96 rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Team</TableHead>
              <TableHead>Member</TableHead>
              <TableHead className="text-right">Input</TableHead>
              <TableHead className="text-right">Output</TableHead>
              <TableHead className="text-right">Latency</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-xs text-muted-foreground">
                  {filter ? "No matching requests" : "No proxy logs yet"}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {format(new Date(/[TZ+-]/.test(log.timestamp) ? log.timestamp : log.timestamp + "Z"), "MMM d HH:mm:ss")}
                  </TableCell>
                  <TableCell className="text-xs">{log.model}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {log.teamName ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {log.memberName ?? "—"}
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    {log.inputTokens.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    {log.outputTokens.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {log.latencyMs}ms
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={log.statusCode < 400 ? "success" : "destructive"}
                      className="text-[10px]"
                    >
                      {log.statusCode}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  )
}

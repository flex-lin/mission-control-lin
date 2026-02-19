import http from "http"
import https from "https"
import path from "path"
import fs from "fs"
import Database from "better-sqlite3"

interface SettingsFile {
  proxyConfig?: {
    enabled?: boolean
    port?: number
    targetUrl?: string
  }
}

function loadSettingsConfig(): { port: number; targetUrl: string } {
  const settingsPath = path.join(process.env.HOME ?? "/root", ".claude", "settings.json")
  let settings: SettingsFile = {}
  try {
    const raw = fs.readFileSync(settingsPath, "utf-8")
    settings = JSON.parse(raw) as SettingsFile
  } catch {
    // settings file missing or malformed — use defaults
  }

  const port = parseInt(process.env.PROXY_PORT ?? "", 10) ||
    settings.proxyConfig?.port ||
    8787

  const targetUrl = process.env.PROXY_TARGET_URL ??
    settings.proxyConfig?.targetUrl ??
    "https://api.anthropic.com"

  return { port, targetUrl }
}

const { port: PROXY_PORT, targetUrl: PROXY_TARGET_URL } = loadSettingsConfig()
const parsedTarget = new URL(PROXY_TARGET_URL)
const TARGET_HOST = parsedTarget.hostname
const TARGET_PORT = parsedTarget.port ? parseInt(parsedTarget.port, 10) : 443
const DB_PATH = path.resolve(process.cwd(), "prisma/mission-control.db")

// ─── DB Setup ─────────────────────────────────────────────────────────────────

function openDb(): Database.Database {
  const db = new Database(DB_PATH)
  db.exec(`
    CREATE TABLE IF NOT EXISTS proxy_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      model TEXT NOT NULL DEFAULT '',
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      team_name TEXT,
      member_name TEXT,
      endpoint TEXT NOT NULL DEFAULT '',
      latency_ms INTEGER NOT NULL DEFAULT 0,
      status_code INTEGER NOT NULL DEFAULT 0
    )
  `)
  // Migrations: add columns if missing
  const migrations = [
    `ALTER TABLE proxy_logs ADD COLUMN member_name TEXT`,
    `ALTER TABLE proxy_logs ADD COLUMN cache_read_tokens INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE proxy_logs ADD COLUMN cache_creation_tokens INTEGER NOT NULL DEFAULT 0`,
  ]
  for (const sql of migrations) {
    try { db.exec(sql) } catch { /* column already exists */ }
  }
  return db
}

interface LogEntry {
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  teamName?: string
  memberName?: string
  endpoint: string
  latencyMs: number
  statusCode: number
}

function insertLog(db: Database.Database, entry: LogEntry): void {
  const stmt = db.prepare(`
    INSERT INTO proxy_logs (timestamp, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, team_name, member_name, endpoint, latency_ms, status_code)
    VALUES (datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  stmt.run(
    entry.model,
    entry.inputTokens,
    entry.outputTokens,
    entry.cacheReadTokens,
    entry.cacheCreationTokens,
    entry.teamName ?? null,
    entry.memberName ?? null,
    entry.endpoint,
    entry.latencyMs,
    entry.statusCode
  )
}

// ─── Token Extraction ──────────────────────────────────────────────────────────

export interface AnthropicUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

export interface AnthropicResponseBody {
  model?: string
  usage?: AnthropicUsage
  error?: { type: string; message: string }
}

export function extractUsage(body: AnthropicResponseBody): {
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
} {
  const usage = body.usage ?? {}
  return {
    model: body.model ?? "unknown",
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
  }
}

// ─── SSE Streaming Extraction ────────────────────────────────────────────────

interface SSEUsageResult {
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

/**
 * Parse SSE event stream to extract model and token usage.
 * Anthropic SSE format:
 *   - message_start event contains model + input usage
 *   - message_delta event contains output usage
 */
export function extractUsageFromSSE(sseText: string): SSEUsageResult | null {
  let model = "unknown"
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheCreationTokens = 0
  let foundUsage = false

  const events = sseText.split("\n\n")
  for (const event of events) {
    const dataLine = event.split("\n").find((line) => line.startsWith("data: "))
    if (!dataLine) continue

    const jsonStr = dataLine.slice(6) // strip "data: "
    if (jsonStr === "[DONE]") continue

    try {
      const parsed = JSON.parse(jsonStr) as {
        type?: string
        message?: { model?: string; usage?: AnthropicUsage }
        usage?: AnthropicUsage
      }

      if (parsed.type === "message_start" && parsed.message) {
        model = parsed.message.model ?? model
        const usage = parsed.message.usage
        if (usage) {
          inputTokens = usage.input_tokens ?? 0
          cacheReadTokens = usage.cache_read_input_tokens ?? 0
          cacheCreationTokens = usage.cache_creation_input_tokens ?? 0
          foundUsage = true
        }
      }

      if (parsed.type === "message_delta" && parsed.usage) {
        outputTokens = parsed.usage.output_tokens ?? 0
        foundUsage = true
      }
    } catch {
      // Skip malformed JSON lines
    }
  }

  return foundUsage ? { model, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens } : null
}

/**
 * Check if the request body has stream:true set.
 */
export function isStreamingRequest(reqBody: Buffer): boolean {
  if (reqBody.length === 0) return false
  try {
    const parsed = JSON.parse(reqBody.toString("utf-8")) as { stream?: boolean }
    return parsed.stream === true
  } catch {
    return false
  }
}

// ─── Proxy Server ─────────────────────────────────────────────────────────────

export function createProxyServer(): http.Server {
  const db = openDb()

  const server = http.createServer((clientReq, clientRes) => {
    const startTime = Date.now()
    const endpoint = clientReq.url ?? "/"

    // Collect request body
    const reqChunks: Buffer[] = []
    clientReq.on("data", (chunk: Buffer) => reqChunks.push(chunk))
    clientReq.on("error", (err) => {
      console.error("[proxy] client request error:", err.message)
      if (!clientRes.headersSent) {
        clientRes.writeHead(400)
        clientRes.end("Bad Request")
      } else {
        clientRes.destroy()
      }
    })

    clientReq.on("end", () => {
      const reqBody = Buffer.concat(reqChunks)
      const streaming = isStreamingRequest(reqBody)

      // Extract team/member name from custom headers set by Claude Code
      const teamName =
        clientReq.headers["x-claude-team"] as string | undefined ??
        clientReq.headers["x-team-name"] as string | undefined
      const memberName =
        clientReq.headers["x-claude-member"] as string | undefined ??
        clientReq.headers["x-member-name"] as string | undefined

      // Build options for proxied request
      const options: https.RequestOptions = {
        hostname: TARGET_HOST,
        port: TARGET_PORT,
        path: endpoint,
        method: clientReq.method,
        headers: {
          ...clientReq.headers,
          host: TARGET_HOST,
        },
      }

      const proxyReq = https.request(options, (proxyRes) => {
        // Pass status and headers back to client
        clientRes.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers)

        const resChunks: Buffer[] = []
        proxyRes.on("data", (chunk: Buffer) => {
          resChunks.push(chunk)
          clientRes.write(chunk)
        })
        proxyRes.on("error", (err) => {
          console.error("[proxy] upstream response error:", err.message)
          if (!clientRes.headersSent) {
            clientRes.writeHead(502)
            clientRes.end("Bad Gateway")
          } else {
            clientRes.destroy()
          }
        })

        proxyRes.on("end", () => {
          clientRes.end()

          const latencyMs = Date.now() - startTime
          const statusCode = proxyRes.statusCode ?? 0
          const resBody = Buffer.concat(resChunks).toString("utf-8")

          const contentType = proxyRes.headers["content-type"] ?? ""
          const isSSE = streaming || contentType.includes("text/event-stream")

          if (isSSE) {
            // Parse SSE streaming response
            const usage = extractUsageFromSSE(resBody)
            if (usage) {
              insertLog(db, {
                ...usage,
                teamName,
                memberName,
                endpoint,
                latencyMs,
                statusCode,
              })
            } else {
              // Streaming but couldn't extract usage — log with what we know
              insertLog(db, {
                model: "unknown",
                inputTokens: 0,
                outputTokens: 0,
                cacheReadTokens: 0,
                cacheCreationTokens: 0,
                teamName,
                memberName,
                endpoint,
                latencyMs,
                statusCode,
              })
            }
          } else {
            // Non-streaming: parse as JSON
            try {
              const parsed = JSON.parse(resBody) as AnthropicResponseBody
              if (parsed.usage || parsed.model) {
                const usage = extractUsage(parsed)
                insertLog(db, {
                  ...usage,
                  teamName,
                  memberName,
                  endpoint,
                  latencyMs,
                  statusCode,
                })
              }
            } catch {
              // Non-JSON response — log basic info
              insertLog(db, {
                model: "unknown",
                inputTokens: 0,
                outputTokens: 0,
                cacheReadTokens: 0,
                cacheCreationTokens: 0,
                teamName,
                memberName,
                endpoint,
                latencyMs,
                statusCode,
              })
            }
          }
        })
      })

      proxyReq.on("error", (err) => {
        console.error("[proxy] upstream error:", err.message)
        if (!clientRes.headersSent) {
          clientRes.writeHead(502)
          clientRes.end("Bad Gateway")
        } else {
          clientRes.destroy()
        }
      })

      if (reqBody.length > 0) {
        proxyReq.write(reqBody)
      }
      proxyReq.end()
    })
  })

  return server
}

export function startProxy(): void {
  const server = createProxyServer()
  server.listen(PROXY_PORT, () => {
    console.log(`[proxy] Anthropic proxy running on http://localhost:${PROXY_PORT}`)
  })
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[proxy] Port ${PROXY_PORT} already in use — proxy not started`)
    } else {
      throw err
    }
  })
}

// Run directly if this is the entry point
if (require.main === module) {
  startProxy()
}

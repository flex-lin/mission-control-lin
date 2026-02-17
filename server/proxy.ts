import http from "http"
import https from "https"
import path from "path"
import Database from "better-sqlite3"

const PROXY_PORT = parseInt(process.env.PROXY_PORT ?? "8787", 10)
const TARGET_HOST = "api.anthropic.com"
const TARGET_PORT = 443
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
      endpoint TEXT NOT NULL DEFAULT '',
      latency_ms INTEGER NOT NULL DEFAULT 0,
      status_code INTEGER NOT NULL DEFAULT 0
    )
  `)
  return db
}

interface LogEntry {
  model: string
  inputTokens: number
  outputTokens: number
  teamName?: string
  endpoint: string
  latencyMs: number
  statusCode: number
}

function insertLog(db: Database.Database, entry: LogEntry): void {
  const stmt = db.prepare(`
    INSERT INTO proxy_logs (timestamp, model, input_tokens, output_tokens, team_name, endpoint, latency_ms, status_code)
    VALUES (datetime('now'), ?, ?, ?, ?, ?, ?, ?)
  `)
  stmt.run(
    entry.model,
    entry.inputTokens,
    entry.outputTokens,
    entry.teamName ?? null,
    entry.endpoint,
    entry.latencyMs,
    entry.statusCode
  )
}

// ─── Token Extraction ──────────────────────────────────────────────────────────

interface AnthropicUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

interface AnthropicResponseBody {
  model?: string
  usage?: AnthropicUsage
  error?: { type: string; message: string }
}

function extractUsage(body: AnthropicResponseBody): {
  model: string
  inputTokens: number
  outputTokens: number
} {
  const usage = body.usage ?? {}
  return {
    model: body.model ?? "unknown",
    inputTokens:
      (usage.input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0),
    outputTokens: usage.output_tokens ?? 0,
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

    clientReq.on("end", () => {
      const reqBody = Buffer.concat(reqChunks)

      // Extract team name from custom header set by Claude Code
      const teamName =
        clientReq.headers["x-claude-team"] as string | undefined ??
        clientReq.headers["x-team-name"] as string | undefined

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

        proxyRes.on("end", () => {
          clientRes.end()

          const latencyMs = Date.now() - startTime
          const statusCode = proxyRes.statusCode ?? 0

          // Try to parse response body for token usage
          try {
            const resBody = Buffer.concat(resChunks).toString("utf-8")
            const parsed = JSON.parse(resBody) as AnthropicResponseBody

            if (parsed.usage || parsed.model) {
              const usage = extractUsage(parsed)
              insertLog(db, {
                ...usage,
                teamName,
                endpoint,
                latencyMs,
                statusCode,
              })
            }
          } catch {
            // Non-JSON or streaming response — log with zeros
            insertLog(db, {
              model: "unknown",
              inputTokens: 0,
              outputTokens: 0,
              teamName,
              endpoint,
              latencyMs,
              statusCode,
            })
          }
        })
      })

      proxyReq.on("error", (err) => {
        console.error("[proxy] upstream error:", err.message)
        clientRes.writeHead(502)
        clientRes.end("Bad Gateway")
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

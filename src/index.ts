#!/usr/bin/env node
/**
 * Formatho Runtime — MCP server + REST gateway (Phase 2)
 *
 *   formatho-runtime              stdio MCP server (local, no keys needed)
 *   formatho-runtime --http       HTTP server: REST /api/tools/* + MCP /mcp
 *                                  (requires FORMATHO_API_KEYS or FORMATHO_KEYS_FILE)
 *
 * Env:
 *   FORMATHO_AUDIT_LOG      audit JSONL path (default ./formatho-audit.jsonl)
 *   FORMATHO_API_KEYS       "key:agent-name,key2:agent-two"
 *   FORMATHO_KEYS_FILE      JSON { "key": "agent" }
 *   FORMATHO_POLICY_FILE    JSON { "agents": { "agent": { "allowedTools": ["evm.*"] } } }
 *   FORMATHO_PORT           HTTP port (default 8787)
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { AuditLog } from './audit.js'
import { PolicyEngine } from './policy.js'
import { buildServer } from './core.js'
import { startHttpServer } from './http.js'
import { registry } from './registry.js'

// tool modules self-register on import
import './tools/data.js'
import './tools/security.js'
import './tools/evm.js'
import './tools/defi.js'
import './tools/extra.js'

const version = '0.2.6'
const httpMode = process.argv.includes('--http')
const audit = new AuditLog(process.env.FORMATHO_AUDIT_LOG || 'formatho-audit.jsonl')

async function main() {
  if (httpMode) {
    const policy = new PolicyEngine()
    const server = await startHttpServer({ port: Number(process.env.FORMATHO_PORT || 8787), host: process.env.FORMATHO_HOST, audit, policy })
    const addr = server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    process.stderr.write(
      `formatho-runtime v${version} (http): ${registry.length} tools at http://127.0.0.1:${port}\n` +
        `  GET  /api/tools        (bearer key)\n` +
        `  POST /api/tools/<name> (bearer key)\n` +
        `  POST /mcp              (streamable MCP)\n`
    )
    return
  }

  // stdio mode: local, single-user — no keys required
  const server = buildServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write(
    `formatho-runtime v${version}: ${registry.length} tools registered (stdio; run with --http for the REST/MCP gateway)\n`
  )
}

main().catch((e) => {
  process.stderr.write(`fatal: ${e}\n`)
  process.exit(1)
})

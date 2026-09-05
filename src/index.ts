#!/usr/bin/env node
/**
 * Formatho Runtime — MCP server (Phase 1)
 *
 * Exposes the Formatho tool registry over the Model Context Protocol
 * (stdio transport). Every tool is a pure function with declared,
 * zero-ambient permissions; every invocation is audit-logged as metadata
 * (never payloads).
 *
 * Usage:
 *   formatho-runtime                       # stdio MCP server
 *   FORMATHO_AUDIT_LOG=/path/a.jsonl       # audit log location (default ./formatho-audit.jsonl)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { registry, verifiedBadge, type AuditRecord } from './registry.js'
import { AuditLog } from './audit.js'
const version = '0.1.1'

// tool modules self-register on import
import './tools/data.js'
import './tools/security.js'
import './tools/evm.js'
import './tools/defi.js'

const audit = new AuditLog(process.env.FORMATHO_AUDIT_LOG || 'formatho-audit.jsonl')

const server = new McpServer(
  { name: 'formatho-runtime', version },
  {
    instructions:
      'Formatho Runtime — deterministic, permission-free developer, security and EVM tools. ' +
      'All tools are pure functions: no network, no filesystem, no secrets. ' +
      `Registry: ${registry.length} tools (v${version}, Phase 1).`
  }
)

type DynamicRegister = (name: string, cfg: object, handler: (args: unknown) => Promise<unknown>) => void
const registerDynamic = ((server as unknown as { registerTool: DynamicRegister }).registerTool).bind(server)

for (const tool of registry) {
  const inputShape = (tool.input as import('zod').ZodObject<Record<string, never>>).shape ?? {}
  registerDynamic(
    tool.name,
    {
      title: tool.name,
      description: `${tool.description} [${tool.category} · v${tool.version} · deterministic: ${tool.deterministic} · permissions: none]`,
      inputSchema: inputShape as object
    },
    async (rawInput: unknown) => {
      const started = performance.now()
      const record: AuditRecord = {
        timestamp: new Date().toISOString(),
        tool: tool.name,
        toolVersion: tool.version,
        durationMs: 0,
        ok: false,
        policy: 'allow',
        inputBytes: JSON.stringify(rawInput ?? {}).length
      }
      try {
        const input = tool.input.parse(rawInput as object)
        const result = await tool.execute(input, { audit: record })
        record.ok = true
        record.outputBytes = JSON.stringify(result ?? null).length
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result as object
        }
      } catch (e: any) {
        record.error = String(e?.message || e).slice(0, 200)
        throw e
      } finally {
        record.durationMs = Math.round(performance.now() - started)
        await audit.record(record)
      }
    }
  )
}

// meta tool: the registry itself (spec §5 — agents can discover metadata)
server.registerTool(
  'formatho.registry',
  {
    title: 'formatho.registry',
    description: 'List every registered Formatho tool with version, category, deterministic flag, and Formatho Verified status.',
    inputSchema: {}
  },
  async () => ({
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          registry.map((t) => ({
            name: t.name,
            version: t.version,
            category: t.category,
            deterministic: t.deterministic,
            permissions: t.permissions,
            verified: verifiedBadge(t)
          })),
          null,
          2
        )
      }
    ]
  })
)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write(
    `formatho-runtime v${version}: ${registry.length} tools registered (${registry.map((t) => t.name).join(', ')}, formatho.registry)\n`
  )
}

main().catch((e) => {
  process.stderr.write(`fatal: ${e}\n`)
  process.exit(1)
})

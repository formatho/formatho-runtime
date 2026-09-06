import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registry, register, verifiedBadge, type ToolDefinition, type AuditRecord } from './registry.js'
import { AuditLog } from './audit.js'
import { PolicyEngine } from './policy.js'

/**
 * Shared execution core: one registry, one audit path, every transport
 * (stdio MCP, MCP-over-HTTP, REST) calls through executeTool/buildServer
 * so behavior, policy, and audit are identical everywhere (spec §4:
 * one execution layer, many faces).
 */

export interface SharedDeps {
  audit: AuditLog
  policy?: PolicyEngine
}

export function buildServer(): McpServer {
  const version = '0.3.0'
  const server = new McpServer(
    { name: 'formatho-runtime', version },
    {
      instructions:
        'Formatho Runtime — deterministic, permission-free developer, security and EVM tools. ' +
        'All tools are pure functions: no network, no filesystem, no secrets. ' +
        `Registry: ${registry.length} tools (v${version}).`
    }
  )

  type DynamicRegister = (name: string, cfg: object, handler: (args: unknown) => Promise<unknown>) => void
  const registerDynamic = (server as unknown as { registerTool: DynamicRegister }).registerTool.bind(server)

  for (const tool of registry) {
    const inputShape = (tool.input as import('zod').ZodObject<Record<string, never>>).shape ?? {}
    registerDynamic(
      tool.name,
      {
        title: tool.name,
        description: `${tool.description} [${tool.category} · v${tool.version} · deterministic: ${tool.deterministic} · permissions: none]`,
        inputSchema: inputShape as object
      },
      async (rawInput: unknown) => executeAndWrap(tool, rawInput, undefined, undefined)
    )
  }

  return server
}

const nullAudit = new AuditLog('/dev/null')

async function executeAndWrap(tool: ToolDefinition, rawInput: unknown, agent: string | undefined, deps?: SharedDeps) {
  const result = await executeTool(tool, rawInput, agent, deps ?? { audit: nullAudit })
  if ('error' in result && result.error) throw new Error(String(result.error))
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    structuredContent: result as object
  }
}

export async function executeTool(
  tool: ToolDefinition,
  rawInput: unknown,
  agent: string | undefined,
  deps: SharedDeps
): Promise<Record<string, unknown>> {
  const started = performance.now()
  const record: AuditRecord = {
    timestamp: new Date().toISOString(),
    tool: tool.name,
    toolVersion: tool.version,
    durationMs: 0,
    ok: false,
    policy: 'allow',
    agent,
    inputBytes: JSON.stringify(rawInput ?? {}).length
  }
  try {
    const input = tool.input.parse(rawInput as object)
    const result = await tool.execute(input, { audit: record })
    record.ok = true
    record.outputBytes = JSON.stringify(result ?? null).length
    return result as Record<string, unknown>
  } catch (e: any) {
    record.error = String(e?.message || e).slice(0, 200)
    return { error: record.error }
  } finally {
    record.durationMs = Math.round(performance.now() - started)
    await deps.audit.record(record)
  }
}

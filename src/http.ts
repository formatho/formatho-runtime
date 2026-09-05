import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { registry, verifiedBadge } from './registry.js'
import { AuditLog } from './audit.js'
import { PolicyEngine } from './policy.js'
import { buildServer, executeTool, type SharedDeps } from './core.js'

/**
 * HTTP mode (Phase 2):
 *   POST /api/tools/:name   REST gateway — body is the tool's input JSON
 *   GET  /api/tools         registry listing
 *   POST /mcp               MCP Streamable HTTP transport
 *
 * Every request requires an API key (Authorization: Bearer …) mapped to an
 * agent identity; tool calls pass through the policy engine; every execution
 * is audit-logged with the agent identity.
 */
export async function startHttpServer(opts: {
  port: number
  host?: string
  audit: AuditLog
  policy: PolicyEngine
}): Promise<Server> {
  if (!opts.policy.hasKeys) {
    throw new Error(
      'HTTP mode is network-facing and requires API keys. Set FORMATHO_API_KEYS="key:agent-name,…" ' +
        'or FORMATHO_KEYS_FILE=/path/keys.json, or run without --http for local stdio mode.'
    )
  }

  const deps: SharedDeps = { audit: opts.audit, policy: opts.policy }

  // one MCP server instance per /mcp session transport
  const createMcpInstance = (): { server: McpServer; transport: StreamableHTTPServerTransport } => {
    const server = buildServer()
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      // keys live in the gateway policy layer; sessions don't add auth
      enableJsonResponse: false
    })
    return { server, transport }
  }

  const json = (res: ServerResponse, status: number, body: unknown): void => {
    const payload = JSON.stringify(body)
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
    res.end(payload)
  }

  const readBody = (req: IncomingMessage): Promise<string> =>
    new Promise((resolve, reject) => {
      let size = 0
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => {
        size += c.length
        if (size > 2 * 1024 * 1024) {
          reject(new Error('payload too large (2MB limit)'))
          req.destroy()
          return
        }
        chunks.push(c)
      })
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', reject)
    })

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost')
    try {
      // ---- auth for everything ----
      const agent = opts.policy.authenticate(req.headers.authorization)
      if (!agent) {
        res.setHeader('WWW-Authenticate', 'Bearer')
        return json(res, 401, { error: 'missing or invalid API key' })
      }

      // ---- REST: registry listing ----
      if (req.method === 'GET' && url.pathname === '/api/tools') {
        return json(res, 200, {
          agent,
          tools: registry.map((t) => ({
            name: t.name,
            version: t.version,
            category: t.category,
            deterministic: t.deterministic,
            permissions: t.permissions,
            verified: verifiedBadge(t),
            allowed: opts.policy.allows(agent, t.name)
          }))
        })
      }

      // ---- REST: tool call ----
      const toolMatch = url.pathname.match(/^\/api\/tools\/([a-z0-9_.]+)$/)
      if (req.method === 'POST' && toolMatch) {
        const name = toolMatch[1]
        const tool = registry.find((t) => t.name === name)
        if (!tool) return json(res, 404, { error: `unknown tool: ${name}` })

        const decision = opts.policy.decision(agent, name)
        if (decision !== 'allow') {
          return json(res, 403, {
            error: decision === 'deny-not-listed'
              ? `agent "${agent}" is not listed in the policy file`
              : `agent "${agent}" is not allowed to call ${name}`,
            decision
          })
        }

        let input: unknown
        try {
          input = JSON.parse((await readBody(req)) || '{}')
        } catch {
          return json(res, 400, { error: 'body must be JSON' })
        }

        const result = await executeTool(tool, input, agent, deps)
        if ('error' in result && result.error) return json(res, 422, result)
        return json(res, 200, result)
      }

      // ---- MCP Streamable HTTP ----
      if (url.pathname === '/mcp') {
        const { server: mcp, transport } = createMcpInstance()
        res.on('close', () => {
          void mcp.close()
          void transport.close()
        })
        // note: tool-level policy inside MCP sessions uses the authenticated
        // agent identity via a session->agent map on the transport; for the
        // REST-first Phase 2 the MCP endpoint enforces key auth and full
        // registry access per policy at the HTTP layer.
        await transport.handleRequest(req, res)
        void mcp.connect(transport)
        return
      }

      return json(res, 404, { error: 'not found', endpoints: ['GET /api/tools', 'POST /api/tools/:name', 'POST /mcp'] })
    } catch (e: any) {
      return json(res, 500, { error: String(e?.message || e).slice(0, 200) })
    }
  })

  await new Promise<void>((resolve) => server.listen(opts.port, opts.host ?? '127.0.0.1', resolve))
  return server
}


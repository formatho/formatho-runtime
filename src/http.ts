import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { registry, verifiedBadge } from './registry.js'
import { AuditLog } from './audit.js'
import { PolicyEngine } from './policy.js'
import { TokenBucket } from './ratelimit.js'
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
  if (!opts.policy.hasKeys && process.env.FORMATHO_ALLOW_ANONYMOUS !== 'true') {
    throw new Error(
      'HTTP mode is network-facing and requires API keys. Set FORMATHO_API_KEYS="key:agent-name,…" ' +
        'or FORMATHO_KEYS_FILE=/path/keys.json — or set FORMATHO_ALLOW_ANONYMOUS=true for a ' +
        'rate-limited public instance (self-hosted private deployments should always use keys).'
    )
  }
  const allowAnonymous = process.env.FORMATHO_ALLOW_ANONYMOUS === 'true'
  const anonBucket = new TokenBucket(
    Number(process.env.FORMATHO_ANON_BURST || 30),
    Number(process.env.FORMATHO_ANON_RPM || 30)
  )
  const keyBucket = new TokenBucket(
    Number(process.env.FORMATHO_KEY_BURST || 300),
    Number(process.env.FORMATHO_KEY_RPM || 300)
  )
  const clientKey = (req: IncomingMessage): string =>
    (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown'

  const deps: SharedDeps = { audit: opts.audit, policy: opts.policy }

  // one MCP server instance per /mcp session transport
  const createMcpInstance = (): { server: McpServer; transport: StreamableHTTPServerTransport } => {
    const server = buildServer()
    // stateless: one server+transport per request; our tools carry no state
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
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

    // CORS for browser-based MCP clients (Claude.ai web, custom hosts)
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID')
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    try {
      // ---- /auth.md: agent registration discovery (always public) ----
      if (req.method === 'GET' && url.pathname === '/auth.md') {
        const md = `# auth.md

Formatho Runtime — Agent Authentication

## Server
- MCP: \`${origin}/mcp\` (Streamable HTTP)
- REST: \`${origin}/api/tools\`

## Methods

### API Key (Bearer)
Authorization: Bearer <key>

Keys map to named agent identities with per-tool policy scope.
Provision via FORMATHO_API_KEYS env var (self-hosted) or contact
support@formatho.com (hosted tier).

### Anonymous (rate-limited)
No credential required. ${process.env.FORMATHO_ALLOW_ANONYMOUS === 'true' ? 'Available on this instance.' : 'Not enabled on this instance.'}

## Details
https://formatho.com/auth.md
`
        const payload = md
        res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' })
        res.end(payload)
        return
      }

      // ---- /.well-known/mcp-server.json: public self-description (RFC-style
      // discovery). Metadata only — no tool access without a key. ----
      if (req.method === 'GET' && url.pathname === '/.well-known/mcp-server.json') {
        return json(res, 200, {
          name: 'io.github.formatho.runtime',
          version: '0.2.6',
          description: 'Self-hosted MCP tool infrastructure for AI agents — deterministic developer, security, and EVM tools with per-agent permissions and metadata-only audit.',
          repository: 'https://github.com/formatho/formatho-runtime',
          transport: { type: 'http', endpoint: '/mcp', auth: 'bearer' },
          toolsEndpoint: '/api/tools',
          registryMetaTool: 'formatho.registry'
        })
      }

      // ---- auth: bearer key -> agent identity; or anonymous tier ----
      const agent = opts.policy.authenticate(req.headers.authorization)
      const identity = agent ?? (allowAnonymous ? 'anonymous' : null)
      if (!identity) {
        res.setHeader('WWW-Authenticate', 'Bearer')
        return json(res, 401, { error: 'missing or invalid API key' })
      }

      // ---- rate limiting: anonymous tier is tight, keyed agents generous ----
      const isToolCall = !!url.pathname.match(/^\/api\/tools\//) || url.pathname === '/mcp'
      if (isToolCall) {
        const ok = agent ? keyBucket.take(agent) : anonBucket.take(clientKey(req))
        if (!ok) {
          res.setHeader('Retry-After', '10')
          return json(res, 429, { error: 'rate limit exceeded — self-host for unlimited access' })
        }
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
            allowed: opts.policy.allows(identity, t.name)
          }))
        })
      }

      // ---- REST: tool call ----
      const toolMatch = url.pathname.match(/^\/api\/tools\/([a-z0-9_.]+)$/)
      if (req.method === 'POST' && toolMatch) {
        const name = toolMatch[1]
        const tool = registry.find((t) => t.name === name)
        if (!tool) return json(res, 404, { error: `unknown tool: ${name}` })

        const decision = opts.policy.decision(identity, name)
        if (decision !== 'allow') {
          return json(res, 403, {
            error: decision === 'deny-not-listed'
              ? `agent "${identity}" is not listed in the policy file`
              : `agent "${identity}" is not allowed to call ${name}`,
            decision
          })
        }

        let input: unknown
        try {
          input = JSON.parse((await readBody(req)) || '{}')
        } catch {
          return json(res, 400, { error: 'body must be JSON' })
        }

        const result = await executeTool(tool, input, identity, deps)
        if ('error' in result && result.error) return json(res, 422, result)
        return json(res, 200, result)
      }

      // ---- MCP Streamable HTTP (stateless pattern) ----
      if (url.pathname === '/mcp') {
        const { server: mcp, transport } = createMcpInstance()
        // SDK pattern: connect the server BEFORE handling the request, or
        // initialize responses never attach to the stream (keepalives only)
        await mcp.connect(transport)
        res.on('close', () => {
          void mcp.close()
          void transport.close()
        })
        await transport.handleRequest(req, res)
        return
      }

      return json(res, 404, { error: 'not found', endpoints: ['GET /api/tools', 'POST /api/tools/:name', 'POST /mcp'] })
    } catch (e: any) {
      return json(res, 500, { error: String(e?.message || e).slice(0, 200) })
    }
  })

  // bare-metal default: loopback. Containers set FORMATHO_HOST=0.0.0.0 so the
  // host's port mapping can reach the server (host-side binding controls exposure).
  const host = opts.host ?? process.env.FORMATHO_HOST ?? '127.0.0.1'
  await new Promise<void>((resolve) => server.listen(opts.port, host, resolve))
  return server
}


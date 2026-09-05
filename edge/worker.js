/**
 * mcp.formatho.com — Cloudflare edge proxy for the Formatho Runtime hosted tier.
 *
 * Route: mcp.formatho.com/* → http://runtime-origin.formatho.com:8787 (the
 * Droplet container, DNS-only). The Worker provides TLS, analytics, and
 * header hygiene; the runtime's own auth/rate-limits/audit stay authoritative.
 *
 * Analytics: every request writes a row to Workers Analytics Engine
 * (binding "mcp_analytics") with tool, agent tier, status, and latency —
 * queryable via the CF SQL API without any client-side tracking (agents
 * don't run JS beacons; server-side is the only analytics surface MCP has).
 */

const ORIGIN = 'http://runtime-origin.formatho.com:8787'


export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const started = Date.now()

    // Smithery/Glama/registry scanners must reach the well-known files and
    // the MCP handshake — never let WAF-ish defaults interfere.
    let upstream = await fetch(ORIGIN + url.pathname + url.search, {
      method: request.method,
      headers: request.headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'manual'
    })

    // analytics: tool name from /api/tools/<name>, agent tier from auth presence
    const tool = url.pathname.match(/^\/api\/tools\/([a-z0-9_.]+)/)?.[1] ?? (url.pathname === '/mcp' ? 'mcp-session' : url.pathname)
    const agent = request.headers.get('authorization') ? 'keyed' : 'anonymous'
    env.mcp_analytics?.writeDataPoint({
      blobs: [tool, agent, request.method, new Date().toISOString()],
      doubles: [upstream.status, Date.now() - started],
      indexes: [url.hostname] // one index keeps cardinality low: per-day retention is CF-side
    })

    // stream responses (SSE for MCP) straight through
    return new Response(upstream.body, {
      status: upstream.status,
      headers: upstream.headers
    })
  }
}

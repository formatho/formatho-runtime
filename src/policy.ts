import { readFileSync } from 'node:fs'

/**
 * API keys + per-agent policy engine (spec §7/§9).
 *
 * Keys: FORMATHO_API_KEYS="key1:agent-one,key2:agent-two" or a JSON file at
 * FORMATHO_KEYS_FILE: { "key1": "agent-one", "key2": "blockchain-agent" }.
 *
 * Policies: optional JSON at FORMATHO_POLICY_FILE:
 * {
 *   "agents": {
 *     "blockchain-agent": { "allowedTools": ["evm.*", "erc4626.*"] },
 *     "intern-agent":     { "allowedTools": ["json.*", "base64.*"] }
 *   }
 * }
 *
 * Rules:
 * - No keys configured  -> the HTTP server refuses to start (it is network-
 *   facing; anonymous access is never ok). stdio mode ignores keys.
 * - Key valid, no policy file            -> agent may call every tool.
 * - Policy file exists, agent not listed -> deny every tool (least privilege).
 * - allowedTools supports "prefix.*" wildcards.
 */

export interface AgentPolicy {
  allowedTools: string[]
}

export class PolicyEngine {
  private keys = new Map<string, string>() // apiKey -> agent name
  private policies: Map<string, AgentPolicy> | null = null

  constructor() {
    const inline = process.env.FORMATHO_API_KEYS
    const keysFile = process.env.FORMATHO_KEYS_FILE
    const policyFile = process.env.FORMATHO_POLICY_FILE

    if (inline) {
      for (const pair of inline.split(',')) {
        const [key, agent] = pair.split(':').map((s) => s.trim())
        if (key && agent) this.keys.set(key, agent)
      }
    }
    if (keysFile) {
      const parsed = JSON.parse(readFileSync(keysFile, 'utf8'))
      for (const [key, agent] of Object.entries(parsed)) this.keys.set(key, String(agent))
    }
    if (policyFile) {
      const parsed = JSON.parse(readFileSync(policyFile, 'utf8'))
      this.policies = new Map(Object.entries(parsed.agents || {}).map(([agent, p]) => [
        agent,
        { allowedTools: (p as AgentPolicy).allowedTools || [] }
      ]))
    }
  }

  get hasKeys(): boolean {
    return this.keys.size > 0
  }

  /** Resolve a bearer token to an agent identity, or null. */
  authenticate(authorizationHeader: string | undefined): string | null {
    if (!authorizationHeader?.startsWith('Bearer ')) return null
    const key = authorizationHeader.slice(7).trim()
    return this.keys.get(key) ?? null
  }

  /** Does `agent` have permission to invoke `tool`? */
  allows(agent: string, tool: string): boolean {
    if (!this.policies) return true
    const policy = this.policies.get(agent)
    if (!policy) return false
    return policy.allowedTools.some((pattern) =>
      pattern.endsWith('.*') ? tool.startsWith(pattern.slice(0, -1)) : pattern === tool
    )
  }

  decision(agent: string, tool: string): 'allow' | 'deny-not-listed' | 'deny-tool' {
    if (!this.policies) return 'allow'
    const policy = this.policies.get(agent)
    if (!policy) return 'deny-not-listed'
    return this.allows(agent, tool) ? 'allow' : 'deny-tool'
  }
}

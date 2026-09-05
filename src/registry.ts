import { z } from 'zod'

/**
 * Formatho tool registry model (spec §5).
 * Every tool declares exactly what it needs — the runtime enforces least
 * privilege by construction: tools are pure functions over their inputs and
 * are granted no ambient capabilities.
 */
export const ToolPermissions = z.object({
  network: z.boolean().default(false),
  filesystem: z.boolean().default(false),
  secrets: z.boolean().default(false),
  subprocess: z.boolean().default(false)
})
export type ToolPermissions = z.infer<typeof ToolPermissions>

export interface ToolDefinition<I extends z.ZodTypeAny = z.ZodTypeAny> {
  /** Registry name, e.g. "json.format" */
  name: string
  version: string
  description: string
  category: string
  input: I
  permissions: ToolPermissions
  /** Deterministic tools produce identical output for identical input. */
  deterministic: boolean
  /** Formatho Verified checklist (spec §6) — only claims what is true. */
  verified: {
    sourceReviewed: boolean
    dependenciesReviewed: boolean
    networkBehaviorReviewed: boolean
    sandboxCompatible: boolean
    schemaDefined: boolean
    versionPinned: boolean
  }
  execute: (input: z.infer<I>, ctx: ToolContext) => Promise<unknown> | unknown
}

export interface ToolContext {
  /** Audit record for this invocation (metadata only — never payloads). */
  audit: AuditRecord
}

export interface AuditRecord {
  timestamp: string
  tool: string
  toolVersion: string
  durationMs: number
  ok: boolean
  error?: string
  policy: 'allow'
  /** caller identity when the gateway fronting this runtime provides one */
  agent?: string
  inputBytes?: number
  outputBytes?: number
}

export const registry: ToolDefinition[] = []

export function register<I extends z.ZodTypeAny>(def: ToolDefinition<I>): void {
  const existing = registry.find((t) => t.name === def.name)
  if (existing) throw new Error(`tool already registered: ${def.name}`)
  if (def.permissions.network || def.permissions.filesystem || def.permissions.secrets || def.permissions.subprocess) {
    // Phase 1: the runtime physically has no capability grant mechanism —
    // any tool claiming ambient access would be lying in its metadata.
    throw new Error(
      `tool ${def.name} declares ambient permissions, but this runtime build grants none. ` +
        `Remove the claim or extend the runtime first.`
    )
  }
  registry.push(def as unknown as ToolDefinition)
}

/** Standard "Formatho Verified" badge payload for a tool. */
export function verifiedBadge(def: ToolDefinition): Record<string, boolean> {
  return {
    formathoVerified: Object.values(def.verified).every(Boolean),
    ...def.verified
  }
}

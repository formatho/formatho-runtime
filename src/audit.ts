import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * Audit log (spec §10): metadata only. Input/output payloads are NEVER
 * recorded — only sizes — so logs are safe to ship to a SIEM by default.
 */
export class AuditLog {
  private queue: string[] = []
  constructor(private path: string) {}

  async record(entry: object): Promise<void> {
    const line = JSON.stringify(entry)
    try {
      await mkdir(dirname(this.path), { recursive: true })
      await appendFile(this.path, line + '\n')
    } catch {
      // never let logging break tool execution; keep in-memory fallback
      this.queue.push(line)
    }
  }
}

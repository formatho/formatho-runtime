/**
 * Per-client token bucket (Phase 2.5): public instances get FORMATHO_ALLOW_
 * ANONYMOUS=true plus strict per-IP limits; keyed deployments can stay tighter.
 * Buckets live in memory — one per process — which is the right scope for a
 * single-container deployment; multi-replica setups should front this with a
 * gateway that already rate-limits (Cloudflare, Kong, Obot).
 */
export class TokenBucket {
  private buckets = new Map<string, { tokens: number; last: number }>()

  constructor(
    private capacity: number,
    private refillPerMinute: number
  ) {}

  take(key: string, cost = 1): boolean {
    const now = Date.now()
    const b = this.buckets.get(key) ?? { tokens: this.capacity, last: now }
    const elapsedMin = (now - b.last) / 60000
    b.tokens = Math.min(this.capacity, b.tokens + elapsedMin * this.refillPerMinute)
    b.last = now
    if (b.tokens < cost) {
      this.buckets.set(key, b)
      return false
    }
    b.tokens -= cost
    this.buckets.set(key, b)
    // opportunistic cleanup keeps the map bounded
    if (this.buckets.size > 10_000) {
      for (const [k, v] of this.buckets) {
        if (now - v.last > 3_600_000) this.buckets.delete(k)
      }
    }
    return true
  }
}

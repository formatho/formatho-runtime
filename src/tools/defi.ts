import { z } from 'zod'
import { register } from '../registry.js'

const V = {
  sourceReviewed: true,
  dependenciesReviewed: true,
  networkBehaviorReviewed: true,
  sandboxCompatible: true,
  schemaDefined: true,
  versionPinned: true
}
const NO_CAPABILITIES = { network: false, filesystem: false, secrets: false, subprocess: false }

const mulDivDown = (a: bigint, b: bigint, c: bigint) => (a * b) / c

register({
  name: 'erc4626.math',
  version: '1.0.0',
  description: 'Exact EIP-4626 vault math in BigInt: convert assets to shares (round down) and shares to assets (round down), with optional virtual offsets.',
  category: 'defi',
  input: z.object({
    totalAssets: z.string().regex(/^\d+$/),
    totalSupply: z.string().regex(/^\d+$/),
    amount: z.string().regex(/^\d+$/),
    direction: z.enum(['assetsToShares', 'sharesToAssets']).default('assetsToShares'),
    virtualAssets: z.string().regex(/^\d+$/).default('0'),
    virtualShares: z.string().regex(/^\d+$/).default('0')
  }),
  permissions: NO_CAPABILITIES,
  deterministic: true,
  verified: V,
  execute: ({ totalAssets, totalSupply, amount, direction, virtualAssets, virtualShares }) => {
    const ta = BigInt(totalAssets)
    const ts = BigInt(totalSupply)
    const va = BigInt(virtualAssets)
    const vs = BigInt(virtualShares)
    if (ta + va === 0n || ts + vs === 0n) throw new Error('vault totals are zero')
    if (direction === 'assetsToShares') {
      const shares = mulDivDown(BigInt(amount), ts + vs, ta + va)
      const back = mulDivDown(shares, ta + va, ts + vs)
      return { shares: shares.toString(), roundTripAssets: back.toString(), dust: (BigInt(amount) - back).toString() }
    }
    const assets = mulDivDown(BigInt(amount), ta + va, ts + vs)
    return { assets: assets.toString() }
  }
})

register({
  name: 'timestamp.convert',
  version: '1.0.0',
  description: 'Convert Unix seconds/milliseconds to ISO 8601 (UTC) and back.',
  category: 'dev',
  input: z.object({ value: z.union([z.string(), z.number()]).optional(), iso: z.string().optional() }),
  permissions: NO_CAPABILITIES,
  deterministic: true,
  verified: V,
  execute: ({ value, iso }) => {
    if (iso) {
      const d = new Date(iso)
      if (isNaN(d.getTime())) throw new Error('invalid ISO date')
      return { unixSeconds: Math.floor(d.getTime() / 1000), unixMs: d.getTime(), iso: d.toISOString() }
    }
    if (value !== undefined) {
      const n = typeof value === 'string' ? (value.trim() === '' ? Date.now() : Number(value)) : value
      const ms = n > 1e12 ? n : n * 1000
      const d = new Date(ms)
      if (isNaN(d.getTime())) throw new Error('invalid timestamp')
      return { unixSeconds: Math.floor(ms / 1000), unixMs: ms, iso: d.toISOString() }
    }
    const now = Date.now()
    return { unixSeconds: Math.floor(now / 1000), unixMs: now, iso: new Date(now).toISOString() }
  }
})

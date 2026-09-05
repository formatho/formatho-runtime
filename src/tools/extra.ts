import { z } from 'zod'
import { keccak_256 } from '@noble/hashes/sha3'
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

register({
  name: 'regex.test',
  version: '1.0.0',
  description: 'Test a regular expression against text: match result plus all capture groups.',
  category: 'dev',
  input: z.object({ pattern: z.string().min(1), text: z.string(), flags: z.string().max(8).default('') }),
  permissions: NO_CAPABILITIES,
  deterministic: true,
  verified: V,
  execute: ({ pattern, text, flags }) => {
    const re = new RegExp(pattern, flags)
    const m = text.match(re)
    return {
      matches: !!m,
      match: m?.[0] ?? null,
      groups: m?.slice(1).map((g) => g ?? null) ?? [],
      namedGroups: m?.groups ?? null
    }
  }
})

register({
  name: 'case.convert',
  version: '1.0.0',
  description: 'Convert an identifier between camelCase, snake_case, kebab-case, CONSTANT_CASE, and Title Case.',
  category: 'dev',
  input: z.object({ text: z.string().min(1), to: z.enum(['camel', 'snake', 'kebab', 'constant', 'title']).default('snake') }),
  permissions: NO_CAPABILITIES,
  deterministic: true,
  verified: V,
  execute: ({ text, to }) => {
    const words = text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^a-zA-Z0-9]+/).filter(Boolean)
    const lower = words.map((w) => w.toLowerCase())
    const cap = lower.map((w) => w[0].toUpperCase() + w.slice(1))
    const out =
      to === 'camel' ? lower[0] + cap.slice(1).join('')
      : to === 'snake' ? lower.join('_')
      : to === 'kebab' ? lower.join('-')
      : to === 'constant' ? lower.join('_').toUpperCase()
      : cap.join(' ')
    return { converted: out }
  }
})

register({
  name: 'hex.encode',
  version: '1.0.0',
  description: 'Encode text to hex, or decode hex (with or without 0x) to text.',
  category: 'data',
  input: z.object({ text: z.string().optional(), hex: z.string().optional() }),
  permissions: NO_CAPABILITIES,
  deterministic: true,
  verified: V,
  execute: ({ text, hex }) => {
    if (text !== undefined) return { hex: '0x' + Buffer.from(text, 'utf8').toString('hex') }
    if (hex !== undefined) {
      const clean = hex.replace(/^0x/, '').replace(/\s/g, '')
      if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2 !== 0) throw new Error('invalid hex string')
      return { text: Buffer.from(clean, 'hex').toString('utf8') }
    }
    throw new Error('provide text or hex')
  }
})

register({
  name: 'evm.checksum_address',
  version: '1.0.0',
  description: 'EIP-55 checksum an Ethereum address, or verify a checksummed one.',
  category: 'web3',
  input: z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) }),
  permissions: NO_CAPABILITIES,
  deterministic: true,
  verified: V,
  execute: ({ address }) => {
    const lower = address.toLowerCase().slice(2)
    const hash = Buffer.from(keccak_256(Buffer.from(lower, 'utf8'))).toString('hex')
    let checksummed = '0x'
    for (let i = 0; i < lower.length; i++) {
      checksummed += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i]
    }
    return { checksummed, valid: checksummed === address }
  }
})

register({
  name: 'evm.unit_convert',
  version: '1.0.0',
  description: 'Convert EVM amounts between wei, gwei, and ether with exact BigInt math.',
  category: 'web3',
  input: z.object({
    value: z.string().regex(/^\d+(\.\d+)?$/),
    from: z.enum(['wei', 'gwei', 'ether']).default('ether'),
    to: z.enum(['wei', 'gwei', 'ether']).default('wei')
  }),
  permissions: NO_CAPABILITIES,
  deterministic: true,
  verified: V,
  execute: ({ value, from, to }) => {
    const scale = { wei: 0n, gwei: 9n, ether: 18n }
    const [int, frac = ''] = value.split('.')
    // to wei exactly
    const exp = scale[from]
    const fracPadded = (frac + '0'.repeat(18)).slice(0, Number(exp))
    const wei = BigInt(int) * 10n ** exp + (fracPadded ? BigInt(fracPadded) : 0n)
    const outExp = scale[to]
    if (wei % 10n ** outExp === 0n) return { value: (wei / 10n ** outExp).toString(), unit: to }
    // fractional result — express with full precision as decimal string
    const whole = wei / 10n ** outExp
    const rem = (wei % 10n ** outExp).toString().padStart(Number(outExp), '0')
    return { value: `${whole}.${rem}`, unit: to }
  }
})

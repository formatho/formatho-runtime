import { z } from 'zod'
import { randomUUID, randomBytes, createHash } from 'node:crypto'
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

const ALGOS = z.enum(['md5', 'sha1', 'sha256', 'sha384', 'sha512'])

register({
  name: 'hash.text',
  version: '1.0.0',
  description: 'Hash text with md5/sha1/sha256/sha384/sha512 (hex output). MD5/SHA1 are for compatibility checks only, not security.',
  category: 'security',
  input: z.object({ text: z.string(), algorithm: ALGOS.default('sha256') }),
  permissions: NO_CAPABILITIES,
  deterministic: true,
  verified: V,
  execute: ({ text, algorithm }) => ({
    algorithm,
    digest: createHash(algorithm).update(text, 'utf8').digest('hex')
  })
})

register({
  name: 'uuid.v4',
  version: '1.0.0',
  description: 'Generate random UUID v4 values.',
  category: 'security',
  input: z.object({ count: z.number().int().min(1).max(100).default(1) }),
  permissions: NO_CAPABILITIES,
  deterministic: false,
  verified: V,
  execute: ({ count }) => ({ uuids: Array.from({ length: count }, () => randomUUID()) })
})

register({
  name: 'random.string',
  version: '1.0.0',
  description: 'Generate a cryptographically random alphanumeric string.',
  category: 'security',
  input: z.object({ length: z.number().int().min(8).max(512).default(32) }),
  permissions: NO_CAPABILITIES,
  deterministic: false,
  verified: V,
  execute: ({ length }) => {
    const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    const bytes = randomBytes(length)
    return { random: Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('') }
  }
})

register({
  name: 'jwt.decode',
  version: '1.0.0',
  description: 'Decode a JWT (JWS compact serialization) header and claims WITHOUT verifying the signature. Reports expiry status from the exp claim.',
  category: 'security',
  input: z.object({ token: z.string().min(10) }),
  permissions: NO_CAPABILITIES,
  deterministic: true,
  verified: V,
  execute: ({ token }) => {
    const parts = token.trim().split('.')
    if (parts.length !== 3) throw new Error('expected three dot-separated segments')
    const b64u = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    const header = JSON.parse(b64u(parts[0]))
    const payload = JSON.parse(b64u(parts[1]))
    const exp = typeof payload.exp === 'number' ? payload.exp : null
    return {
      header,
      claims: payload,
      signatureVerified: false,
      expired: exp !== null ? Date.now() / 1000 > exp : null
    }
  }
})

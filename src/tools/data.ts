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

register({
  name: 'json.format',
  version: '1.0.0',
  description: 'Validate and pretty-print JSON with a configurable indent level.',
  category: 'data',
  input: z.object({ json: z.string().min(1), indent: z.number().int().min(0).max(8).default(2) }),
  permissions: NO_CAPABILITIES,
  deterministic: true,
  verified: V,
  execute: ({ json, indent }) => {
    const parsed = JSON.parse(json)
    return { valid: true, formatted: JSON.stringify(parsed, null, indent) }
  }
})

register({
  name: 'json.minify',
  version: '1.0.0',
  description: 'Validate JSON and strip all insignificant whitespace.',
  category: 'data',
  input: z.object({ json: z.string().min(1) }),
  permissions: NO_CAPABILITIES,
  deterministic: true,
  verified: V,
  execute: ({ json }) => {
    const parsed = JSON.parse(json)
    return { valid: true, minified: JSON.stringify(parsed) }
  }
})

register({
  name: 'json.validate',
  version: '1.0.0',
  description: 'Validate JSON and report the parse error position if invalid.',
  category: 'data',
  input: z.object({ json: z.string().min(1) }),
  permissions: NO_CAPABILITIES,
  deterministic: true,
  verified: V,
  execute: ({ json }) => {
    try {
      JSON.parse(json)
      return { valid: true }
    } catch (e: any) {
      return { valid: false, error: String(e?.message || e) }
    }
  }
})

register({
  name: 'base64.encode',
  version: '1.0.0',
  description: 'Base64-encode text (standard alphabet).',
  category: 'data',
  input: z.object({ text: z.string() }),
  permissions: NO_CAPABILITIES,
  deterministic: true,
  verified: V,
  execute: ({ text }) => ({ base64: Buffer.from(text, 'utf8').toString('base64') })
})

register({
  name: 'base64.decode',
  version: '1.0.0',
  description: 'Base64-decode to text.',
  category: 'data',
  input: z.object({ base64: z.string().min(1) }),
  permissions: NO_CAPABILITIES,
  deterministic: true,
  verified: V,
  execute: ({ base64 }) => ({ text: Buffer.from(base64, 'base64').toString('utf8') })
})

register({
  name: 'url.encode',
  version: '1.0.0',
  description: 'Percent-encode text (component encoding).',
  category: 'network',
  input: z.object({ text: z.string() }),
  permissions: NO_CAPABILITIES,
  deterministic: true,
  verified: V,
  execute: ({ text }) => ({ encoded: encodeURIComponent(text) })
})

register({
  name: 'url.decode',
  version: '1.0.0',
  description: 'Decode percent-encoded text.',
  category: 'network',
  input: z.object({ text: z.string() }),
  permissions: NO_CAPABILITIES,
  deterministic: true,
  verified: V,
  execute: ({ text }) => ({ decoded: decodeURIComponent(text) })
})

register({
  name: 'slug.generate',
  version: '1.0.0',
  description: 'Convert text to a URL-safe kebab-case slug.',
  category: 'dev',
  input: z.object({ text: z.string().min(1) }),
  permissions: NO_CAPABILITIES,
  deterministic: true,
  verified: V,
  execute: ({ text }) => ({
    slug: text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  })
})

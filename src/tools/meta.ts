import { z } from 'zod'
import { register, verifiedBadge, getRegistry } from '../registry.js'

register({
  name: 'formatho.registry',
  version: '1.0.0',
  description: 'List every registered Formatho tool with version, category, deterministic flag, permissions, and Formatho Verified status.',
  category: 'meta',
  input: z.object({}),
  permissions: { network: false, filesystem: false, secrets: false, subprocess: false },
  deterministic: true,
  verified: {
    sourceReviewed: true,
    dependenciesReviewed: true,
    networkBehaviorReviewed: true,
    sandboxCompatible: true,
    schemaDefined: true,
    versionPinned: true
  },
  // reads the registry at call time so the listing is always current
  execute: () => {
    return getRegistry().map((t) => ({
      name: t.name,
      version: t.version,
      category: t.category,
      deterministic: t.deterministic,
      permissions: t.permissions,
      verified: verifiedBadge(t)
    }))
  }
})

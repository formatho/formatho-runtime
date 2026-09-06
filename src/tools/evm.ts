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

const keccakHex = (data: Uint8Array): string => '0x' + Buffer.from(keccak_256(data)).toString('hex')

// ---- signature dictionary (mirrors formatho.com/tools/calldata-decoder) ----
const DICTIONARY = [
  'transfer(address,uint256)', 'transferFrom(address,address,uint256)', 'approve(address,uint256)',
  'allowance(address,address)', 'balanceOf(address)', 'totalSupply()',
  'permit(address,address,uint256,uint256,uint8,bytes32,bytes32)',
  'permit(address,uint256,uint256,uint256,bool,uint8,bytes32,bytes32)',
  'deposit()', 'withdraw(uint256)', 'mint(uint256)', 'burn(uint256)', 'mint(address,uint256)',
  'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)',
  'transferOwnership(address)', 'renounceOwnership()', 'owner()', 'implementation()', 'upgradeTo(address)',
  'pause()', 'unpause()', 'setApprovalForAll(address,bool)',
  'Transfer(address,address,uint256)', 'Approval(address,address,uint256)'
]

register({
  name: 'evm.keccak256',
  version: '1.0.0',
  description: 'Keccak-256 (Ethereum flavor, NOT NIST SHA3-256) of arbitrary hex or text.',
  category: 'web3',
  input: z.object({ data: z.string().min(1), encoding: z.enum(['hex', 'utf8']).default('utf8') }),
  permissions: NO_CAPABILITIES,
  deterministic: true,
  verified: V,
  execute: ({ data, encoding }) => {
    if (encoding === 'hex') {
      const clean = data.replace(/^0x/, '')
      if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2 !== 0) {
        throw new Error('invalid hex string: expected 0x-prefixed, even-length hex characters')
      }
    }
    const bytes = encoding === 'hex' ? Buffer.from(data.replace(/^0x/, ''), 'hex') : Buffer.from(data, 'utf8')
    return { hash: keccakHex(bytes) }
  }
})

register({
  name: 'evm.function_selector',
  version: '1.0.0',
  description: 'Compute the 4-byte function selector from a canonical signature, with reverse lookup against common signatures.',
  category: 'web3',
  input: z.object({ signature: z.string().min(3).optional(), selector: z.string().regex(/^0x[0-9a-fA-F]{8}$/).optional() }),
  permissions: NO_CAPABILITIES,
  deterministic: true,
  verified: V,
  execute: ({ signature, selector }) => {
    if (signature) {
      const sel = keccakHex(Buffer.from(signature, 'utf8')).slice(0, 10)
      return { signature, selector: sel }
    }
    if (selector) {
      const matches = DICTIONARY.filter(
        (s) => keccakHex(Buffer.from(s, 'utf8')).slice(0, 10) === selector.toLowerCase()
      )
      return { selector: selector.toLowerCase(), matches }
    }
    throw new Error('provide signature or selector')
  }
})

register({
  name: 'evm.create2_address',
  version: '1.0.0',
  description: 'Compute the deterministic CREATE2 address: keccak256(0xff ‖ factory ‖ salt ‖ initCodeHash)[12:].',
  category: 'web3',
  input: z.object({
    factory: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    salt: z.string().regex(/^0x[0-9a-fA-F]{1,64}$/),
    initCodeHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/)
  }),
  permissions: NO_CAPABILITIES,
  deterministic: true,
  verified: V,
  execute: ({ factory, salt, initCodeHash }) => {
    const pre = Buffer.concat([
      Buffer.from([0xff]),
      Buffer.from(factory.slice(2).padStart(40, '0'), 'hex'),
      Buffer.from(salt.slice(2).padStart(64, '0'), 'hex'),
      Buffer.from(initCodeHash.slice(2), 'hex')
    ])
    return { address: '0x' + keccakHex(pre).slice(26) }
  }
})

register({
  name: 'evm.storage_slot',
  version: '1.0.0',
  description: 'Compute Solidity storage slots: simple variables, mapping values (keccak(key ‖ p)), and dynamic array elements (keccak(p) + index).',
  category: 'web3',
  input: z.object({
    kind: z.enum(['simple', 'mapping', 'array']).default('mapping'),
    baseSlot: z.number().int().min(0),
    keyHex: z.string().regex(/^0x[0-9a-fA-F]{1,64}$/).optional(),
    arrayIndex: z.number().int().min(0).optional()
  }),
  permissions: NO_CAPABILITIES,
  deterministic: true,
  verified: V,
  execute: ({ kind, baseSlot, keyHex, arrayIndex }) => {
    const p = Buffer.alloc(32)
    p.writeBigUInt64BE(BigInt(baseSlot), 24)
    if (kind === 'simple') return { slot: '0x' + p.toString('hex') }
    if (kind === 'mapping') {
      if (!keyHex) throw new Error('keyHex required for mapping')
      const k = Buffer.from(keyHex.slice(2).padStart(64, '0'), 'hex')
      return { slot: keccakHex(Buffer.concat([k, p])) }
    }
    const base = keccak_256(p)
    const elem = Buffer.from(base)
    // element slot = keccak(p) + index (big-endian 32-byte arithmetic)
    let carry = BigInt(arrayIndex ?? 0)
    for (let i = 31; i >= 0 && carry > 0n; i--) {
      const sum = BigInt(elem[i]) + (carry & 0xffn)
      elem[i] = Number(sum & 0xffn)
      carry = (carry >> 8n) + (sum >> 8n)
    }
    return { slot: '0x' + Buffer.from(elem).toString('hex') }
  }
})

register({
  name: 'evm.decode_calldata',
  version: '1.0.0',
  description: 'Extract the 4-byte selector from raw calldata, match it against common signatures, and decode static (word-based) arguments: address, uint256, int256, bytes32, bool.',
  category: 'web3',
  input: z.object({ calldata: z.string().regex(/^0x[0-9a-fA-F]+$/).refine((s) => s.length >= 10, 'at least selector + data') }),
  permissions: NO_CAPABILITIES,
  deterministic: true,
  verified: V,
  execute: ({ calldata }) => {
    const bytes = Buffer.from(calldata.slice(2), 'hex')
    const selector = '0x' + bytes.subarray(0, 4).toString('hex')
    const matches = DICTIONARY.filter((s) => keccakHex(Buffer.from(s, 'utf8')).slice(0, 10) === selector)
    const sig = matches[0]
    const args: { index: number; type: string; value: string }[] = []

    if (sig) {
      const types = sig.slice(sig.indexOf('(') + 1, -1).split(',').filter(Boolean)
      types.forEach((t, i) => {
        const word = bytes.subarray(4 + i * 32, 4 + (i + 1) * 32)
        if (!word.length) return
        if (t === 'address') args.push({ index: i, type: t, value: '0x' + word.subarray(12).toString('hex') })
        else if (t.startsWith('uint')) args.push({ index: i, type: t, value: BigInt('0x' + word.toString('hex')).toString() })
        else if (t.startsWith('int')) {
          const v = BigInt.asIntN(256, BigInt((word[0] & 0x80) === 0 ? '0x' + word.toString('hex') : '-0x' + word.toString('hex')))
          args.push({ index: i, type: t, value: v.toString() })
        } else if (t === 'bool') args.push({ index: i, type: t, value: word[31] === 1 ? 'true' : 'false' })
        else args.push({ index: i, type: t, value: '0x' + word.toString('hex') })
      })
    }
    return {
      selector,
      signature: sig ?? null,
      matches,
      staticArgs: args,
      note: sig ? null : 'selector not in dictionary; dynamic types (bytes/string/arrays) need the ABI — coming with the REST gateway'
    }
  }
})

register({
  name: 'evm.v4_hook_permissions',
  version: '1.0.0',
  description: 'Uniswap v4 hook permissions: compute the 14-bit permission field from hook-call names, or decode the field from a hook address (bits live in the LOW 14 bits: address & 0x3FFF).',
  category: 'web3',
  input: z.object({
    calls: z.array(z.enum([
      'beforeInitialize', 'afterInitialize', 'beforeAddLiquidity', 'afterAddLiquidity',
      'beforeRemoveLiquidity', 'afterRemoveLiquidity', 'beforeSwap', 'afterSwap',
      'beforeDonate', 'afterDonate', 'beforeSwapReturnsDelta', 'afterSwapReturnsDelta',
      'afterAddLiquidityReturnsDelta', 'afterRemoveLiquidityReturnsDelta'
    ])).optional(),
    address: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional()
  }),
  permissions: NO_CAPABILITIES,
  deterministic: true,
  verified: V,
  execute: ({ calls, address }) => {
    const BITS: Record<string, number> = {
      beforeInitialize: 13, afterInitialize: 12, beforeAddLiquidity: 11, afterAddLiquidity: 10,
      beforeRemoveLiquidity: 9, afterRemoveLiquidity: 8, beforeSwap: 7, afterSwap: 6,
      beforeDonate: 5, afterDonate: 4, beforeSwapReturnsDelta: 3, afterSwapReturnsDelta: 2,
      afterAddLiquidityReturnsDelta: 1, afterRemoveLiquidityReturnsDelta: 0
    }
    if (calls) {
      let field = 0
      for (const c of calls) field |= 1 << BITS[c]
      return { permissionField: '0x' + field.toString(16).padStart(4, '0'), requiredSuffix: 'address & 0x3FFF must equal this value' }
    }
    if (address) {
      const field = BigInt(address) & 0x3fffn
      const active = Object.entries(BITS).filter(([, b]) => ((Number(field) >> b) & 1) === 1).map(([n]) => n)
      return { address, permissionField: '0x' + field.toString(16).padStart(4, '0'), calls: active }
    }
    throw new Error('provide calls or address')
  }
})

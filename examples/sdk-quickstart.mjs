#!/usr/bin/env node
/**
 * Formatho Runtime — REST SDK quickstart (Node ≥ 20, zero dependencies).
 *
 * Start the gateway first:
 *   FORMATHO_API_KEYS="devkey-1:local-agent" node dist/index.js --http
 * Then:
 *   node examples/sdk-quickstart.mjs
 */

const BASE_URL = process.env.FORMATHO_URL || 'http://127.0.0.1:8787'
const API_KEY = process.env.FORMATHO_KEY || 'devkey-1'

/** Minimal SDK: registry listing + typed-ish tool invocation over REST. */
class Formatho {
  constructor(baseUrl = BASE_URL, apiKey = API_KEY) {
    this.base = baseUrl.replace(/\/+$/, '')
    this.key = apiKey
  }

  async #request(path, body) {
    const res = await fetch(this.base + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${this.key}`,
        ...(body && { 'Content-Type': 'application/json' })
      },
      body: body && JSON.stringify(body)
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${JSON.stringify(json)}`)
    return json
  }

  /** List the tools this API key is allowed to call, with input schemas. */
  tools() { return this.#request('/api/tools') }

  /** Invoke a tool by name — input is the tool's JSON input. */
  call(name, input) { return this.#request(`/api/tools/${name}`, input ?? {}) }
}

const formatho = new Formatho()

// 1. Discover what your key can see
const registry = await formatho.tools()
console.log(`registry: ${registry.tools?.length ?? '?'} tools visible to this key`)

// 2. Compute an Ethereum function selector
const selector = await formatho.call('evm.function_selector', {
  signature: 'transfer(address,uint256)'
})
console.log('selector:', selector.selector) // → 0xa9059cbb

// 3. Exact wei/gwei/ether conversion
const units = await formatho.call('evm.unit_convert', {
  value: '1500000000', from: 'wei', to: 'gwei'
})
console.log('units:', JSON.stringify(units))

// 4. Keccak-256 (Ethereum flavor — not SHA3-256)
const digest = await formatho.call('evm.keccak256', {
  data: 'transfer(address,uint256)', encoding: 'utf8'
})
console.log('keccak256:', digest.hash?.slice(0, 20) + '…')

// 5. Validate JSON without a parser of your own
const check = await formatho.call('json.validate', { json: '{"a":1,}' })
console.log('json valid:', check.valid, check.parseError ? `(${check.parseError})` : '')

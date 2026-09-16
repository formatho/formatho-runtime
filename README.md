# Formatho Runtime

**The self-hosted MCP server for AI agents.**

[![Docker](https://img.shields.io/badge/docker-formatho%2Fformatho--runtime-2496ED?logo=docker)](https://hub.docker.com/r/formatho/formatho-runtime)
[![Version](https://img.shields.io/badge/version-0.3.0-333)](https://hub.docker.com/r/formatho/formatho-runtime)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](#)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-com.formatho%2Fruntime-7c3aed)](https://registry.modelcontextprotocol.io)

Formatho Runtime exposes a catalog of deterministic developer, security, and
EVM tools to AI agents over the Model Context Protocol — inside your
infrastructure, with per-key permissions, policies, rate limits, and
metadata-only audit logging.

```text
Claude Code / Cursor / Claude Desktop / any MCP client
   ↓  MCP (stdio)                    ↘  REST + Streamable HTTP
Formatho Runtime  →  API keys → policy → rate limit → pure-function tool
Deterministic, network-free execution — payloads never leave the process
```

- [Why](#why)
- [Quick start](#quick-start)
- [Connect your agent](#connect-your-agent)
- [SDK quickstart](#sdk-quickstart)
- [Tools (26)](#tools-26)
- [HTTP gateway, keys, and policies](#http-gateway-keys-and-policies)
- [Privacy commitments](#privacy-commitments-self-hosted-bundle)
- [Security model](#security-model)
- [Roadmap](#roadmap)
- [Relationship to formatho.com](#relationship-to-formathocom)

## Why

Sending payloads to third-party SaaS tools means sending them your JWTs,
your calldata, your compliance data. Formatho Runtime runs the tools where
your data already lives: your laptop, your Docker host, your VPC. Every
tool is a **pure function** — no network, no filesystem, no secrets, no
subprocess — so "your data never leaves this process" is a property of the
architecture, not a promise.

## Quick start

The fastest path is the published image (stdio transport, zero config):

```bash
docker run -i --rm -v formatho-audit:/data formatho/formatho-runtime
```

Or from source (Node ≥ 20):

```bash
git clone https://github.com/formatho/formatho-runtime && cd formatho-runtime
npm install && npm run build
node dist/index.js        # stdio MCP server
```

For network-facing deployments with API keys and policies, see
[HTTP gateway](#http-gateway-keys-and-policies).

## Connect your agent

**Claude Code** — one command:

```bash
claude mcp add formatho -- docker run -i --rm -v formatho-audit:/data formatho/formatho-runtime
```

**Cursor** — `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "formatho": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-v", "formatho-audit:/data", "formatho/formatho-runtime"]
    }
  }
}
```

**Claude Desktop** — Settings → Developer → Edit Config
(`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "formatho": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-v", "formatho-audit:/data", "formatho/formatho-runtime"]
    }
  }
}
```

**Any MCP client over HTTP** — run the gateway and point clients at
`http://localhost:8787/mcp` (Streamable HTTP). The same tools are also
available as plain REST at `/api/tools/*`.

## SDK quickstart

The REST gateway makes the runtime a library for anything that can make an
HTTP call — scripts, CI, internal services, and agents that do not speak
MCP. Runable examples live in [`examples/`](examples/):
[`sdk-quickstart.mjs`](examples/sdk-quickstart.mjs) and
[`sdk-quickstart.py`](examples/sdk-quickstart.py).

Start the gateway with an API key:

```bash
FORMATHO_API_KEYS="devkey-1:local-agent" node dist/index.js --http
```

**Node ≥ 20 (zero dependencies):**

```js
class Formatho {
  constructor(base, key) { this.base = base; this.key = key }
  async #req(path, body) {
    const res = await fetch(this.base + path, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${this.key}`, ...(body && { 'Content-Type': 'application/json' }) },
      body: body && JSON.stringify(body)
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(json)}`)
    return json
  }
  tools() { return this.#req('/api/tools') }
  call(name, input) { return this.#req(`/api/tools/${name}`, input ?? {}) }
}

const formatho = new Formatho('http://127.0.0.1:8787', 'devkey-1')
await formatho.call('evm.function_selector', { signature: 'transfer(address,uint256)' })
// → { "signature": "transfer(address,uint256)", "selector": "0xa9059cbb" }
```

**Python 3.9+ (stdlib only):**

```python
class Formatho:
    def __init__(self, base, key): self.base, self.key = base, key
    def _req(self, path, body=None):
        req = urllib.request.Request(self.base + path, method="POST" if body else "GET",
            headers={"Authorization": f"Bearer {self.key}"},
            data=json.dumps(body).encode() if body else None)
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.loads(res.read())
    def tools(self): return self._req("/api/tools")
    def call(self, name, **input): return self._req(f"/api/tools/{name}", input)

formatho = Formatho("http://127.0.0.1:8787", "devkey-1")
formatho.call("evm.unit_convert", value="1500000000", **{"from": "wei", "to": "gwei"})
# → {'value': '1.500000000', 'unit': 'gwei'}
```

**curl**, for pipelines and shell scripts:

```bash
curl -H "Authorization: Bearer devkey-1" \
     -d '{"signature":"transfer(address,uint256)"}' \
     http://127.0.0.1:8787/api/tools/evm.function_selector
```

Errors come back as structured zod validation messages (HTTP 422) — the
`path` names the exact input field that failed, so agents can self-correct.

## Tools (26)

| Name | Category | What it does |
| --- | --- | --- |
| `json.format` / `json.validate` / `json.minify` | data | JSON parse, pretty-print, minify |
| `base64.encode` / `base64.decode` | data | Base64 text conversion |
| `hex.encode` | data | Text ↔ hex |
| `url.encode` / `url.decode` | network | Percent-encoding |
| `slug.generate` | dev | Kebab-case slugs |
| `hash.text` | security | md5/sha1/sha256/sha384/sha512 |
| `uuid.v4` / `random.string` | security | Cryptographic randomness |
| `jwt.decode` | security | JWT header/claims decode (no signature verification) |
| `evm.keccak256` | web3 | Keccak-256 (Ethereum flavor — not SHA3-256) |
| `evm.function_selector` | web3 | Signature ↔ 4-byte selector with dictionary |
| `evm.create2_address` | web3 | Deterministic CREATE2 address |
| `evm.storage_slot` | web3 | Solidity storage slot computation |
| `evm.decode_calldata` | web3 | Selector match + static arg decode |
| `evm.v4_hook_permissions` | web3 | Uniswap v4 hook permission bits |
| `evm.checksum_address` | web3 | EIP-55 checksum (verify + compute) |
| `evm.unit_convert` | web3 | wei ↔ gwei ↔ ether, exact BigInt |
| `erc4626.math` | defi | Exact EIP-4626 share/asset conversion |
| `timestamp.convert` | dev | Unix ↔ ISO 8601 |
| `regex.test` | dev | Pattern match with capture groups |
| `case.convert` | dev | camel/snake/kebab/constant/title |
| `formatho.registry` | meta | Registry metadata + Formatho Verified status |

Call `formatho.registry` from your agent to discover everything, including
each tool's deterministic flag and verified status.

## HTTP gateway, keys, and policies

```bash
FORMATHO_API_KEYS="devkey-1:local-agent" node dist/index.js --http
# GET  /api/tools          → registry with per-tool allowed flags for this key
# POST /api/tools/<name>   → execute (body = tool input JSON)
# POST /mcp                → MCP Streamable HTTP for remote agents
```

- **API keys** map to agent identities (`FORMATHO_KEYS_FILE=/path/keys.json`
  for many). HTTP mode refuses to start without keys unless you explicitly
  set `FORMATHO_ALLOW_ANONYMOUS=true` (rate-limited).
- **Policies** (`policy.example.json`) restrict which tools each key may
  call — wildcards supported (`evm.*`). Agents unlisted in a policy file are
  denied everything.
- **Rate limits** — per-key burst/RPM (defaults 300/…; anonymous 30 RPM)
  stop runaway agent loops.
- **Docker Compose** ships in `docker-compose.yml` (audit volume, localhost
  bind, policy mount).

## Privacy commitments (self-hosted bundle)

Privacy here is not a policy promise — it is absence of capability. Each claim
below is machine-checkable against this repository and the published image:

1. **No telemetry, no phone-home.** The runtime makes zero outbound requests.
   No analytics, crash reporting, update checks, or registry pings exist in
   the code — verify: `grep -r "fetch(\|https://" src/` returns nothing but
   schemas and docs.
2. **No install-time code execution.** None of the runtime's dependencies
   ship `postinstall` scripts — the supply chain cannot execute on install.
3. **Tools cannot exfiltrate.** Every tool is a pure function; the registry
   refuses registration for any tool declaring network, filesystem, secret,
   or subprocess access. There is no code path from a tool to the network.
4. **Audit logs never contain payloads.** Metadata only (tool, version,
   duration, byte sizes) — by construction in `src/core.ts`.
5. **Three pinned dependencies** (MCP SDK, zod, noble hashes), all
   source-available and reviewed. The image digest you pull is what runs.

Inside your perimeter, what happens is governed by *your* network policy —
the runtime simply gives it nothing to govern.

The hosted tier (`mcp.formatho.com`, when live) is the explicit exception:
payloads transit our server, which is exactly why it is labeled a
rate-limited trial tier whose every 429 points to self-hosting.

## Security model

- **Zero ambient capabilities.** Every tool declares
  `network: false, filesystem: false, secrets: false, subprocess: false` —
  and the registry *refuses to register* any tool that claims otherwise.
  Enforcement is structural: tools are imported pure functions; the runtime
  build contains no capability-grant mechanism to misuse.
- **Audit = metadata, never payloads.** Each invocation logs tool, version,
  duration, success/failure, and input/output *sizes* to
  `FORMATHO_AUDIT_LOG` (JSONL). Payloads are never recorded.
- **Formatho Verified ≠ audited.** Tool metadata carries a per-tool
  verification checklist (source reviewed, dependencies reviewed, network
  behavior reviewed, sandbox compatible, schema defined, version pinned).
  "Audited" is reserved for formal security audits, which have not happened.

Dependency supply chain: `@modelcontextprotocol/sdk`, `zod`,
`@noble/hashes` — three packages, all widely used and pinned.

## Roadmap

- **v0.3.0 (shipped):** Streamable HTTP transport + REST gateway
  (`POST /api/tools/<name>`), API keys, policy engine, rate limiting,
  Docker Compose, MCP Registry listing (`com.formatho/runtime`), OCI labels
  on the published image.
- **Next:** Kubernetes/VPC deployment guides, SSO, per-agent quotas,
  private/custom tools, advanced audit streaming, more tools from the
  formatho.com catalog re-implemented headlessly.

## Relationship to formatho.com

The public website (free browser tools, [open source](https://github.com/formatho)) is the acquisition
layer; this runtime is the productization. Tool logic is intentionally
**re-implemented headlessly here** rather than lifted from Vue components —
same math, validated against the same ground truths (e.g. `evm.create2_address`
matches viem byte-for-byte; `evm.v4_hook_permissions` encodes/decodes a real
deployed hook exactly).

**Not audited. Do not expose this server to untrusted networks yet.**

# Formatho Runtime

**Private infrastructure for AI tools and agents.**

Formatho Runtime exposes the Formatho tool catalog to AI agents over the
Model Context Protocol (MCP) — inside your infrastructure, with tool
permissions declared per tool, and every invocation audit-logged.

```text
AI Agent (Claude, Cursor, any MCP client)
   ↓  MCP (stdio)
Formatho Runtime
   ↓  registry → policy → pure-function tool
Deterministic, network-free execution
```

## Why

Sending payloads to third-party SaaS tools means sending them your JWTs,
your calldata, your compliance data. Formatho Runtime runs the tools where
your data already lives: your laptop, your Docker host, your VPC. Every
tool in Phase 1 is a **pure function** — no network, no filesystem, no
secrets, no subprocess — so "your data never leaves this process" is a
property of the architecture, not a promise.

## Quick start

### Direct (Node ≥ 20)

```bash
git clone https://github.com/formatho/formatho-runtime && cd formatho-runtime
npm install && npm run build
node dist/index.js        # stdio MCP server
```

### Docker

```bash
docker build -t formatho-runtime .
docker run -i --rm \
  -v formatho-audit:/data \
  formatho-runtime
```

### Connect Claude Code

```bash
claude mcp add formatho -- node /path/to/formatho-runtime/dist/index.js
# or via Docker:
claude mcp add formatho -- docker run -i --rm -v formatho-audit:/data formatho/formatho-runtime
```

Claude Desktop (`claude_desktop_config.json`):

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

## Tools (Phase 2 — 25 + registry meta-tool)

| Name | Category | What it does |
| --- | --- | --- |
| `json.format` / `json.validate` / `json.minify` | data | JSON parse, pretty-print, minify |
| `base64.encode` / `base64.decode` | data | Base64 text conversion |
| `url.encode` / `url.decode` | network | Percent-encoding |
| `slug.generate` | dev | Kebab-case slugs |
| `hash.text` | security | md5/sha1/sha256/sha384/sha512 |
| `uuid.v4` / `random.string` | security | Cryptographic randomness |
| `jwt.decode` | security | JWT header/claims decode (no signature verification) |
| `evm.keccak256` | web3 | Keccak-256 (Ethereum flavor) |
| `evm.function_selector` | web3 | Signature ↔ 4-byte selector with dictionary |
| `evm.create2_address` | web3 | Deterministic CREATE2 address |
| `evm.storage_slot` | web3 | Solidity storage slot computation |
| `evm.decode_calldata` | web3 | Selector match + static arg decode |
| `evm.v4_hook_permissions` | web3 | Uniswap v4 hook permission bits |
| `erc4626.math` | defi | Exact EIP-4626 share/asset conversion |
| `timestamp.convert` | dev | Unix ↔ ISO 8601 |
| `regex.test` | dev | Pattern match with capture groups |
| `case.convert` | dev | camel/snake/kebab/constant/title |
| `hex.encode` | data | Text ↔ hex |
| `evm.checksum_address` | web3 | EIP-55 checksum (verify + compute) |
| `evm.unit_convert` | web3 | wei ↔ gwei ↔ ether, exact BigInt |
| `formatho.registry` | meta | Registry metadata + Formatho Verified status |

Call `formatho.registry` from your agent to discover everything, including
each tool's deterministic flag and verified status.

## REST + HTTP MCP gateway (Phase 2)

```bash
FORMATHO_API_KEYS="devkey-1:local-agent" node dist/index.js --http
# GET  /api/tools          → registry with per-tool allowed flags for this agent
# POST /api/tools/<name>   → execute (body = tool input JSON)
# POST /mcp                → MCP Streamable HTTP for remote agents
```

```bash
curl -H "Authorization: Bearer devkey-1" \
     -d '{"signature":"transfer(address,uint256)"}' \
     http://127.0.0.1:8787/api/tools/evm.function_selector
# → { "signature": "transfer(address,uint256)", "selector": "0xa9059cbb" }
```

Per-agent policies (`policy.example.json`) restrict which tools each key
may call — wildcards supported (`evm.*`). Unlisted agents in a policy file
are denied everything. HTTP mode refuses to start without API keys.
Docker Compose ships in `docker-compose.yml` (audit volume, localhost
bind, policy mount).

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

Phase 1 dependency supply chain: `@modelcontextprotocol/sdk`, `zod`,
`@noble/hashes` — three packages, all widely used and pinned.

## Roadmap

- **Phase 2:** Streamable HTTP transport + REST gateway (`POST /api/tools/<name>`),
  API keys, agent allow-lists (policy engine), Docker Compose, more tools
  from the formatho.com catalog re-implemented headlessly.
- **Phase 3:** Kubernetes/VPC deployment guides, SSO, per-agent quotas,
  private/custom tools, advanced audit streaming.

## Relationship to formatho.com

The public website (140+ browser tools, open source) is the acquisition
layer; this runtime is the productization. Tool logic is intentionally
**re-implemented headlessly here** rather than lifted from Vue components —
same math, validated against the same ground truths (e.g. `evm.create2_address`
matches viem byte-for-byte; `evm.v4_hook_permissions` encodes/decodes a real
deployed hook exactly).

**Not audited. Do not expose this server to untrusted networks yet.**

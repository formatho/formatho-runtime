# Formatho Transformation — Current-State Audit & Migration Plan

Grounded in the actual codebases (audited 2026-09-05), per spec §27/§32:
inspect first, then plan.

## A. Current-state audit

### formatho/website (the public product)

- **Stack:** Vue 3 + vite-ssg static site generation, Tailwind, ~140 tools.
  Deployed as static files behind nginx in Docker; Cloudflare in front.
- **Architecture fact that decides everything:** tool logic is **fused into
  Vue components**. A tool's math lives inside `computed()` blocks and event
  handlers in `src/views/*.vue`. There is no headless core layer. Per spec
  §14 ("do not blindly convert UI code into MCP tools"), the website cannot
  be *lifted* into a runtime — headless implementations must be written
  (they are small: most tools are <100 lines of pure math).
- **SEO asset:** 230+ indexed URLs, category/persona/chain programmatic
  pages, FAQ-driven structured data. This is the acquisition layer and must
  not be disturbed (spec §2, §28).
- **Recent strength:** deep EVM tooling (selector/calldata/create2/storage-
  slots/v4-hooks/ERC-4626) with ground-truth-validated math — the exact
  tools that make the runtime's Web3 category a differentiator.

### formatho/cli (nnn-gif scope)

- 134 lines, zero dependencies, ~10 tools (json/base64/url/hash/uuid/random/
  slug/timestamp) with `--json` agent-friendly output. Already the seed of a
  headless tool layer — folded into the runtime as Phase-1 tools.

### formatho/cloudflare-workers

- 16 single-purpose workers (JSON formatter, JWT decoder, …), each a landing
  page + tiny endpoint. Marketing artifacts, not composable infrastructure.
  No reuse for the runtime; keep as SEO surface.

### formatho/infra

- nginx front proxy + Docker Swarm on DigitalOcean. The runtime's Docker
  image can deploy here unchanged (Phase 2/3), but Phase 1 targets
  customer-side/local Docker, not our infrastructure.

### Existing AI/agent functionality

- None beyond tool pages aimed at AI workflows (token counter, agent identity
  generator, prompt-injection tester). No MCP, no API, no policy layer —
  i.e. the entire runtime surface is greenfield.

## B. Product strategy (concurrence with the spec)

Agreed, with three sharpenings:

1. **The wedge is "deterministic, permission-free by construction."** Every
   Phase-1 tool is a pure function — the strongest possible version of the
   §7/§12 security story, and trivially true to verify.
2. **Web3 tools are the credibility engine** (spec §15). The validated EVM
   math from the website ships in Phase 1 already.
3. **The CLI already proves the packaging.** `formatho --json` output format
   becomes the REST/MCP response convention.

Target customer: engineering teams building agents that handle sensitive
payloads (security teams, fintech/blockchain shops, enterprises with
compliance constraints). Monetization: Free tools → self-hosted Runtime
(Pro) → VPC/SSO/audit (Enterprise) → custom tool engineering (Services).

## C. Technical architecture (as built in Phase 1)

```text
MCP client (stdio, Phase 1)
  → @modelcontextprotocol/sdk McpServer
    → Tool Registry (src/registry.ts): name/version/category/zod input
      schema/permissions/deterministic/verified-checklist/execute
    → Policy (Phase 1: structural — registry refuses any tool claiming
      ambient capabilities; there is nothing to grant)
    → Audit (src/audit.ts): JSONL, metadata only (sizes, never payloads)
    → Tool modules (src/tools/{data,security,evm,defi}.ts): pure functions
```

Deliberately absent in Phase 1 (deferred per spec §22 "validate first"):
sandboxing beyond process isolation (not needed — pure functions), network
policies (no tool touches the network), RBAC (single-user local server),
HTTP transport (stdio reaches Claude Desktop/Code today).

## D. Migration plan (phased, concrete)

### Phase 1 — shipped (this repo)

- [x] Registry with the spec §5 metadata model (permissions, deterministic,
      verified checklist, version)
- [x] 20 tools: CLI's set + validated EVM/DeFi math + jwt.decode
- [x] MCP stdio server; `formatho.registry` meta-tool for discovery
- [x] Audit log: JSONL, metadata-only
- [x] Dockerfile (node:22-alpine, audit volume)
- [x] End-to-end protocol test: 15 assertions (handshake, tools/list,
      9 tool calls incl. ground truths, schema rejection, audit contents)

### Phase 2 — next (validation-gated)

1. Streamable HTTP transport + `POST /api/tools/<name>` REST gateway
   sharing the same registry (spec §4: one execution layer, many faces)
2. API keys + agent allow-list policy engine (spec §7/§9: per-agent
   allowed_tools; DENY by default for undeclared tools)
3. Docker Compose; `formatho` CLI rewritten as a thin client of the runtime
4. Grow registry to 40–60 tools (YAML/XML/TOML/CSV, regex, SQL format,
   keccak-heavy EVM set, ABI full decode via a reviewed decoder)
5. Website: add a "Runtime" page + MCP quickstart docs (no redesign —
   additive nav link only)

### Phase 3

Kubernetes/VPC guides, SSO, quotas, audit streaming to SIEM, private/
custom tool loading (signed tool packages), sandboxed execution for tools
that legitimately need network (EVM read tools via allow-listed RPCs —
the first tools with non-zero permissions, gated by the policy engine).

### Phase 4

Formatho Verified program for third-party tools, registry marketplace
shape — only after the runtime has real users (spec §25).

## E. What we are explicitly NOT doing

- Not rewriting or touching the 230+ public tool pages (§28)
- Not lifting Vue component code into the runtime (§14) — headless
  re-implementations only, cross-validated against the same ground truths
- Not claiming "audited" anywhere (§6); metadata says "Formatho Verified"
  with a per-tool checklist
- Not building sandboxes/policies for capabilities no Phase-1 tool has —
  the policy engine lands with the first tool that needs it (EVM reads)

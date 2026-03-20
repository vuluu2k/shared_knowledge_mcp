# Shared Knowledge MCP

**Give your AI agent a brain that understands your entire codebase.**

Shared Knowledge MCP connects your Phoenix backend and Vue 3 frontend into a single intelligent context layer. Ask a question, get a complete answer — routes, schemas, frontend usage, impact analysis — in one call. No more jumping between files. No more wasted tokens.

Built for [BuilderX](https://github.com/pancake-vn) — works with any Phoenix + Vue project.

---

## The Problem

Your AI agent is smart, but it's blind:

```
You:   "How does the order API work?"
Agent: *reads 15 files* *burns 25,000 tokens* *still misses the frontend side*

You:   "What breaks if I change this schema?"
Agent: "I don't know, let me grep around..." *10 more tool calls*

You:   "Remember that business rule we discussed yesterday?"
Agent: "I have no memory of previous conversations."
```

## The Solution

```
You:   "How does the order API work?"
Agent: *calls smart_context* → complete answer in 800 tokens, 1 call

You:   "What breaks if I change this schema?"
Agent: *calls analyze_impact* → full dependency chain + risk assessment

You:   "Remember that business rule we discussed yesterday?"
Agent: *calls recall_memory* → instantly retrieved from GitHub
```

---

## Quick Start

```bash
# Install
cd shared_knowledge_mcp
npm install
npm run build

# Run
npm start
```

### Connect to Claude Code

Add to `.claude/settings.json`:

```json
{
  "mcpServers": {
    "shared-knowledge": {
      "command": "node",
      "args": ["<path-to>/shared_knowledge_mcp/dist/index.js"],
      "env": {
        "BUILDERX_API_PATH": "/path/to/backend",
        "BUILDERX_SPA_PATH": "/path/to/frontend",
        "MEMORY_REPO_OWNER": "your-github-username",
        "MEMORY_REPO_NAME": "shared-knowledge-memory",
        "MEMORY_REPO_TOKEN": "ghp_xxx (optional, uses gh CLI auth by default)"
      }
    }
  }
}
```

---

## 13 Tools

### Intelligent Layer (start here)

#### `smart_context` — One call to understand anything

Ask a natural language question. The tool auto-detects what you need, runs the right parsers in parallel, and returns a compact markdown answer.

```
smart_context("How does the customer order flow work?")
```

Returns backend routes + schemas + context functions + frontend API callers + store actions + saved memories — all in one response. **Saves 70-90% tokens** compared to calling individual tools.

| Param | Description |
|-------|-------------|
| `question` | Any question about your codebase |
| `depth` | `"brief"` (default) or `"detailed"` |

---

#### `analyze_impact` — Know what breaks before you break it

Trace the full dependency chain across both repos. Change a backend schema? See every frontend component that will be affected.

```
analyze_impact("lib/builderx_api/orders/order.ex")
```

Returns:
```
Schema → Context (6 functions) → Controller (8 actions) → Routes (12)
  → Frontend API (3 modules) → Stores (2) → Components (5)

Risk Assessment: HIGH — 15 frontend artifacts affected
```

| Param | Description |
|-------|-------------|
| `target` | File path or function name |
| `repo` | `"backend"`, `"frontend"`, or `"auto"` |
| `direction` | `"both"`, `"dependents"`, or `"dependencies"` |
| `depth` | Trace depth 1-5 (default: 3) |

---

### Code Analysis

#### `get_api_schema` — Full backend API map

Parse all Phoenix routes, controllers, params, response types, Ecto schemas.

```json
{ "controller": "Customer", "include_schemas": true }
```

#### `get_ui_requirements` — What the frontend expects

Parse all Vue API modules, composable fetch calls, Pinia store actions.

```json
{ "url_pattern": "/customer", "method": "POST" }
```

#### `sync_contract` — Find backend/frontend mismatches

Compare routes vs API usage. Find missing endpoints, wrong methods, unused routes.

```json
{ "severity": "error", "mismatches_only": true }
```

#### `search_code` — Grep across both repos

Regex search with context lines. Skips node_modules, _build, deps automatically.

```json
{ "query": "def create_order", "repo": "backend", "file_pattern": "*.ex" }
```

#### `read_source` — Read any file with line numbers

Read specific line ranges from either repo. Supports directories too.

```json
{ "repo": "backend", "file_path": "lib/builderx_api/orders/orders.ex", "start_line": 45, "num_lines": 20 }
```

---

### Code Generation

#### `generate_backend_code` — Scaffold Phoenix modules

Generates schema + context + controller + migration + route snippet. Follows your project conventions: Citus sharding, UUID PKs, site_id scoping, permission plugs.

```json
{
  "domain": "loyalty_programs",
  "fields": [
    { "name": "name", "type": ":string" },
    { "name": "points", "type": ":integer", "default": "0" }
  ],
  "permissions": ["view_loyalty", "manage_loyalty"]
}
```

#### `generate_client` — Scaffold frontend API client

Generates TypeScript/JavaScript API client from backend routes. Supports class-based (BaseApi) or Vue composable style.

```json
{ "controller": "Order", "format": "typescript", "style": "composable" }
```

---

### Long-term Memory (GitHub-backed)

Your AI agent remembers across conversations. Business rules, task history, architecture decisions — all stored as markdown in a private GitHub repo.

#### `save_memory` — Save knowledge

```json
{
  "category": "business",
  "title": "Order discount rules",
  "content": "Discount max 30%. Cannot combine with loyalty points. VIP customers get 5% extra.",
  "tags": ["order", "discount", "business-rule"]
}
```

#### `recall_memory` — Search saved knowledge

```json
{ "query": "discount", "category": "business" }
```

#### `list_memories` — Browse all saved knowledge

```json
{ "category": "decisions" }
```

#### `delete_memory` — Remove outdated knowledge

```json
{ "category": "business", "id": "old-discount-rules" }
```

**4 memory categories:**

| Category | What to store |
|----------|--------------|
| `business` | Domain rules, workflows, validation logic |
| `tasks` | Task history, what was done, outcomes |
| `analysis` | API analysis snapshots, cached results |
| `decisions` | Architecture decisions, tech choices, trade-offs |

---

## How It Works

### Architecture

```
                    +-----------------+
                    |   AI Agent      |
                    |  (Claude, etc.) |
                    +--------+--------+
                             |
                        MCP Protocol
                             |
                    +--------+--------+
                    | Shared Knowledge|
                    |   MCP Server    |
                    +--------+--------+
                             |
          +------------------+------------------+
          |                  |                  |
   +------+------+   +------+------+   +-------+------+
   | Phoenix     |   | Vue 3       |   | GitHub       |
   | Backend     |   | Frontend    |   | Memory Repo  |
   | (1022 routes|   | (48 API     |   | (persistent) |
   |  106 ctrls) |   |  modules)   |   |              |
   +-------------+   +-------------+   +--------------+
```

### Cache Layer (mtime + md5)

All parsers are wrapped with a file-hash cache. First call parses from disk. Subsequent calls return in **<5ms** if source files haven't changed.

```
First call:  parse 8 router files → 200ms → cache result
Second call: check mtime → unchanged → return cache → <5ms
File edited: check mtime → changed → hash content → re-parse → update cache
```

### Token Savings

| Scenario | Without MCP | With MCP | Savings |
|----------|-------------|----------|---------|
| "How does order work?" | ~25,000 tokens (15 file reads) | ~800 tokens (1 smart_context call) | **97%** |
| "What breaks if I change X?" | ~10,000 tokens (grep + read) | ~500 tokens (1 analyze_impact call) | **95%** |
| "Remember the business rule" | Impossible | ~200 tokens (1 recall_memory call) | -- |
| Repeated questions | Same cost every time | <5ms from cache | **99%** |

---

## Real-world Example

**Task: "Add loyalty points to customers, earn points on order completion"**

```
Step 1: smart_context("customer and order")
        → Understand both domains in 1 call

Step 2: analyze_impact("customer")
        → Know which files to touch, what might break

Step 3: recall_memory("loyalty")
        → Check if there are existing business rules

Step 4: read_source(file: "customer.ex")
        → Read the specific code to modify

Step 5: generate_backend_code(domain: "loyalty_points", ...)
        → Scaffold schema + context + controller + migration

Step 6: generate_client(controller: "LoyaltyPoint")
        → Generate frontend API client

Step 7: save_memory(title: "Loyalty points flow", ...)
        → Save business logic for future reference

Total: 7 calls, ~2,000 tokens
Without MCP: 20+ file reads, ~25,000 tokens
```

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BUILDERX_API_PATH` | No | `../builderx_api` | Path to Phoenix backend repo |
| `BUILDERX_SPA_PATH` | No | `../builderx_spa` | Path to Vue 3 frontend repo |
| `MEMORY_REPO_OWNER` | No | Auto-detect from `gh` CLI | GitHub username for memory repo |
| `MEMORY_REPO_NAME` | No | `shared-knowledge-memory` | Memory repo name |
| `MEMORY_REPO_TOKEN` | No | Uses `gh` CLI auth | GitHub personal access token |
| `MEMORY_REPO_PATH` | No | `~/.shared-knowledge-memory` | Local clone path for memory repo |

## Project Structure

```
shared_knowledge_mcp/
├── src/
│   ├── index.ts                       # MCP server (13 tools registered)
│   ├── types.ts                       # Shared TypeScript types
│   ├── cache/
│   │   ├── file-hash-cache.ts         # mtime + md5 caching engine
│   │   └── cached-parsers.ts          # Cached wrappers for all parsers
│   ├── parsers/
│   │   ├── phoenix-router.ts          # Parse Phoenix routes (8 router files)
│   │   ├── phoenix-controller.ts      # Parse controller actions (106 controllers)
│   │   ├── phoenix-schema.ts          # Parse Ecto schemas
│   │   ├── phoenix-context.ts         # Parse context modules
│   │   ├── vue-api.ts                 # Parse Vue API modules (48 modules)
│   │   ├── vue-store.ts               # Parse Pinia stores
│   │   ├── vue-component-imports.ts   # Parse component → store imports
│   │   └── diff-engine.ts            # Backend ↔ frontend contract diff
│   └── tools/
│       ├── smart-context.ts           # Intelligent one-call context
│       ├── analyze-impact.ts          # Cross-repo dependency tracer
│       ├── get-api-schema.ts          # Backend API schema extractor
│       ├── get-ui-requirements.ts     # Frontend usage extractor
│       ├── sync-contract.ts           # Contract mismatch finder
│       ├── generate-client.ts         # Frontend API client generator
│       ├── generate-backend-code.ts   # Phoenix code scaffolder
│       ├── memory.ts                  # GitHub-backed persistent memory
│       └── codebase.ts                # Code search + file reader
├── package.json
├── tsconfig.json
└── .gitignore
```

## Scripts

```bash
npm install     # Install dependencies
npm run build   # Compile TypeScript → dist/
npm start       # Start MCP server
npm run dev     # Watch mode (auto-rebuild on changes)
```

---

**Stop making your AI agent read files one by one. Give it the full picture in one call.**

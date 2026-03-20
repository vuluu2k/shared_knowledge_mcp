# Shared Knowledge MCP

MCP (Model Context Protocol) server phân tích code realtime giữa **BuilderX API** (Elixir Phoenix) và **BuilderX SPA** (Vue 3). Stateless — không lưu trữ gì, chỉ đọc code trực tiếp từ 2 repo và trả kết quả ngay.

## Yêu cầu

- Node.js >= 18
- 2 repo cần phân tích:
  - `builderx_api` — Phoenix backend
  - `builderx_spa` — Vue 3 frontend

## Cài đặt

```bash
cd shared_knowledge_mcp
npm install
npm run build
```

## Chạy

```bash
npm start
```

Hoặc chỉ định đường dẫn repo qua biến môi trường:

```bash
BUILDERX_API_PATH=/path/to/builderx_api \
BUILDERX_SPA_PATH=/path/to/builderx_spa \
npm start
```

Mặc định server sẽ tìm 2 repo ở thư mục cùng cấp (`../builderx_api`, `../builderx_spa`).

## Cấu hình cho Claude Code

Thêm vào `.claude/settings.json`:

```json
{
  "mcpServers": {
    "shared-knowledge": {
      "command": "node",
      "args": ["/Users/mac/Documents/web_cake/shared_knowledge_mcp/dist/index.js"],
      "env": {
        "BUILDERX_API_PATH": "/Users/mac/Documents/web_cake/builderx_api",
        "BUILDERX_SPA_PATH": "/Users/mac/Documents/web_cake/builderx_spa"
      }
    }
  }
}
```

## 5 Tools

### 1. `get_api_schema`

Phân tích Phoenix backend — trích xuất routes, controllers, params, response types, Ecto schemas, context functions.

**Params:**

| Tên | Kiểu | Mô tả |
|-----|------|-------|
| `path_prefix` | string | Lọc theo prefix URL, vd: `/api/v1/dashboard` |
| `method` | string | Lọc theo HTTP method: `GET`, `POST`, `PUT`, `DELETE` |
| `controller` | string | Lọc theo tên controller (substring match) |
| `pipeline` | string | Lọc theo pipeline: `api`, `auth`, `account`, `site` |
| `include_schemas` | boolean | Bao gồm chi tiết Ecto schema fields (mặc định: `true`) |
| `include_context` | boolean | Bao gồm context function signatures (mặc định: `false`) |

**Ví dụ:**

```json
{
  "controller": "Customer",
  "include_schemas": true,
  "include_context": true
}
```

**Kết quả:** Danh sách endpoints với route, controller, action, params, response type, schema fields, context functions.

---

### 2. `get_ui_requirements`

Phân tích Vue 3 frontend — trích xuất API endpoint usage từ API modules, composable fetch calls, và Pinia stores.

**Params:**

| Tên | Kiểu | Mô tả |
|-----|------|-------|
| `api_module` | string | Lọc theo tên API module, vd: `customerApi` |
| `store` | string | Lọc theo tên Pinia store, vd: `customer` |
| `url_pattern` | string | Lọc theo URL pattern (substring match) |
| `method` | string | Lọc theo HTTP method: `GET`, `POST` |

**Ví dụ:**

```json
{
  "api_module": "domainApi",
  "method": "POST"
}
```

**Kết quả:** Danh sách endpoints mà frontend đang gọi, ai gọi (module/function/file), response fields đang sử dụng, store actions liên quan.

---

### 3. `sync_contract`

So sánh backend routes với frontend API usage — tìm mismatches: endpoint thiếu, route không dùng, method sai.

**Params:**

| Tên | Kiểu | Mô tả |
|-----|------|-------|
| `severity` | `error` \| `warning` \| `info` | Mức độ tối thiểu hiển thị |
| `endpoint_filter` | string | Lọc theo endpoint path (substring match) |
| `mismatches_only` | boolean | Chỉ hiển thị endpoints có mismatch (mặc định: `true`) |

**Ví dụ:**

```json
{
  "severity": "error",
  "mismatches_only": true
}
```

**Kết quả:**

```
summary:
  totalEndpoints: 45
  missingBackend: 45    ← frontend gọi nhưng backend không có route
  missingFrontend: 0    ← backend có route nhưng frontend không gọi

contracts:
  - endpoint, method, hasBackend, hasFrontend
  - mismatches: [{ type, detail, severity }]
  - backendDetails / frontendDetails
```

---

### 4. `generate_client`

Sinh code TypeScript/JavaScript API client từ backend routes. Hỗ trợ 2 style phù hợp với BuilderX SPA.

**Params:**

| Tên | Kiểu | Mô tả |
|-----|------|-------|
| `path_prefix` | string | Sinh client cho routes matching prefix |
| `controller` | string | Sinh client cho controller cụ thể |
| `format` | `typescript` \| `javascript` | Ngôn ngữ output (mặc định: `typescript`) |
| `style` | `class` \| `composable` | `class` extends BaseApi, `composable` sinh `useXxxApi()` (mặc định: `class`) |

**Ví dụ:**

```json
{
  "controller": "Order",
  "format": "typescript",
  "style": "class"
}
```

**Kết quả:** Mảng files sinh ra gồm `api-types.ts` (types) + `xxxApi.ts` (client per controller).

---

### 5. `generate_backend_code`

Sinh boilerplate Phoenix backend theo đúng conventions của BuilderX: Citus sharding, UUID PKs, site_id scoping, FallbackController tuples.

**Params:**

| Tên | Kiểu | Mô tả |
|-----|------|-------|
| `domain` | string | **Bắt buộc.** Tên domain (snake_case), vd: `loyalty_programs` |
| `table_name` | string | Tên bảng DB (mặc định = domain) |
| `fields` | array | **Bắt buộc.** Schema fields: `[{ name, type, default? }]` |
| `actions` | array | Controller actions (mặc định: `["index","show","create","update","delete"]`) |
| `sharded` | boolean | Bảng Citus-sharded theo site_id (mặc định: `true`) |
| `route_scope` | string | Route scope prefix (mặc định: `/dashboard`) |
| `permissions` | array | Site permissions cần thiết, vd: `["view_loyalty","manage_loyalty"]` |

**Ví dụ:**

```json
{
  "domain": "loyalty_programs",
  "fields": [
    { "name": "name", "type": ":string" },
    { "name": "points_per_order", "type": ":integer", "default": "0" },
    { "name": "is_active", "type": ":boolean", "default": "true" },
    { "name": "config", "type": ":map", "default": "%{}" }
  ],
  "sharded": true,
  "permissions": ["view_loyalty", "manage_loyalty"]
}
```

**Kết quả:** 4 files sinh ra + route snippet + hướng dẫn:

| File | Nội dung |
|------|---------|
| `loyalty_program.ex` | Ecto schema + changeset + json/1 |
| `loyalty_programs.ex` | Context module (CRUD với site_id) |
| `loyalty_program_controller.ex` | Controller với permission plugs |
| `create_loyalty_programs.exs` | Ecto migration |
| Route snippet | Đoạn code thêm vào router.ex |

## Parsers

| Parser | Chức năng | Nguồn |
|--------|----------|-------|
| `phoenix-router` | Parse route definitions, scope nesting, pipelines | 8 router files |
| `phoenix-controller` | Extract actions, params, response types, plugs | 106 controllers |
| `phoenix-schema` | Extract Ecto fields, associations, JSON rendering | Schema files |
| `phoenix-context` | Extract public functions, arity, site_id, repo | Context modules |
| `vue-api` | Parse BaseApi class modules + useApi composable calls | 48 API modules |
| `vue-store` | Parse Pinia store actions, API calls, state updates | Store files |
| `diff-engine` | Correlate backend ↔ frontend, fuzzy URL matching | — |

## Cấu trúc thư mục

```
shared_knowledge_mcp/
├── src/
│   ├── index.ts                  # MCP server entry point
│   ├── types.ts                  # Shared TypeScript types
│   ├── parsers/
│   │   ├── phoenix-router.ts     # Parse Phoenix router files
│   │   ├── phoenix-controller.ts # Parse controller actions
│   │   ├── phoenix-schema.ts     # Parse Ecto schemas
│   │   ├── phoenix-context.ts    # Parse context modules
│   │   ├── vue-api.ts            # Parse Vue API modules
│   │   ├── vue-store.ts          # Parse Pinia stores
│   │   └── diff-engine.ts        # Contract diff engine
│   └── tools/
│       ├── get-api-schema.ts
│       ├── get-ui-requirements.ts
│       ├── sync-contract.ts
│       ├── generate-client.ts
│       └── generate-backend-code.ts
├── package.json
├── tsconfig.json
└── .gitignore
```

## Scripts

```bash
npm run build   # Compile TypeScript → dist/
npm start       # Chạy MCP server
npm run dev     # Watch mode (tsc --watch)
```

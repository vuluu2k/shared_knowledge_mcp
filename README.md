# Shared Knowledge MCP

**Cho AI agent một bộ não hiểu toàn bộ codebase của bạn.**

Shared Knowledge MCP kết nối Phoenix backend và Vue 3 frontend thành một lớp context thông minh. Hỏi một câu, nhận câu trả lời đầy đủ — routes, schemas, frontend usage, phân tích ảnh hưởng — chỉ trong một lần gọi. Không cần nhảy qua lại giữa các file. Không tốn token thừa.

---

## Vấn đề

AI agent rất thông minh, nhưng nó bị mù:

```
Bạn:   "Order API hoạt động thế nào?"
Agent: *đọc 15 files* *tốn 25,000 tokens* *vẫn thiếu phía frontend*

Bạn:   "Sửa schema này thì hỏng cái gì?"
Agent: "Để tôi grep thử..." *gọi thêm 10 tools nữa*

Bạn:   "Nhớ cái business rule hôm qua bàn không?"
Agent: "Tôi không nhớ gì từ cuộc trò chuyện trước."
```

## Giải pháp

```
Bạn:   "Order API hoạt động thế nào?"
Agent: *gọi smart_context* → trả lời đầy đủ, 800 tokens, 1 lần gọi

Bạn:   "Sửa schema này thì hỏng cái gì?"
Agent: *gọi analyze_impact* → dependency chain + đánh giá rủi ro

Bạn:   "Nhớ cái business rule hôm qua bàn không?"
Agent: *gọi recall_memory* → lấy ngay từ GitHub
```

---

## Cài đặt nhanh (Khuyên dùng)

Chạy script tự động — tự clone, cài dependencies, build, cấu hình IDE cho bạn.

### macOS / Linux

Nếu đã clone repo:
```bash
./install.sh
```

Hoặc tải về rồi chạy:
```bash
curl -fsSL https://raw.githubusercontent.com/vuluu2k/shared_knowledge_mcp/main/install.sh -o install.sh && bash install.sh
```

Script sẽ hướng dẫn bạn:
1. Cài Node.js (nếu chưa có)
2. Clone MCP server + build TypeScript
3. Nhập đường dẫn repo backend/frontend
4. Nhập cấu hình GitHub memory (owner, repo name, token — **đều có thể bỏ qua**, set sau)
5. Chọn IDE để cấu hình
6. Tạo repo memory private trên GitHub (tự động, hỏi trước khi tạo)

**Gỡ cài đặt:**
```bash
./install.sh --uninstall
```

---

## Cập nhật

Cập nhật lên phiên bản mới nhất:

```bash
# Tự tìm thư mục cài đặt
~/.shared-knowledge-mcp/update.sh
```

Hoặc chỉ định đường dẫn:
```bash
./update.sh ~/.shared-knowledge-mcp
```

Hoặc tải về rồi chạy:
```bash
curl -fsSL https://raw.githubusercontent.com/vuluu2k/shared_knowledge_mcp/main/update.sh | bash
```

---

## Cài đặt thủ công

```bash
git clone https://github.com/vuluu2k/shared_knowledge_mcp.git
cd shared_knowledge_mcp
npm install
npm run build
```

## Biến môi trường

| Biến | Bắt buộc | Mô tả |
|------|----------|-------|
| `BUILDERX_API_PATH` | Không | Đường dẫn repo Phoenix backend (mặc định: `../builderx_api`) |
| `BUILDERX_SPA_PATH` | Không | Đường dẫn repo Vue 3 frontend (mặc định: `../builderx_spa`) |
| `MEMORY_REPO_OWNER` | Không* | GitHub username cho memory repo |
| `MEMORY_REPO_NAME` | Không | Tên repo memory (mặc định: `shared-knowledge-memory`) |
| `MEMORY_REPO_TOKEN` | Không* | GitHub personal access token (quyền `repo`) |
| `MEMORY_REPO_PATH` | Không | Thư mục local clone memory (mặc định: `~/.shared-knowledge-memory`) |
| `MEMORY_SYNC_INTERVAL` | Không | Khoảng cách sync GitHub tính bằng ms (mặc định: `300000` = 5 phút) |

> \* Nếu đã đăng nhập `gh auth login`, không cần set `MEMORY_REPO_OWNER` và `MEMORY_REPO_TOKEN` — tự detect.

---

## Cấu hình theo từng IDE / AI Tool

> Thay `/đường-dẫn-tuyệt-đối/shared_knowledge_mcp/dist/index.js` bằng đường dẫn thực tế.
> Ví dụ: `/Users/username/.shared-knowledge-mcp/dist/index.js`

### 1. Claude Desktop

Mở Settings > Developer > Edit Config, hoặc sửa file trực tiếp:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "shared-knowledge": {
      "command": "node",
      "args": ["/đường-dẫn-tuyệt-đối/shared_knowledge_mcp/dist/index.js"],
      "env": {
        "BUILDERX_API_PATH": "/path/to/builderx_api",
        "BUILDERX_SPA_PATH": "/path/to/builderx_spa",
        "MEMORY_REPO_OWNER": "<github-username>",
        "MEMORY_REPO_NAME": "shared-knowledge-memory"
      }
    }
  }
}
```

Restart Claude Desktop. Các MCP tools sẽ xuất hiện trong chat.

---

### 2. Claude Code (CLI)

Chạy lệnh sau trong terminal:

```bash
claude mcp add shared-knowledge \
  -e BUILDERX_API_PATH=/path/to/builderx_api \
  -e BUILDERX_SPA_PATH=/path/to/builderx_spa \
  -e MEMORY_REPO_OWNER=<github-username> \
  -e MEMORY_REPO_NAME=shared-knowledge-memory \
  -- node /đường-dẫn-tuyệt-đối/shared_knowledge_mcp/dist/index.js
```

Hoặc tạo file `.claude.json` tại thư mục project:

```json
{
  "mcpServers": {
    "shared-knowledge": {
      "command": "node",
      "args": ["/đường-dẫn-tuyệt-đối/shared_knowledge_mcp/dist/index.js"],
      "env": {
        "BUILDERX_API_PATH": "/path/to/builderx_api",
        "BUILDERX_SPA_PATH": "/path/to/builderx_spa",
        "MEMORY_REPO_OWNER": "<github-username>",
        "MEMORY_REPO_NAME": "shared-knowledge-memory"
      }
    }
  }
}
```

Hoặc cấu hình global tại `~/.claude.json` (áp dụng cho mọi project).

Kiểm tra đã cài thành công:
```bash
claude mcp list
```

---

### 3. Cursor

**Bước 1:** Mở Cursor Settings: `Cmd + ,` (Mac) hoặc `Ctrl + ,` (Windows/Linux)

**Bước 2:** Tìm mục **"MCP Servers"** trong sidebar

**Bước 3:** Click **"Add new MCP Server"**

**Bước 4:** Tạo file `.cursor/mcp.json` tại thư mục gốc project:

```json
{
  "mcpServers": {
    "shared-knowledge": {
      "command": "node",
      "args": ["/đường-dẫn-tuyệt-đối/shared_knowledge_mcp/dist/index.js"],
      "env": {
        "BUILDERX_API_PATH": "/path/to/builderx_api",
        "BUILDERX_SPA_PATH": "/path/to/builderx_spa",
        "MEMORY_REPO_OWNER": "<github-username>",
        "MEMORY_REPO_NAME": "shared-knowledge-memory"
      }
    }
  }
}
```

Hoặc cấu hình global tại `~/.cursor/mcp.json`.

**Bước 5:** Restart Cursor. Kiểm tra trong Settings > MCP Servers — sẽ thấy trạng thái **"Connected"** màu xanh.

---

### 4. Windsurf

**Bước 1:** Mở Windsurf Settings: `Cmd + ,` (Mac) hoặc `Ctrl + ,` (Windows/Linux)

**Bước 2:** Tìm mục **"Cascade"** > **"MCP Servers"**

**Bước 3:** Click **"Add Server"** > chọn **"Custom"**

**Bước 4:** Tạo file `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "shared-knowledge": {
      "command": "node",
      "args": ["/đường-dẫn-tuyệt-đối/shared_knowledge_mcp/dist/index.js"],
      "env": {
        "BUILDERX_API_PATH": "/path/to/builderx_api",
        "BUILDERX_SPA_PATH": "/path/to/builderx_spa",
        "MEMORY_REPO_OWNER": "<github-username>",
        "MEMORY_REPO_NAME": "shared-knowledge-memory"
      }
    }
  }
}
```

**Bước 5:** Restart Windsurf. Trong Cascade chat, gõ `@` sẽ thấy các tools.

---

### 5. Augment (VS Code Extension)

**Bước 1:** Cài extension **Augment** từ VS Code Marketplace

**Bước 2:** Mở Command Palette: `Cmd + Shift + P` > tìm **"Augment: Edit MCP Settings"**

**Bước 3:** File settings sẽ mở ra. Thêm cấu hình:

```json
{
  "mcpServers": {
    "shared-knowledge": {
      "command": "node",
      "args": ["/đường-dẫn-tuyệt-đối/shared_knowledge_mcp/dist/index.js"],
      "env": {
        "BUILDERX_API_PATH": "/path/to/builderx_api",
        "BUILDERX_SPA_PATH": "/path/to/builderx_spa",
        "MEMORY_REPO_OWNER": "<github-username>",
        "MEMORY_REPO_NAME": "shared-knowledge-memory"
      }
    }
  }
}
```

**Bước 4:** Restart VS Code. Trong Augment chat panel sẽ thấy các tools MCP.

---

### 6. Codex (OpenAI CLI)

Thêm vào file `~/.codex/config.toml`:

```toml
[mcp_servers.shared-knowledge]
command = "node"
args = ["/đường-dẫn-tuyệt-đối/shared_knowledge_mcp/dist/index.js"]
env = { "BUILDERX_API_PATH" = "/path/to/builderx_api", "BUILDERX_SPA_PATH" = "/path/to/builderx_spa", "MEMORY_REPO_OWNER" = "<github-username>", "MEMORY_REPO_NAME" = "shared-knowledge-memory" }
```

Kiểm tra:
```bash
codex mcp list
```

---

### Kiểm tra MCP hoạt động

Sau khi cấu hình, thử hỏi AI agent:
- "Order API hoạt động thế nào?" → gọi `smart_context`
- "Sửa customer schema thì hỏng gì?" → gọi `analyze_impact`
- "Lưu lại: discount tối đa 30%" → gọi `save_memory`

Nếu AI agent trả lời được với dữ liệu từ cả backend + frontend → cài đặt thành công.

---

## Memory: lưu trữ + cache thông minh

### Tự tạo repo GitHub

Khi AI agent gọi `save_memory` lần đầu tiên, MCP server sẽ **tự động**:

1. Tạo repo **private** trên GitHub với tên `MEMORY_REPO_NAME` (mặc định: `shared-knowledge-memory`)
2. Clone về máy tại `~/.shared-knowledge-memory`
3. Tạo cấu trúc thư mục `memories/{business, tasks, analysis, decisions}/`
4. Commit + push lên GitHub

**Không cần tạo repo trước.** Chỉ cần GitHub account đã đăng nhập (`gh auth login`) hoặc cung cấp token.

### Client-side cache

Memory data được cache in-memory để tối ưu cho AI agent đọc:

```
Lần đầu gọi bất kỳ memory tool:
  → ensureRepo() → git clone/pull → loadFromDisk() → cache in-memory
  
Các lần sau (trong 5 phút):
  → ensureRepo() → cache hit, SKIP git pull → lookup từ Map (O(1))
  
Khi save/delete:
  → ghi file → update cache ngay → commit + push async
  
Sau 5 phút (configurable):
  → ensureRepo() → git pull → loadFromDisk() chỉ re-parse file có mtime mới
```

| Tối ưu | Chi tiết |
|--------|----------|
| **Git sync** | Chỉ pull mỗi 5 phút thay vì mỗi lần gọi tool |
| **In-memory index** | Title + tags + snippet (~200 chars) cached trong Map |
| **Lazy content** | Full content chỉ load khi mode=`full`, mặc định trả snippet |
| **Scored search** | Title match (3 điểm) > tag (2) > snippet (1), kết quả relevance tốt hơn |
| **Mtime detection** | Chỉ re-parse file khi mtime thay đổi |
| **Token savings** | Mode `compact` tiết kiệm 70-90% tokens so với `full` |

### 3 cách xác thực GitHub

| Cách | Cấu hình | Khi nào dùng |
|------|----------|-------------|
| **gh CLI** (khuyên dùng) | Chạy `gh auth login` trước | Máy cá nhân, đã cài gh |
| **Token** | Set `MEMORY_REPO_TOKEN=ghp_xxx` | CI/CD, server, nhiều máy |
| **Cả hai** | Set cả `MEMORY_REPO_OWNER` + `MEMORY_REPO_TOKEN` | Dùng account khác với gh CLI |

**Lưu ý:** Nếu dùng token, cần quyền `repo` (full control of private repositories).

### Cấu trúc repo memory trên GitHub

```
shared-knowledge-memory/          ← repo private, tự tạo
├── README.md
└── memories/
    ├── business/                  ← nghiệp vụ, domain rules
    │   ├── order-discount-rules.md
    │   └── customer-loyalty-flow.md
    ├── tasks/                     ← lịch sử task đã làm
    │   └── add-loyalty-points.md
    ├── analysis/                  ← kết quả phân tích API (cache)
    │   └── order-api-snapshot.md
    └── decisions/                 ← quyết định kiến trúc
        └── use-citus-sharding.md
```

Mỗi file memory có frontmatter:

```markdown
---
title: "Order discount rules"
category: business
tags: ["order", "discount", "business-rule"]
created_at: 2026-03-20T07:08:46.673Z
updated_at: 2026-03-20T10:15:30.123Z
---

Discount tối đa 30%. Không kết hợp với loyalty points.
VIP customers được thêm 5%.
```

---

## 14 Tools

### Lớp thông minh (dùng trước)

#### `smart_context` — Một câu hỏi, một câu trả lời đầy đủ

Hỏi bằng ngôn ngữ tự nhiên. Tool tự phân loại câu hỏi, **selective load chỉ data liên quan**, trả về cross-project entity view gọn.

```
smart_context("Order API hoạt động thế nào?")
```

Trả về:
- **Cross-Project Flow** — entity-centric chain: `Schema → Context → Controller → Route ↔ API → Store → Component`
- **Cross-Project Links** — explicit route↔frontend endpoint links với confidence %
- **Gaps** — frontend calls không có backend route và ngược lại
- Per-layer detail: routes, schemas, controllers, frontend calls, stores
- Dependencies + Risks

**Selective loading**: chỉ load data liên quan tới keyword. Ví dụ `"order"` → load 10 routes thay vì 200+.

| Param | Mô tả |
|-------|-------|
| `question` | Câu hỏi bất kỳ về codebase |
| `depth` | `"brief"` (mặc định, gọn) hoặc `"detailed"` (chi tiết) |

---

#### `analyze_impact` — Biết cái gì hỏng trước khi sửa

Trace toàn bộ dependency chain xuyên suốt 2 repos qua **cross-project entity linker**. Sửa backend schema? Xem ngay frontend component nào bị ảnh hưởng.

```
analyze_impact("lib/builderx_api/orders/order.ex")
```

Trả về:
```
Cross-Project Chains:
  order: Schema(orders) → Context(Orders) → Controller(OrderController.index)
         → Route(GET /api/v1/dashboard/orders) → API(orderApi.getAll)
         → Store(useOrderStore) → Component(OrderList, OrderDetail)

Risk Level: HIGH — 15 frontend artifacts affected
```

**3-pass URL matching**: exact → param-normalized → fuzzy, thay thế pathOverlap cũ (không chính xác).

| Param | Mô tả |
|-------|-------|
| `target` | Đường dẫn file hoặc tên hàm |
| `repo` | `"backend"`, `"frontend"`, hoặc `"auto"` |
| `direction` | `"both"`, `"dependents"`, hoặc `"dependencies"` |
| `depth` | Độ sâu trace 1-5 (mặc định: 3) |

---

#### `suggest_plan` — Lập kế hoạch implementation

Nhận mô tả task → tự check memory (business rules) + phân tích code hiện tại + trace impact → trả về plan chi tiết.

```
suggest_plan("Thêm tính năng giảm giá cho order")
```

Trả về:
1. **Business rules** đã lưu từ memory (nếu có)
2. **Code hiện tại** liên quan (schemas, routes, controllers, frontend)
3. **Cross-project entities** — entity map + gaps
4. **Đề xuất thực hiện** theo loại action (add/modify/fix/remove/refactor/integrate)
5. **Đánh giá ảnh hưởng** với cross-project link summary
6. **Checklist** bao gồm cross-project items

| Param | Mô tả |
|-------|-------|
| `task` | Mô tả task (tiếng Việt hoặc tiếng Anh) |
| `depth` | `"brief"` (mặc định) hoặc `"detailed"` |

---

### Phân tích code

#### `get_api_schema` — Bản đồ toàn bộ backend API

Parse tất cả Phoenix routes, controllers, params, response types, Ecto schemas.

```json
{ "controller": "Customer", "include_schemas": true }
```

#### `get_ui_requirements` — Frontend đang gọi gì

Parse tất cả Vue API modules, composable fetch, Pinia store actions.

```json
{ "url_pattern": "/customer", "method": "POST" }
```

#### `sync_contract` — Tìm chỗ backend/frontend không khớp

So sánh routes vs API usage. Tìm endpoint thiếu, method sai, route không ai gọi.

```json
{ "severity": "error", "mismatches_only": true }
```

#### `search_code` — Tìm kiếm code xuyên 2 repos

Hỗ trợ regex, tự bỏ qua node_modules, _build, deps.

```json
{ "query": "def create_order", "repo": "backend", "file_pattern": "*.ex" }
```

#### `read_source` — Đọc file source với số dòng

Đọc đúng đoạn code cần thiết, hỗ trợ chọn khoảng dòng.

```json
{ "repo": "backend", "file_path": "lib/builderx_api/orders/orders.ex", "start_line": 45, "num_lines": 20 }
```

---

### Sinh code

#### `generate_backend_code` — Scaffold Phoenix modules

Sinh schema + context + controller + migration + route snippet. Đúng conventions dự án: Citus sharding, UUID PKs, site_id scoping, permission plugs.

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

Sinh TypeScript/JavaScript API client từ backend routes. Hỗ trợ class-based (BaseApi) hoặc Vue composable.

```json
{ "controller": "Order", "format": "typescript", "style": "composable" }
```

---

### Bộ nhớ dài hạn (GitHub + client cache)

AI agent nhớ xuyên suốt các cuộc trò chuyện. Nghiệp vụ, lịch sử task, quyết định kiến trúc — lưu dưới dạng markdown trong private GitHub repo, cache in-memory cho truy vấn nhanh.

#### `save_memory` — Lưu kiến thức

```json
{
  "category": "business",
  "title": "Quy tắc giảm giá đơn hàng",
  "content": "Giảm tối đa 30%. Không kết hợp loyalty points. VIP được thêm 5%.",
  "tags": ["order", "discount"]
}
```

#### `recall_memory` — Tìm kiến thức đã lưu

```json
{ "query": "giảm giá", "category": "business", "mode": "compact" }
```

| mode | Trả về | Token |
|------|--------|-------|
| `compact` (mặc định) | Snippet ~200 chars | Tiết kiệm 70-90% |
| `full` | Toàn bộ content | Đầy đủ chi tiết |

#### `list_memories` — Xem tất cả kiến thức

```json
{ "category": "decisions" }
```

#### `delete_memory` — Xóa kiến thức cũ

```json
{ "category": "business", "id": "old-discount-rules" }
```

**4 loại memory:**

| Loại | Lưu gì |
|------|--------|
| `business` | Nghiệp vụ, quy tắc domain, validation logic |
| `tasks` | Lịch sử task, đã làm gì, kết quả |
| `analysis` | Ảnh chụp phân tích API, cache kết quả |
| `decisions` | Quyết định kiến trúc, lý do chọn công nghệ |

---

## Cách hoạt động

### Kiến trúc

```
                    +-----------------+
                    |    AI Agent     |
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
          +--------+---------+----------+
          |        |                    |
   +------+------+ |  +---------+------+-------+
   | Selective   | |  |         |              |
   | Loader      | |  |  Cross-Project         |
   | (chain      | |  |  Entity Linker         |
   |  filter)    | |  |  (route↔FE links)      |
   +------+------+ |  +---------+--------------+
          |        |            |
   +------+--------+-----------+--------+
   |               |                    |
+--+----------+ +--+----------+ +-------+------+
| Phoenix     | | Vue 3       | | GitHub       |
| Backend     | | Frontend    | | Memory Repo  |
| (routes,    | | (API calls, | | + client     |
|  schemas,   | |  stores,    | |   cache      |
|  contexts)  | |  components)| | (in-memory)  |
+-------------+ +-------------+ +--------------+
```

### Selective loading (chain-based filtering)

Thay vì load tất cả data rồi filter cuối cùng, system chain-filter theo dependency graph:

```
keywords=["order"]
  → Step 1: Routes (cached) → filter by "order"           → 10/200 routes
  → Step 2: Controllers → filter by matched routes         → 5/200 controllers
  → Step 3: Discover domains from routes                   → ["order", "orders"]
  → Step 4: Frontend calls → filter by keyword + route URL → 8/100 calls
  → Step 5: Schemas → filter by expanded keywords          → 2/50 schemas
  → Step 6: Contexts → filter by expanded keywords         → 12/300 contexts
  → Step 7: Stores → filter by keyword + FE module names   → 3/50 stores
  → Step 8: Components → filter by store imports           → 10/200 components
```

Output header hiển thị stats:
```
Scoped: routes:10/200 | ctrl:5/200 | schema:2/50 | ctx:12/300 | fe:8/100 | store:3/50 | comp:10/200
```

Giảm **~90% data** truyền vào processing khi có keyword cụ thể.

### Cross-project entity linker

Xây dựng unified entity map liên kết tất cả layers:

```
Entity "order":
  Backend:  Schema(orders) → Context(Orders) → Controller(OrderController) → Route(12)
  Frontend: API(orderApi) → Store(useOrderStore) → Component(OrderList, OrderDetail, ...)
  Links:    GET /api/v1/dashboard/orders ↔ orderApi.getAll (confidence: 100%)
  Gaps:     DELETE /api/v1/dashboard/orders/:id has no frontend caller
```

**3-pass URL matching:**
1. **Exact** — method + normalized path hoàn toàn khớp (confidence: 100%)
2. **Param-normalized** — bỏ qua tên param, so segments (confidence: 80%)
3. **Fuzzy** — ≥60% static segments khớp (confidence: 50%)

### File-hash cache (mtime + md5)

Tất cả parsers được bọc bởi file-hash cache. Lần đầu parse từ disk. Các lần sau trả kết quả trong **<5ms** nếu file chưa thay đổi.

```
Lần 1:  parse 8 file router → 200ms → lưu cache
Lần 2:  check mtime → chưa đổi → trả cache → <5ms
Có sửa: check mtime → đã đổi → hash md5 → parse lại → cập nhật cache
```

### Token tiết kiệm được

| Tình huống | Không có MCP | Có MCP | Tiết kiệm |
|------------|-------------|--------|-----------|
| "Order API hoạt động thế nào?" | ~25,000 tokens | ~800 tokens | **97%** |
| "Sửa cái này hỏng gì?" | ~10,000 tokens | ~500 tokens | **95%** |
| "Nhớ business rule hôm qua?" | Không thể | ~200 tokens | -- |
| Hỏi lại câu cũ | Tốn như lần đầu | <5ms từ cache | **99%** |

---

## Ví dụ thực tế

**Task: "Thêm loyalty points cho customer, tích điểm khi tạo order"**

```
Bước 1: smart_context("customer và order")
        → Selective load chỉ data liên quan
        → Cross-project entities: customer (8 links), order (12 links)
        → Entity flow + gaps + dependencies

Bước 2: analyze_impact("customer")
        → Cross-project chain: Schema → Controller → Route ↔ API → Store → Component
        → Risk: HIGH — 15 artifacts affected

Bước 3: suggest_plan("Thêm loyalty points cho customer")
        → Business rules từ memory
        → Code hiện tại (scoped) + entity map
        → Plan + checklist + impact

Bước 4: recall_memory("loyalty", mode: "compact")
        → Snippet 200 chars, tiết kiệm token

Bước 5: generate_backend_code(domain: "loyalty_points", ...)
        → Sinh schema + context + controller + migration

Bước 6: generate_client(controller: "LoyaltyPoint")
        → Sinh frontend API client

Bước 7: save_memory(title: "Loyalty points flow", ...)
        → Lưu vào cache ngay + push async lên GitHub

Tổng: 7 lần gọi, ~2,000 tokens
Không có MCP: 20+ file reads, ~25,000 tokens
```

---

## Cấu trúc dự án

```
shared_knowledge_mcp/
├── src/
│   ├── index.ts                       # MCP server (14 tools)
│   ├── types.ts                       # TypeScript types
│   ├── cache/
│   │   ├── file-hash-cache.ts         # Engine cache mtime + md5
│   │   ├── cached-parsers.ts          # Cached wrappers cho parsers
│   │   ├── memory-cache.ts            # In-memory cache cho memory (GitHub)
│   │   └── selective-loader.ts        # Chain-based selective loading
│   ├── parsers/
│   │   ├── phoenix-router.ts          # Parse Phoenix routes
│   │   ├── phoenix-controller.ts      # Parse controller actions
│   │   ├── phoenix-schema.ts          # Parse Ecto schemas
│   │   ├── phoenix-context.ts         # Parse context modules
│   │   ├── vue-api.ts                 # Parse Vue API modules
│   │   ├── vue-store.ts              # Parse Pinia stores
│   │   ├── vue-component-imports.ts   # Parse component imports
│   │   └── diff-engine.ts            # Diff backend/frontend contracts
│   └── tools/
│       ├── smart-context.ts           # Context thông minh (selective + entity)
│       ├── analyze-impact.ts          # Phân tích ảnh hưởng (entity linker)
│       ├── suggest-plan.ts            # Lập kế hoạch implementation
│       ├── cross-project-linker.ts    # Entity map + route↔FE linking
│       ├── compress.ts                # Token-optimized output formatters
│       ├── get-api-schema.ts          # Trích xuất API schema
│       ├── get-ui-requirements.ts     # Trích xuất frontend usage
│       ├── sync-contract.ts           # Tìm mismatch
│       ├── generate-client.ts         # Sinh frontend API client
│       ├── generate-backend-code.ts   # Sinh Phoenix boilerplate
│       ├── memory.ts                  # Bộ nhớ GitHub + client cache
│       └── codebase.ts               # Tìm kiếm + đọc code
├── package.json
├── tsconfig.json
└── .gitignore
```

## Lệnh

```bash
npm install     # Cài dependencies
npm run build   # Compile TypeScript → dist/
npm start       # Chạy MCP server
npm run dev     # Watch mode (tự build khi sửa code)
```

---

**Đừng bắt AI agent đọc từng file một. Cho nó toàn bộ bức tranh trong một lần gọi.**

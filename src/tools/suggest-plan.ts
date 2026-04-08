import {
  cachedPhoenixRoutes,
  cachedPhoenixControllers,
  cachedPhoenixSchemas,
  cachedPhoenixContexts,
  cachedVueApiModules,
  cachedVueStores,
} from "../cache/cached-parsers.js";
import { cachedParse } from "../cache/file-hash-cache.js";
import { parseVueComponentImports } from "../parsers/vue-component-imports.js";
import { recallMemory } from "./memory.js";
import {
  compressSchemas,
  compressRoutes,
  compressControllers,
  compressFrontend,
  compressStores,
  compressContexts,
  compressImpact,
  compressCrossProjectEntities,
  compressCrossProjectGaps,
  extractTaskWords,
} from "./compress.js";
import {
  buildEntityMap,
} from "./cross-project-linker.js";
import type { RepoConfig } from "../types.js";

export interface SuggestPlanArgs {
  task: string;
  depth?: "brief" | "detailed";
}

// ── Keyword extraction ──

const DOMAIN_KEYWORDS = [
  "order", "customer", "product", "article", "blog", "site", "account",
  "organization", "payment", "shipping", "inventory", "category", "discount",
  "promotion", "coupon", "variation", "image", "page", "domain", "template",
  "notification", "webhook", "tiktok", "shopee", "lazada", "zalo", "mini_app",
  "affiliate", "loyalty", "reward", "invoice", "subscription", "pos",
  "email", "sms", "form", "landing", "cms", "seo", "combo", "flash",
  "voucher", "membership", "review", "comment", "tag", "collection",
];

// Action keywords to detect task type
const ACTION_KEYWORDS: { action: string; patterns: RegExp[] }[] = [
  { action: "add_feature", patterns: [/thêm/i, /tạo mới/i, /add/i, /create/i, /implement/i, /build/i, /xây/i, /new/i] },
  { action: "modify", patterns: [/sửa/i, /thay đổi/i, /update/i, /change/i, /modify/i, /edit/i, /cập nhật/i, /chỉnh/i] },
  { action: "fix_bug", patterns: [/fix/i, /bug/i, /lỗi/i, /sai/i, /hỏng/i, /broken/i, /error/i, /issue/i] },
  { action: "remove", patterns: [/xóa/i, /remove/i, /delete/i, /bỏ/i, /gỡ/i, /loại/i] },
  { action: "refactor", patterns: [/refactor/i, /tối ưu/i, /optimize/i, /clean/i, /restructure/i] },
  { action: "integrate", patterns: [/tích hợp/i, /integrate/i, /connect/i, /kết nối/i, /sync/i, /đồng bộ/i] },
];

function extractKeywords(task: string): string[] {
  const lower = task.toLowerCase();
  return DOMAIN_KEYWORDS.filter((kw) => lower.includes(kw));
}

function detectAction(task: string): string {
  for (const { action, patterns } of ACTION_KEYWORDS) {
    if (patterns.some((p) => p.test(task))) return action;
  }
  return "add_feature";
}

// ── Main ──

export async function suggestPlan(config: RepoConfig, args: SuggestPlanArgs) {
  const keywords = extractKeywords(args.task);
  const action = detectAction(args.task);
  const detailed = args.depth === "detailed";
  const sections: string[] = [];

  // Load everything in parallel
  const [routes, controllers, schemas, contexts, feUsages, stores, components] =
    await Promise.all([
      cachedPhoenixRoutes(config.backendPath),
      cachedPhoenixControllers(config.backendPath),
      cachedPhoenixSchemas(config.backendPath),
      cachedPhoenixContexts(config.backendPath),
      cachedVueApiModules(config.frontendPath),
      cachedVueStores(config.frontendPath),
      (async () => {
        const { data } = await cachedParse(
          "src/{views,components}/**/*.vue",
          config.frontendPath,
          () => parseVueComponentImports(config.frontendPath)
        );
        return data;
      })(),
    ]);

  const kwFilter = (text: string) =>
    keywords.length === 0 || keywords.some((kw) => text.toLowerCase().includes(kw));

  // Build cross-project entity map
  const entities = buildEntityMap(
    routes, controllers, schemas, contexts, feUsages, stores, components,
    keywords.length > 0 ? keywords : undefined
  );

  sections.push(`## Plan gợi ý: "${args.task}"`);
  sections.push(`_Action: ${action} | Keywords: ${keywords.join(", ") || "(general)"} | Entities: ${entities.length}_\n`);

  // ── 1. Business rules từ memory ──
  sections.push(`### 1. Business rules đã lưu (từ memory)`);

  const allMemories: { title: string; content: string; category: string; tags: string[] }[] = [];
  for (const kw of keywords.slice(0, 3)) {
    try {
      const mem = await recallMemory({ query: kw, limit: 5 });
      for (const r of mem.results) {
        if (!allMemories.some((m) => m.title === r.title)) {
          allMemories.push(r);
        }
      }
    } catch { /* no memory */ }
  }

  // Also search with full task description
  try {
    const taskWords = args.task.split(/\s+/).filter((w) => w.length > 3).slice(0, 3);
    for (const word of taskWords) {
      const mem = await recallMemory({ query: word, limit: 3 });
      for (const r of mem.results) {
        if (!allMemories.some((m) => m.title === r.title)) {
          allMemories.push(r);
        }
      }
    }
  } catch { /* no memory */ }

  if (allMemories.length > 0) {
    for (const m of allMemories) {
      sections.push(`- **${m.title}** [${m.category}]`);
      const contentPreview = m.content.length > 200 ? m.content.slice(0, 200) + "..." : m.content;
      sections.push(`  ${contentPreview}`);
    }
    sections.push("");
    sections.push(`> Lưu ý: Plan phải tuân thủ các business rules trên.`);
  } else {
    sections.push(`_Chưa có memory liên quan. Sau khi hoàn thành task, dùng save_memory để lưu lại._`);
  }
  sections.push("");

  // ── 2. Code hiện tại liên quan ──
  sections.push(`### 2. Code hiện tại liên quan`);

  // Backend routes
  const relatedRoutes = routes.filter(
    (r) => kwFilter(r.path) || kwFilter(r.controller) || kwFilter(r.action)
  );
  // Backend controllers
  const relatedControllers = controllers.filter(
    (a) => kwFilter(a.controller) || kwFilter(a.action)
  );
  // Schemas
  const relatedSchemas = schemas.filter(
    (s) => kwFilter(s.module) || kwFilter(s.tableName)
  );
  // Context functions
  const relatedContexts = contexts.filter(
    (c) => kwFilter(c.module) || kwFilter(c.name)
  );
  // Frontend
  const relatedFeUsages = feUsages.filter(
    (u) => kwFilter(u.module) || kwFilter(u.urlPattern) || kwFilter(u.functionName)
  );
  const relatedStores = stores.filter(
    (s) => kwFilter(s.store) || kwFilter(s.action) || s.apiCalls.some((c) => kwFilter(c.apiModule))
  );

  // Relevance-scored compressed output
  const taskWords = extractTaskWords(args.task);

  const schemaBlock = compressSchemas(relatedSchemas, keywords, taskWords);
  if (schemaBlock) sections.push("\n" + schemaBlock);

  const routeBlock = compressRoutes(relatedRoutes, keywords);
  if (routeBlock) sections.push("\n" + routeBlock);

  const ctrlBlock = compressControllers(relatedControllers, keywords);
  if (ctrlBlock) sections.push("\n" + ctrlBlock);

  const feBlock = compressFrontend(relatedFeUsages, keywords);
  if (feBlock) sections.push("\n" + feBlock);

  const storeBlock = compressStores(relatedStores, keywords);
  if (storeBlock) sections.push("\n" + storeBlock);

  // Cross-project entity view
  if (entities.length > 0) {
    const entityBlock = compressCrossProjectEntities(entities, keywords, detailed ? 5 : 3);
    if (entityBlock) sections.push("\n" + entityBlock);

    const gapBlock = compressCrossProjectGaps(entities);
    if (gapBlock) sections.push("\n" + gapBlock);
  }

  sections.push("");

  // ── 3. Plan theo loại action ──
  sections.push(`### 3. Đề xuất thực hiện`);

  if (action === "add_feature") {
    sections.push(generateAddFeaturePlan(keywords, relatedSchemas, relatedRoutes, relatedControllers, relatedFeUsages, detailed));
  } else if (action === "modify") {
    sections.push(generateModifyPlan(keywords, relatedSchemas, relatedRoutes, relatedControllers, relatedFeUsages, detailed));
  } else if (action === "fix_bug") {
    sections.push(generateFixBugPlan(keywords, relatedSchemas, relatedRoutes, relatedFeUsages, detailed));
  } else if (action === "remove") {
    sections.push(generateRemovePlan(keywords, relatedRoutes, relatedControllers, relatedFeUsages, detailed));
  } else if (action === "refactor") {
    sections.push(generateRefactorPlan(keywords, relatedSchemas, relatedControllers, relatedContexts, detailed));
  } else if (action === "integrate") {
    sections.push(generateIntegratePlan(keywords, relatedSchemas, relatedRoutes, detailed));
  }
  sections.push("");

  // ── 4. Impact analysis (enhanced with cross-project entities) ──
  sections.push(`### 4. Đánh giá ảnh hưởng`);

  // Use entity data for accurate impact
  const entityComponents = entities.flatMap((e) => e.frontend.components);
  const uniqueEntityComponents = [...new Map(entityComponents.map((c) => [c.filePath, c])).values()];

  // Fallback: also check via store names for components not in entities
  const storeNames = [...new Set(relatedStores.map((s) => s.store.toLowerCase()))];
  const storeComponents = components.filter((c) =>
    c.storeImports.some((si) => storeNames.some((sn) => si.toLowerCase().includes(sn)))
  );
  // Merge and deduplicate
  const allAffectedComponents = [...new Map(
    [...uniqueEntityComponents, ...storeComponents].map((c) => [c.filePath, c])
  ).values()];

  sections.push(compressImpact(
    relatedRoutes.length,
    relatedSchemas.length,
    relatedFeUsages.length,
    allAffectedComponents
  ));

  // Cross-project link summary
  const totalLinks = entities.reduce((s, e) => s + e.links.length, 0);
  const totalGaps = entities.reduce((s, e) => s + e.gaps.filter((g) => g.severity === "error").length, 0);
  if (totalLinks > 0 || totalGaps > 0) {
    sections.push(`Cross-project: ${totalLinks} linked endpoint(s), ${totalGaps} gap(s)`);
  }
  sections.push("");

  // ── 5. Checklist ──
  sections.push(`### 5. Checklist`);
  const entityGapCount = entities.reduce((s, e) => s + e.gaps.filter((g) => g.severity === "error").length, 0);
  sections.push(generateChecklist(action, keywords, relatedSchemas, allMemories, entities.length, entityGapCount));

  return sections.join("\n");
}

// ── Plan generators by action type ──

function generateAddFeaturePlan(
  keywords: string[],
  schemas: any[], routes: any[], controllers: any[], feUsages: any[],
  detailed: boolean
): string {
  const domain = keywords[0] || "new_feature";
  const lines: string[] = [];

  lines.push(`\n**Backend (tạo mới):**`);
  lines.push(`1. Tạo schema: \`lib/builderx_api/${domain}s/${domain}.ex\``);
  lines.push(`   - Dùng \`generate_backend_code\` để scaffold`);
  lines.push(`   - Nhớ: \`@primary_key {:id, :binary_id, autogenerate: true}\``);
  lines.push(`   - Nhớ: \`belongs_to :site\` nếu sharded`);
  lines.push(`2. Tạo context: \`lib/builderx_api/${domain}s/${domain}s.ex\``);
  lines.push(`   - Tất cả hàm phải nhận \`site_id\` làm param đầu tiên`);
  lines.push(`3. Tạo controller: \`lib/builderx_api_web/controllers/v1/${domain}s/${domain}_controller.ex\``);
  lines.push(`   - Response tuples: \`{:success, :with_data, "${domain}", data}\``);
  lines.push(`   - Thêm permission plugs nếu cần`);
  lines.push(`4. Tạo migration + chạy: \`mix ecto.migrate\``);
  lines.push(`5. Thêm routes vào \`lib/builderx_api_web/router/router.ex\``);

  if (schemas.length > 0) {
    lines.push(`\n**Backend (sửa code hiện tại):**`);
    for (const s of schemas.slice(0, 3)) {
      lines.push(`- Có thể cần thêm field/association vào \`${s.tableName}\` schema`);
    }
  }

  lines.push(`\n**Frontend:**`);
  lines.push(`1. Tạo API module: \`src/api/${domain}Api.js\` (extends BaseApi)`);
  lines.push(`   - Dùng \`generate_client\` để scaffold`);
  lines.push(`2. Tạo Pinia store: \`src/stores/dashboard/${domain}.js\``);
  lines.push(`3. Tạo/sửa Vue components`);

  return lines.join("\n");
}

function generateModifyPlan(
  keywords: string[],
  schemas: any[], routes: any[], controllers: any[], feUsages: any[],
  detailed: boolean
): string {
  const lines: string[] = [];

  lines.push(`\n**Backend (sửa):**`);
  if (schemas.length > 0) {
    for (const s of schemas.slice(0, 3)) {
      lines.push(`1. Schema: \`${s.filePath || s.tableName}\``);
      lines.push(`   - Sửa changeset nếu thêm/đổi field`);
      lines.push(`   - Tạo migration nếu thay đổi database`);
    }
  }
  if (controllers.length > 0) {
    lines.push(`2. Controller actions cần sửa:`);
    for (const a of controllers.slice(0, 5)) {
      lines.push(`   - ${a.controller}.${a.action} (${a.filePath}:${a.lineNumber})`);
    }
  }

  lines.push(`\n**Frontend (sửa):**`);
  if (feUsages.length > 0) {
    lines.push(`- API modules cần update:`);
    const modules = [...new Set(feUsages.map((u: any) => u.module))];
    for (const mod of modules.slice(0, 5)) {
      lines.push(`  - ${mod}`);
    }
  }

  lines.push(`\n**Quan trọng:** Chạy \`sync_contract\` sau khi sửa để kiểm tra không có mismatch.`);

  return lines.join("\n");
}

function generateFixBugPlan(
  keywords: string[],
  schemas: any[], routes: any[], feUsages: any[],
  detailed: boolean
): string {
  const lines: string[] = [];

  lines.push(`\n**Debug steps:**`);
  lines.push(`1. Dùng \`search_code\` tìm code liên quan đến bug`);
  lines.push(`2. Dùng \`read_source\` đọc code cụ thể`);
  lines.push(`3. Dùng \`analyze_impact\` kiểm tra fix có ảnh hưởng chỗ khác không`);

  if (schemas.length > 0) {
    lines.push(`\n**Schemas cần kiểm tra:**`);
    for (const s of schemas.slice(0, 3)) {
      lines.push(`- \`${s.tableName}\`: changeset validations, unique constraints`);
    }
  }

  if (routes.length > 0) {
    lines.push(`\n**Endpoints cần kiểm tra:**`);
    for (const r of routes.slice(0, 5)) {
      lines.push(`- ${r.method} ${r.path}`);
    }
  }

  lines.push(`\n**Sau khi fix:** Lưu nguyên nhân + cách fix vào memory (category: tasks)`);

  return lines.join("\n");
}

function generateRemovePlan(
  keywords: string[],
  routes: any[], controllers: any[], feUsages: any[],
  detailed: boolean
): string {
  const lines: string[] = [];

  lines.push(`\n**Trước khi xóa:**`);
  lines.push(`1. Chạy \`analyze_impact\` để biết chính xác cái gì phụ thuộc`);
  lines.push(`2. Kiểm tra không có code nào khác gọi tới`);

  lines.push(`\n**Backend:**`);
  lines.push(`- Xóa routes khỏi router.ex`);
  lines.push(`- Xóa controller actions`);
  lines.push(`- Xóa context functions (nếu không ai dùng)`);
  lines.push(`- Tạo migration xóa table/columns (nếu cần)`);

  lines.push(`\n**Frontend:**`);
  lines.push(`- Xóa API module methods`);
  lines.push(`- Xóa store actions`);
  lines.push(`- Sửa components (remove UI liên quan)`);

  lines.push(`\n**Quan trọng:** Xóa từng bước, chạy \`sync_contract\` sau mỗi bước.`);

  return lines.join("\n");
}

function generateRefactorPlan(
  keywords: string[],
  schemas: any[], controllers: any[], contexts: any[],
  detailed: boolean
): string {
  const lines: string[] = [];

  lines.push(`\n**Trước khi refactor:**`);
  lines.push(`1. Chạy \`analyze_impact\` trên mỗi file cần sửa`);
  lines.push(`2. Lưu snapshot trạng thái hiện tại vào memory (category: analysis)`);

  if (controllers.length > 0) {
    lines.push(`\n**Controllers cần refactor:** ${controllers.length}`);
    for (const a of controllers.slice(0, 5)) {
      lines.push(`- ${a.controller}.${a.action}: response type = ${a.responseType}`);
    }
  }

  lines.push(`\n**Quy tắc BuilderX:**`);
  lines.push(`- Controllers phải thin — logic vào context/service`);
  lines.push(`- Dùng \`Ecto.Multi\` cho atomic operations`);
  lines.push(`- Dùng \`with\` cho multi-step operations`);
  lines.push(`- Tất cả queries phải có \`site_id\` trong WHERE`);

  return lines.join("\n");
}

function generateIntegratePlan(
  keywords: string[],
  schemas: any[], routes: any[],
  detailed: boolean
): string {
  const domain = keywords[0] || "external_service";
  const lines: string[] = [];

  lines.push(`\n**Service module:**`);
  lines.push(`- Tạo: \`lib/builderx_api_web/services/${domain}_service.ex\``);
  lines.push(`- Stateless, tất cả input qua function arguments`);
  lines.push(`- HTTP calls phải có timeout + error handling`);

  lines.push(`\n**Pattern theo BuilderX:**`);
  lines.push("```elixir");
  lines.push(`case HTTPoison.post(url, body, headers, timeout: 10_000, recv_timeout: 10_000) do`);
  lines.push(`  {:ok, %{status_code: 200, body: body}} -> {:ok, Jason.decode!(body)}`);
  lines.push(`  {:ok, %{status_code: status}} -> {:error, "HTTP \#{status}"}`);
  lines.push(`  {:error, %HTTPoison.Error{reason: reason}} -> {:error, reason}`);
  lines.push(`end`);
  lines.push("```");

  lines.push(`\n**Webhook (nếu cần):**`);
  lines.push(`- Thêm route trong \`payment_router_v1.ex\` hoặc router.ex`);
  lines.push(`- Controller nhận webhook → validate → publish event qua RabbitMQ/Kafka`);
  lines.push(`- Consumer xử lý idempotent (Rule 30)`);

  return lines.join("\n");
}

// ── Checklist generator ──

function generateChecklist(
  action: string, keywords: string[],
  schemas: any[], memories: any[],
  entityCount?: number, gapCount?: number
): string {
  const items: string[] = [];

  // Common items
  items.push(`- [ ] Đọc business rules từ memory trước khi code`);

  if (action === "add_feature") {
    items.push(`- [ ] Tạo migration với \`site_id\` distribution column (Citus)`);
    items.push(`- [ ] Schema có UUID primary key`);
    items.push(`- [ ] Context functions nhận \`site_id\` làm param đầu`);
    items.push(`- [ ] Controller dùng response tuples chuẩn`);
    items.push(`- [ ] Thêm permission plugs nếu cần`);
    items.push(`- [ ] Tạo frontend API module + store`);
  }

  if (action === "modify" || action === "fix_bug") {
    items.push(`- [ ] Chạy \`analyze_impact\` trước khi sửa`);
    items.push(`- [ ] Kiểm tra không break frontend`);
  }

  if (action === "remove") {
    items.push(`- [ ] Xác nhận không có code nào phụ thuộc`);
    items.push(`- [ ] Tạo migration xóa table/columns`);
  }

  // Cross-project items
  if (entityCount && entityCount > 0) {
    items.push(`- [ ] Kiểm tra cross-project links (${entityCount} entity liên quan)`);
    items.push(`- [ ] Update cả backend + frontend trong cùng PR nếu thay đổi API contract`);
  }
  if (gapCount && gapCount > 0) {
    items.push(`- [ ] Fix ${gapCount} cross-project gap(s) trước khi deploy`);
  }

  // Common ending
  items.push(`- [ ] Chạy \`sync_contract\` sau khi xong`);
  items.push(`- [ ] Lưu kết quả vào memory (save_memory)`);
  items.push(`- [ ] Test thủ công các endpoint bị ảnh hưởng`);

  return items.join("\n");
}

// ── Helpers ──

function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!result[key]) result[key] = [];
    result[key].push(item);
  }
  return result;
}

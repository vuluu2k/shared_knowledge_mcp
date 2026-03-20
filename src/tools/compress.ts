/**
 * Relevance scoring + compressed output for MCP tools.
 * Full data, minimal tokens.
 */

import type {
  PhoenixRoute,
  ControllerAction,
  EctoSchema,
  ContextFunction,
  ApiEndpointUsage,
  StoreAction,
} from "../types.js";
import type { ComponentImport } from "../parsers/vue-component-imports.js";

// ── Relevance scoring ──

/**
 * Score how relevant an item is to the task keywords.
 * 3 = direct match (keyword IS the resource name)
 * 2 = strong match (keyword in main path/name)
 * 1 = weak match (keyword appears somewhere)
 * 0 = no match
 */
function scoreRelevance(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  let maxScore = 0;

  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();
    // Direct: "order" === "order" or "orders"
    if (lower === kwLower || lower === kwLower + "s" || lower === kwLower.replace(/s$/, "")) {
      maxScore = Math.max(maxScore, 3);
    }
    // Strong: "/order/" or "OrderController" or "order_" prefix
    else if (
      lower.includes(`/${kwLower}/`) ||
      lower.includes(`/${kwLower}s/`) ||
      lower.startsWith(kwLower) ||
      lower.includes(`${kwLower}_`) ||
      lower.includes(`_${kwLower}`)
    ) {
      maxScore = Math.max(maxScore, 2);
    }
    // Weak: "order" appears anywhere
    else if (lower.includes(kwLower)) {
      maxScore = Math.max(maxScore, 1);
    }
  }

  return maxScore;
}

// ── Compressed formatters ──

export function compressSchemas(
  schemas: EctoSchema[],
  keywords: string[],
  taskWords: string[]
): string {
  if (schemas.length === 0) return "";

  // All keywords including task-specific words for field filtering
  const allRelevantWords = [...keywords, ...taskWords].map((w) => w.toLowerCase());

  const lines: string[] = [`### Schemas(${schemas.length}):`];

  // Sort by relevance
  const scored = schemas
    .map((s) => ({ s, score: scoreRelevance(s.tableName, keywords) + scoreRelevance(s.module, keywords) }))
    .sort((a, b) => b.score - a.score);

  for (const { s, score } of scored) {
    const allFields = s.fields.filter((f) => !s.privateFields.includes(f.name));

    // Split fields into relevant and rest
    const relevantFields = allFields.filter((f) =>
      allRelevantWords.some((w) => f.name.toLowerCase().includes(w))
    );
    const restCount = allFields.length - relevantFields.length;

    const assoc = s.associations.length > 0
      ? ` | ${s.associations.map((a) => `${a.type === "belongs_to" ? "→" : "↔"}${a.name}`).join(",")}`
      : "";

    if (score >= 2 || relevantFields.length > 0) {
      // High relevance: show relevant fields, count the rest
      const relevantStr = relevantFields
        .map((f) => `**${f.name}**:${f.type.replace(/^:/, "")}${f.default !== undefined ? `=${f.default}` : ""}`)
        .join(", ");
      const restStr = restCount > 0 ? ` +${restCount}f` : "";
      lines.push(`${s.tableName}(${allFields.length}f): ${relevantStr}${relevantStr && restStr ? "," : ""}${restStr}${assoc}`);
    } else {
      // Low relevance: just name and count
      lines.push(`${s.tableName}(${allFields.length}f)${assoc}`);
    }
  }

  return lines.join("\n");
}

export function compressRoutes(
  routes: PhoenixRoute[],
  keywords: string[]
): string {
  if (routes.length === 0) return "";

  // Group by controller
  const byCtrl = new Map<string, PhoenixRoute[]>();
  for (const r of routes) {
    if (!byCtrl.has(r.controller)) byCtrl.set(r.controller, []);
    byCtrl.get(r.controller)!.push(r);
  }

  // Score controllers by relevance
  const scored = [...byCtrl.entries()]
    .map(([ctrl, rts]) => ({
      ctrl,
      rts,
      score: scoreRelevance(ctrl, keywords),
    }))
    .sort((a, b) => b.score - a.score);

  const lines: string[] = [`### Routes(${routes.length}):`];

  for (const { ctrl, rts, score } of scored) {
    const actions = [...new Set(rts.map((r) => `${r.method}:${r.action}`))];

    if (score >= 2) {
      // High relevance: show all actions
      lines.push(`${ctrl}: ${actions.join(", ")}`);
    } else {
      // Low relevance: collapse to count
      lines.push(`${ctrl}: ${actions.length} actions`);
    }
  }

  return lines.join("\n");
}

export function compressControllers(
  controllers: ControllerAction[],
  keywords: string[]
): string {
  if (controllers.length === 0) return "";

  const byCtrl = new Map<string, ControllerAction[]>();
  for (const a of controllers) {
    if (!byCtrl.has(a.controller)) byCtrl.set(a.controller, []);
    byCtrl.get(a.controller)!.push(a);
  }

  const scored = [...byCtrl.entries()]
    .map(([ctrl, actions]) => ({
      ctrl,
      actions,
      score: scoreRelevance(ctrl, keywords),
    }))
    .sort((a, b) => b.score - a.score);

  const lines: string[] = [`### Controllers(${controllers.length} actions):`];

  for (const { ctrl, actions, score } of scored) {
    if (score >= 2) {
      // High relevance: show params + response
      const fns = actions.map((a) => {
        const params = a.params
          .filter((p) => p.source !== "conn_assigns")
          .map((p) => p.name)
          .join(",");
        return `${a.action}(${params})→${a.responseType}`;
      });
      lines.push(`${ctrl}: ${fns.join(", ")}`);
    } else {
      // Low relevance: just names
      const fns = actions.map((a) => a.action);
      lines.push(`${ctrl}: ${fns.join(", ")}`);
    }
  }

  return lines.join("\n");
}

export function compressFrontend(
  usages: ApiEndpointUsage[],
  keywords: string[]
): string {
  if (usages.length === 0) return "";

  const byModule = new Map<string, ApiEndpointUsage[]>();
  for (const u of usages) {
    if (!byModule.has(u.module)) byModule.set(u.module, []);
    byModule.get(u.module)!.push(u);
  }

  const scored = [...byModule.entries()]
    .map(([mod, usgs]) => ({
      mod,
      usgs,
      score: scoreRelevance(mod, keywords),
    }))
    .sort((a, b) => b.score - a.score);

  const lines: string[] = [`### Frontend(${usages.length} calls, ${byModule.size} modules):`];

  for (const { mod, usgs, score } of scored) {
    const uniquePaths = [...new Set(usgs.map((u) => {
      const short = u.urlPattern.split("/").filter((s) => !s.startsWith(":") && s.length > 0).slice(-2).join("/");
      return `${u.httpMethod}:${short || u.urlPattern}`;
    }))];

    if (score >= 2) {
      // High relevance: show all paths
      lines.push(`${mod}: ${uniquePaths.join(", ")}`);
    } else {
      // Low relevance: just count
      lines.push(`${mod}: ${uniquePaths.length} endpoints`);
    }
  }

  return lines.join("\n");
}

export function compressStores(
  stores: StoreAction[],
  keywords: string[]
): string {
  if (stores.length === 0) return "";

  const byStore = new Map<string, StoreAction[]>();
  for (const s of stores) {
    if (!byStore.has(s.store)) byStore.set(s.store, []);
    byStore.get(s.store)!.push(s);
  }

  const lines: string[] = [`### Stores(${byStore.size}):`];

  for (const [store, actions] of byStore) {
    const fns = actions.map((a) => {
      const apis = a.apiCalls.map((c) => `${c.apiModule}.${c.method}`).join(",");
      return `${a.action}()${apis ? `→${apis}` : ""}`;
    }).join(", ");
    lines.push(`${store}: ${fns}`);
  }

  return lines.join("\n");
}

export function compressContexts(
  contexts: ContextFunction[],
  keywords: string[]
): string {
  if (contexts.length === 0) return "";

  const byModule = new Map<string, ContextFunction[]>();
  for (const f of contexts) {
    if (!byModule.has(f.module)) byModule.set(f.module, []);
    byModule.get(f.module)!.push(f);
  }

  const scored = [...byModule.entries()]
    .map(([mod, fns]) => ({
      mod,
      fns,
      score: scoreRelevance(mod, keywords),
    }))
    .sort((a, b) => b.score - a.score);

  const lines: string[] = [`### Context(${contexts.length}f, *=site_id):`];

  for (const { mod, fns, score } of scored) {
    if (score >= 2) {
      const fnList = fns.map((f) => `${f.name}/${f.arity}${f.hasSiteId ? "*" : ""}`).join(", ");
      lines.push(`${mod}[${fns[0].repo}]: ${fnList}`);
    } else {
      lines.push(`${mod}[${fns[0].repo}]: ${fns.length}f`);
    }
  }

  return lines.join("\n");
}

export function compressImpact(
  routeCount: number,
  schemaCount: number,
  feCallCount: number,
  components: ComponentImport[]
): string {
  const totalImpact = feCallCount + components.length;
  const risk = totalImpact === 0 ? "LOW" : totalImpact < 5 ? "MEDIUM" : "HIGH";
  const compNames = components.map((c) => c.component).join(", ");

  const lines: string[] = [];
  lines.push(`### Impact: ${risk}`);
  lines.push(`BE: ${routeCount} routes, ${schemaCount} schemas | FE: ${feCallCount} calls, ${components.length} components`);
  if (components.length > 0) {
    lines.push(`Components: ${compNames}`);
  }

  return lines.join("\n");
}

/**
 * Extract task-specific words (not domain keywords) for field-level filtering.
 * "Thêm tính năng giảm giá cho order" → ["giảm", "giá", "giảm giá", "discount", "price"]
 */
export function extractTaskWords(task: string): string[] {
  // Vietnamese → English mapping for common terms
  const viToEn: Record<string, string[]> = {
    "giảm giá": ["discount", "coupon", "price"],
    "giá": ["price", "amount", "value", "cost"],
    "tích điểm": ["point", "reward", "loyalty"],
    "điểm": ["point", "reward"],
    "vận chuyển": ["shipping", "ship", "delivery"],
    "thanh toán": ["payment", "pay", "transaction"],
    "tồn kho": ["inventory", "stock", "quantity"],
    "khuyến mãi": ["promotion", "discount", "coupon"],
    "mã giảm giá": ["coupon", "voucher", "code"],
    "trạng thái": ["status", "state"],
    "địa chỉ": ["address", "province", "district"],
    "hình ảnh": ["image", "avatar", "photo"],
    "email": ["email", "mail"],
    "số điện thoại": ["phone", "phone_number"],
    "tên": ["name", "title"],
    "mô tả": ["description", "note"],
    "ngày": ["date", "time", "created_at", "updated_at"],
    "xóa": ["remove", "delete", "is_removed"],
    "quyền": ["permission", "role", "auth"],
  };

  const words: string[] = [];
  const lower = task.toLowerCase();

  for (const [vi, ens] of Object.entries(viToEn)) {
    if (lower.includes(vi)) {
      words.push(...ens);
    }
  }

  // Also extract English words from task
  const engWords = task.match(/[a-zA-Z_]{3,}/g) || [];
  words.push(...engWords.map((w) => w.toLowerCase()));

  return [...new Set(words)];
}

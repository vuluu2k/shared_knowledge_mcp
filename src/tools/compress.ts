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
import type { CrossProjectEntity, RouteEndpointLink } from "./cross-project-linker.js";

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

// ── Cross-project compressed formatters ──

/**
 * Compress a list of cross-project entities into a compact view.
 * Shows the full chain: Schema → Controller → Route ↔ API → Store → Component
 */
export function compressCrossProjectEntities(
  entities: CrossProjectEntity[],
  keywords: string[],
  maxEntities: number = 5
): string {
  if (entities.length === 0) return "";

  const lines: string[] = [`### Cross-Project Entities(${entities.length}):`];

  for (const entity of entities.slice(0, maxEntities)) {
    const beCount = entity.backend.routes.length + entity.backend.schemas.length;
    const feCount = entity.frontend.apiCalls.length + entity.frontend.stores.length + entity.frontend.components.length;
    const linkCount = entity.links.length;
    const gapCount = entity.gaps.filter((g) => g.severity === "error").length;

    const tag = gapCount > 0 ? " ⚠" : linkCount > 0 ? " ✓" : "";
    lines.push(`\n**${entity.domain}**${tag} (BE:${beCount} FE:${feCount} links:${linkCount})`);

    // Show linked chains
    if (entity.links.length > 0) {
      for (const link of entity.links.slice(0, 8)) {
        const ctrl = link.controller
          ? `${link.route.controller}.${link.route.action}`
          : link.route.controller;
        const feCalls = link.frontendCalls
          .map((f) => `${f.module}.${f.functionName}`)
          .join(",");
        const conf = link.confidence < 1 ? ` ~${Math.round(link.confidence * 100)}%` : "";
        lines.push(`  ${link.route.method.padEnd(6)} ${link.route.path} → ${ctrl} ↔ ${feCalls}${conf}`);
      }
      if (entity.links.length > 8) {
        lines.push(`  +${entity.links.length - 8} more links`);
      }
    }

    // Show stores → components
    if (entity.frontend.stores.length > 0) {
      const storeNames = [...new Set(entity.frontend.stores.map((s) => s.store))];
      const compNames = entity.frontend.components.slice(0, 5).map((c) => c.component);
      const compSuffix = entity.frontend.components.length > 5
        ? ` +${entity.frontend.components.length - 5}`
        : "";
      lines.push(`  Stores: ${storeNames.join(", ")} → Components: ${compNames.join(", ")}${compSuffix}`);
    }

    // Show gaps (errors only)
    const errors = entity.gaps.filter((g) => g.severity === "error");
    if (errors.length > 0) {
      for (const gap of errors.slice(0, 3)) {
        lines.push(`  ⚠ ${gap.detail}`);
      }
    }
  }

  if (entities.length > maxEntities) {
    lines.push(`\n+${entities.length - maxEntities} more entities`);
  }

  return lines.join("\n");
}

/**
 * Compress route↔frontend links into a compact cross-project flow view.
 */
export function compressCrossProjectLinks(
  links: RouteEndpointLink[],
  keywords: string[]
): string {
  if (links.length === 0) return "";

  // Score and sort by relevance
  const scored = links
    .map((link) => ({
      link,
      score: scoreRelevance(link.route.path, keywords) +
        scoreRelevance(link.route.controller, keywords) +
        link.frontendCalls.reduce((s, f) => s + scoreRelevance(f.module, keywords), 0),
    }))
    .sort((a, b) => b.score - a.score);

  const lines: string[] = [`### Cross-Project Links(${links.length}):`];

  for (const { link, score } of scored.slice(0, 15)) {
    const feCalls = link.frontendCalls
      .map((f) => `${f.module}.${f.functionName}`)
      .join(", ");
    const conf = link.confidence < 1 ? ` ~${Math.round(link.confidence * 100)}%` : "";

    if (score >= 3) {
      // High relevance: full detail
      lines.push(`**${link.route.method} ${link.route.path}**`);
      lines.push(`  BE: ${link.route.controller}.${link.route.action}`);
      lines.push(`  FE: ${feCalls}${conf}`);
      if (link.controller) {
        const params = link.controller.params
          .filter((p) => p.source !== "conn_assigns")
          .map((p) => p.name)
          .join(", ");
        lines.push(`  Params: ${params || "(none)"} → ${link.controller.responseType}`);
      }
    } else {
      // Compact
      lines.push(`${link.route.method.padEnd(6)} ${link.route.path} ↔ ${feCalls}${conf}`);
    }
  }

  if (links.length > 15) {
    lines.push(`+${links.length - 15} more links`);
  }

  return lines.join("\n");
}

/**
 * Compress cross-project gaps into actionable warnings.
 */
export function compressCrossProjectGaps(
  entities: CrossProjectEntity[]
): string {
  const allGaps = entities.flatMap((e) => e.gaps.map((g) => ({ domain: e.domain, ...g })));
  if (allGaps.length === 0) return "";

  const errors = allGaps.filter((g) => g.severity === "error");
  const warnings = allGaps.filter((g) => g.severity === "warning");
  const infos = allGaps.filter((g) => g.severity === "info");

  const lines: string[] = [`### Cross-Project Gaps(${allGaps.length}: ${errors.length}E ${warnings.length}W ${infos.length}I):`];

  for (const gap of errors.slice(0, 5)) {
    lines.push(`[ERROR] ${gap.domain}: ${gap.detail}`);
  }
  for (const gap of warnings.slice(0, 3)) {
    lines.push(`[WARN] ${gap.domain}: ${gap.detail}`);
  }
  if (infos.length > 0) {
    lines.push(`[INFO] ${infos.length} route(s) without frontend callers`);
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

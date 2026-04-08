import {
  cachedPhoenixRoutes,
  cachedPhoenixControllers,
  cachedPhoenixSchemas,
  cachedPhoenixContexts,
  cachedVueApiModules,
  cachedVueStores,
  buildContractMap,
  findMismatches,
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
  compressCrossProjectEntities,
  compressCrossProjectGaps,
  extractTaskWords,
} from "./compress.js";
import {
  buildEntityMap,
  linkRoutesToFrontend,
} from "./cross-project-linker.js";
import type { RepoConfig } from "../types.js";

export interface SmartContextArgs {
  question: string;
  depth?: "brief" | "detailed";
}

// ── Intent classification ──

type Intent =
  | "api_endpoint"
  | "frontend_usage"
  | "contract_check"
  | "schema_info"
  | "domain_overview"
  | "memory_recall";

interface ClassifiedIntent {
  intents: Intent[];
  keywords: string[];
}

const INTENT_PATTERNS: { intent: Intent; patterns: RegExp[] }[] = [
  {
    intent: "contract_check",
    patterns: [/mismatch/i, /sync/i, /contract/i, /missing/i, /diff/i, /compare/i, /khớp/i, /thiếu/i],
  },
  {
    intent: "frontend_usage",
    patterns: [/frontend/i, /vue/i, /component/i, /store/i, /who\s+call/i, /gọi/i, /spa/i, /pinia/i],
  },
  {
    intent: "schema_info",
    patterns: [/schema/i, /field/i, /table/i, /database/i, /model/i, /column/i, /migration/i, /bảng/i],
  },
  {
    intent: "api_endpoint",
    patterns: [/endpoint/i, /route/i, /api\b/i, /controller/i, /url/i, /path/i],
  },
  {
    intent: "memory_recall",
    patterns: [/remember/i, /nhớ/i, /previous/i, /decision/i, /business\s*rule/i, /nghiệp\s*vụ/i, /quyết\s*định/i],
  },
  {
    intent: "domain_overview",
    patterns: [/how\s+does/i, /explain/i, /overview/i, /hoạt\s*động/i, /giải\s*thích/i, /tổng\s*quan/i, /flow/i, /work/i],
  },
];

// Common domain keywords found in both repos
const DOMAIN_KEYWORDS = [
  "order", "customer", "product", "article", "blog", "site", "account",
  "organization", "payment", "shipping", "inventory", "category", "discount",
  "promotion", "coupon", "variation", "image", "page", "domain", "template",
  "notification", "webhook", "tiktok", "shopee", "lazada", "zalo", "mini_app",
  "affiliate", "loyalty", "reward", "invoice", "subscription", "pos",
  "email", "sms", "form", "landing", "cms", "seo",
];

function classify(question: string): ClassifiedIntent {
  const intents: Intent[] = [];

  for (const { intent, patterns } of INTENT_PATTERNS) {
    if (patterns.some((p) => p.test(question))) {
      intents.push(intent);
    }
  }

  // Default: domain_overview if no specific intent matched
  if (intents.length === 0) intents.push("domain_overview");

  // Extract domain keywords
  const lower = question.toLowerCase();
  const keywords = DOMAIN_KEYWORDS.filter((kw) => lower.includes(kw));

  // If no domain keyword found, try to extract nouns
  if (keywords.length === 0) {
    const words = lower.split(/\s+/).filter((w) => w.length > 3);
    keywords.push(...words.slice(0, 3));
  }

  return { intents, keywords };
}

// ── Orchestrator ──

export async function smartContext(config: RepoConfig, args: SmartContextArgs) {
  const { intents, keywords } = classify(args.question);
  const detailed = args.depth === "detailed";
  const sections: string[] = [];

  sections.push(`## Smart Context: "${args.question}"`);
  sections.push(`_Intents: ${intents.join(", ")} | Keywords: ${keywords.join(", ")}_\n`);

  // Run all parsers in parallel (including components for cross-project linking)
  const [routes, controllers, schemas, contexts, feUsages, stores, components] = await Promise.all([
    cachedPhoenixRoutes(config.backendPath),
    cachedPhoenixControllers(config.backendPath),
    intents.some((i) => ["schema_info", "domain_overview", "api_endpoint"].includes(i))
      ? cachedPhoenixSchemas(config.backendPath)
      : Promise.resolve([]),
    intents.some((i) => ["domain_overview", "schema_info"].includes(i))
      ? cachedPhoenixContexts(config.backendPath)
      : Promise.resolve([]),
    cachedVueApiModules(config.frontendPath),
    intents.some((i) => ["frontend_usage", "domain_overview"].includes(i))
      ? cachedVueStores(config.frontendPath)
      : Promise.resolve([]),
    intents.some((i) => ["frontend_usage", "domain_overview", "contract_check"].includes(i))
      ? (async () => {
          const { data } = await cachedParse(
            "src/{views,components}/**/*.vue",
            config.frontendPath,
            () => parseVueComponentImports(config.frontendPath)
          );
          return data;
        })()
      : Promise.resolve([]),
  ]);

  // Build cross-project entity map (core synthesis)
  const entities = buildEntityMap(
    routes, controllers, schemas, contexts, feUsages, stores, components,
    keywords.length > 0 ? keywords : undefined
  );

  // Also build direct route↔frontend links for the filtered scope
  const linkResult = linkRoutesToFrontend(routes, controllers, feUsages);

  // Filter by keywords (for per-layer detail sections)
  const kwFilter = (text: string) =>
    keywords.length === 0 || keywords.some((kw) => text.toLowerCase().includes(kw));

  const taskWords = extractTaskWords(args.question);

  const filteredRoutes = routes.filter(
    (r) => kwFilter(r.path) || kwFilter(r.controller) || kwFilter(r.action)
  );
  const filteredControllers = controllers.filter(
    (a) => kwFilter(a.controller) || kwFilter(a.action)
  );
  const filteredSchemas = schemas.filter(
    (s) => kwFilter(s.module) || kwFilter(s.tableName)
  );
  const filteredContexts = contexts.filter(
    (c) => kwFilter(c.module) || kwFilter(c.name)
  );
  const filteredFeUsages = feUsages.filter(
    (u) => kwFilter(u.module) || kwFilter(u.urlPattern) || kwFilter(u.functionName)
  );
  const filteredStores = stores.filter(
    (s) => kwFilter(s.store) || kwFilter(s.action) || s.apiCalls.some((c) => kwFilter(c.apiModule))
  );

  // ── Section 1: Purpose ──
  sections.push(`### Purpose`);
  if (keywords.length > 0) {
    const domainSummary: string[] = [];
    if (filteredSchemas.length > 0) {
      domainSummary.push(`${filteredSchemas.length} schema(s): ${filteredSchemas.map((s) => s.tableName).join(", ")}`);
    }
    if (filteredRoutes.length > 0) {
      domainSummary.push(`${filteredRoutes.length} API endpoint(s)`);
    }
    if (filteredFeUsages.length > 0) {
      domainSummary.push(`${filteredFeUsages.length} frontend call(s)`);
    }
    if (entities.length > 0) {
      domainSummary.push(`${entities.length} cross-project entity(ies)`);
    }
    sections.push(`Domain **${keywords.join(", ")}** includes: ${domainSummary.join(" | ")}`);
  } else {
    sections.push(`General system overview requested.`);
  }
  sections.push("");

  // ── Section 2: Cross-Project Flow (NEW — entity-centric) ──
  sections.push(`### Cross-Project Flow`);
  if (entities.length > 0) {
    for (const entity of entities.slice(0, 3)) {
      // Build the full chain for this entity
      const chain: string[] = [];

      if (entity.backend.schemas.length > 0) {
        chain.push(`Schema(${entity.backend.schemas.map((s) => s.tableName).join(",")})`);
      }
      if (entity.backend.contexts.length > 0) {
        const mods = [...new Set(entity.backend.contexts.map((c) => c.module))].slice(0, 2);
        chain.push(`Context(${mods.join(",")})`);
      }
      if (entity.backend.controllers.length > 0) {
        const ctrls = [...new Set(entity.backend.controllers.map((c) => c.controller))].slice(0, 2);
        chain.push(`Controller(${ctrls.join(",")})`);
      }
      if (entity.backend.routes.length > 0) {
        chain.push(`Route(${entity.backend.routes.length})`);
      }

      // Cross-project boundary
      if (entity.links.length > 0) {
        const modules = [...new Set(entity.links.flatMap((l) => l.frontendCalls.map((f) => f.module)))].slice(0, 3);
        chain.push(`API(${modules.join(",")})`);
      }
      if (entity.frontend.stores.length > 0) {
        const storeNames = [...new Set(entity.frontend.stores.map((s) => s.store))].slice(0, 2);
        chain.push(`Store(${storeNames.join(",")})`);
      }
      if (entity.frontend.components.length > 0) {
        chain.push(`Component(${entity.frontend.components.length})`);
      }

      const linkInfo = entity.links.length > 0
        ? ` [${entity.links.length} linked]`
        : " [unlinked]";
      sections.push(`**${entity.domain}**${linkInfo}: ${chain.join(" → ")}`);
    }
    if (entities.length > 3) {
      sections.push(`+${entities.length - 3} more entities`);
    }
  } else if (filteredRoutes.length > 0 || filteredFeUsages.length > 0) {
    // Fallback: old-style flow
    const flowParts: string[] = [];
    if (filteredFeUsages.length > 0) {
      const modules = [...new Set(filteredFeUsages.map((u) => u.module))].slice(0, 3);
      flowParts.push(`Frontend(${modules.join(",")})`);
    }
    if (filteredRoutes.length > 0) {
      const routeSample = filteredRoutes.slice(0, 2).map((r) => `${r.method} ${r.path}`).join(", ");
      flowParts.push(`Routes(${routeSample})`);
    }
    if (filteredControllers.length > 0) {
      const ctrls = [...new Set(filteredControllers.map((c) => c.controller))].slice(0, 3);
      flowParts.push(`Controllers(${ctrls.join(",")})`);
    }
    sections.push(flowParts.join(" → "));
  } else {
    sections.push("No matching flow found for the given keywords.");
  }
  sections.push("");

  // ── Section 3: Cross-Project Links (NEW) ──
  if (entities.length > 0) {
    const entityBlock = compressCrossProjectEntities(entities, keywords, detailed ? 8 : 3);
    if (entityBlock) sections.push(entityBlock + "\n");

    // Show gaps
    const gapBlock = compressCrossProjectGaps(entities);
    if (gapBlock) sections.push(gapBlock + "\n");
  }

  // ── Section 4: Key Components (per-layer detail) ──
  sections.push(`### Key Components`);

  // Memory (if relevant)
  if (intents.includes("memory_recall") || intents.includes("domain_overview")) {
    for (const kw of keywords.slice(0, 2)) {
      try {
        const mem = await recallMemory({ query: kw, limit: 3 });
        if (mem.total > 0) {
          sections.push(`**Memory** (${mem.total} for "${kw}"):`);
          for (const r of mem.results) {
            sections.push(`- **${r.title}** [${r.category}] ${r.tags.join(", ")}`);
            if (detailed) sections.push(`  ${r.content.slice(0, 200)}`);
          }
          sections.push("");
        }
      } catch { /* no memory */ }
    }
  }

  if (intents.some((i) => ["api_endpoint", "domain_overview", "contract_check"].includes(i))) {
    const block = compressRoutes(filteredRoutes, keywords);
    if (block) sections.push(block + "\n");
  }

  if (intents.some((i) => ["api_endpoint", "domain_overview"].includes(i))) {
    const block = compressControllers(filteredControllers, keywords);
    if (block) sections.push(block + "\n");
  }

  if (intents.some((i) => ["schema_info", "domain_overview"].includes(i)) && filteredSchemas.length > 0) {
    const block = compressSchemas(filteredSchemas, keywords, taskWords);
    if (block) sections.push(block + "\n");
  }

  if (intents.some((i) => ["domain_overview", "schema_info"].includes(i)) && filteredContexts.length > 0) {
    const block = compressContexts(filteredContexts, keywords);
    if (block) sections.push(block + "\n");
  }

  if (intents.some((i) => ["frontend_usage", "domain_overview", "contract_check"].includes(i)) && filteredFeUsages.length > 0) {
    const block = compressFrontend(filteredFeUsages, keywords);
    if (block) sections.push(block + "\n");
  }

  if (intents.some((i) => ["frontend_usage", "domain_overview"].includes(i)) && filteredStores.length > 0) {
    const block = compressStores(filteredStores, keywords);
    if (block) sections.push(block + "\n");
  }

  // ── Section 5: Dependencies (enhanced with cross-project links) ──
  sections.push(`### Dependencies`);
  const deps: string[] = [];

  // Cross-project dependencies via entity links
  for (const entity of entities.slice(0, 5)) {
    if (entity.links.length > 0 && entity.backend.schemas.length > 0) {
      const schemaNames = entity.backend.schemas.map((s) => s.tableName).join(",");
      const feModules = [...new Set(entity.links.flatMap((l) => l.frontendCalls.map((f) => f.module)))];
      deps.push(`**Cross:** ${schemaNames} ↔ ${feModules.join(",")}`);
    }
  }

  // Schema associations
  if (filteredSchemas.length > 0) {
    for (const s of filteredSchemas) {
      if (s.associations.length > 0) {
        deps.push(`${s.tableName} → ${s.associations.map((a) => `${a.type} ${a.name}(${a.target})`).join(", ")}`);
      }
    }
  }
  // Store → API
  if (filteredStores.length > 0) {
    const storeApis = filteredStores
      .filter((s) => s.apiCalls.length > 0)
      .map((s) => `${s.store} → ${s.apiCalls.map((c) => c.apiModule).join(",")}`);
    deps.push(...storeApis);
  }
  if (deps.length > 0) {
    sections.push(deps.join("\n"));
  } else {
    sections.push("No cross-domain dependencies detected.");
  }
  sections.push("");

  // ── Section 6: Risks (enhanced with cross-project gap detection) ──
  sections.push(`### Risks`);
  const risks: string[] = [];

  // Cross-project entity gaps
  const errorGaps = entities.flatMap((e) => e.gaps.filter((g) => g.severity === "error"));
  if (errorGaps.length > 0) {
    risks.push(`**Cross-project gaps (${errorGaps.length}):**`);
    for (const gap of errorGaps.slice(0, 5)) {
      risks.push(`- [ERROR] ${gap.detail}`);
    }
  }

  // Contract mismatches (via diff-engine)
  if (intents.includes("contract_check") || intents.includes("domain_overview")) {
    const contracts = buildContractMap(routes, controllers, feUsages);
    const mismatched = findMismatches(contracts);
    const filtered = mismatched.filter(
      (c) => keywords.length === 0 || kwFilter(c.endpoint)
    );

    if (filtered.length > 0) {
      risks.push(`**Contract mismatches (${filtered.length}):**`);
      for (const c of filtered.slice(0, 10)) {
        for (const m of c.mismatches) {
          risks.push(`- [${m.severity.toUpperCase()}] ${m.detail}`);
        }
      }
    }
  }

  // Coverage gaps
  if (filteredRoutes.length > 0 && filteredFeUsages.length === 0) {
    risks.push(`- No frontend coverage for ${filteredRoutes.length} backend route(s)`);
  }
  if (filteredFeUsages.length > 0 && filteredRoutes.length === 0) {
    risks.push(`- Frontend calls ${filteredFeUsages.length} endpoint(s) with no matching backend routes`);
  }

  // Link confidence warnings
  const lowConfLinks = entities.flatMap((e) => e.links.filter((l) => l.confidence < 0.8));
  if (lowConfLinks.length > 0) {
    risks.push(`- ${lowConfLinks.length} cross-project link(s) with low confidence (fuzzy match)`);
  }

  if (risks.length > 0) {
    sections.push(risks.join("\n"));
  } else {
    sections.push("No risks detected.");
  }

  return sections.join("\n");
}

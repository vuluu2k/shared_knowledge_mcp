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
import { recallMemory } from "./memory.js";
import {
  compressSchemas,
  compressRoutes,
  compressControllers,
  compressFrontend,
  compressStores,
  compressContexts,
  extractTaskWords,
} from "./compress.js";
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

  // Run all needed parsers in parallel
  const [routes, controllers, schemas, contexts, feUsages, stores] = await Promise.all([
    cachedPhoenixRoutes(config.backendPath),
    cachedPhoenixControllers(config.backendPath),
    intents.some((i) => ["schema_info", "domain_overview", "api_endpoint"].includes(i))
      ? cachedPhoenixSchemas(config.backendPath)
      : Promise.resolve([]),
    intents.some((i) => ["domain_overview", "schema_info"].includes(i))
      ? cachedPhoenixContexts(config.backendPath)
      : Promise.resolve([]),
    intents.some((i) => ["frontend_usage", "contract_check", "domain_overview"].includes(i))
      ? cachedVueApiModules(config.frontendPath)
      : Promise.resolve([]),
    intents.some((i) => ["frontend_usage", "domain_overview"].includes(i))
      ? cachedVueStores(config.frontendPath)
      : Promise.resolve([]),
  ]);

  // Filter by keywords
  const kwFilter = (text: string) =>
    keywords.length === 0 || keywords.some((kw) => text.toLowerCase().includes(kw));

  const taskWords = extractTaskWords(args.question);

  // ── Filter all data by relevance ──
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
    sections.push(`Domain **${keywords.join(", ")}** includes: ${domainSummary.join(" | ")}`);
  } else {
    sections.push(`General system overview requested.`);
  }
  sections.push("");

  // ── Section 2: Flow ──
  sections.push(`### Flow`);
  if (filteredRoutes.length > 0 || filteredFeUsages.length > 0) {
    // Build flow: Frontend → Route → Controller → Context → Schema
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
    if (filteredContexts.length > 0) {
      const mods = [...new Set(filteredContexts.map((c) => c.module))].slice(0, 3);
      flowParts.push(`Context(${mods.join(",")})`);
    }
    if (filteredSchemas.length > 0) {
      flowParts.push(`Schema(${filteredSchemas.map((s) => s.tableName).join(",")})`);
    }
    sections.push(flowParts.join(" → "));
  } else {
    sections.push("No matching flow found for the given keywords.");
  }
  sections.push("");

  // ── Section 3: Key Components ──
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

  // ── Section 4: Dependencies ──
  sections.push(`### Dependencies`);
  const deps: string[] = [];
  if (filteredSchemas.length > 0) {
    for (const s of filteredSchemas) {
      if (s.associations.length > 0) {
        deps.push(`${s.tableName} → ${s.associations.map((a) => `${a.type} ${a.name}(${a.target})`).join(", ")}`);
      }
    }
  }
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

  // ── Section 5: Risks ──
  sections.push(`### Risks`);
  const risks: string[] = [];

  // Contract mismatches
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

  if (risks.length > 0) {
    sections.push(risks.join("\n"));
  } else {
    sections.push("No risks detected.");
  }

  return sections.join("\n");
}

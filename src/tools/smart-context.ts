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

  // Memory recall (if relevant)
  if (intents.includes("memory_recall") || intents.includes("domain_overview")) {
    for (const kw of keywords.slice(0, 2)) {
      try {
        const mem = await recallMemory({ query: kw, limit: 3 });
        if (mem.total > 0) {
          sections.push(`### Memory (${mem.total} found for "${kw}")`);
          for (const r of mem.results) {
            sections.push(`- **${r.title}** [${r.category}] ${r.tags.join(", ")}`);
            if (detailed) sections.push(`  ${r.content.slice(0, 200)}`);
          }
          sections.push("");
        }
      } catch { /* no memory */ }
    }
  }

  // Filter by keywords
  const kwFilter = (text: string) =>
    keywords.length === 0 || keywords.some((kw) => text.toLowerCase().includes(kw));

  // ── Relevance-scored compressed output ──
  const taskWords = extractTaskWords(args.question);

  if (intents.some((i) => ["api_endpoint", "domain_overview", "contract_check"].includes(i))) {
    const filtered = routes.filter(
      (r) => kwFilter(r.path) || kwFilter(r.controller) || kwFilter(r.action)
    );
    const block = compressRoutes(filtered, keywords);
    if (block) sections.push(block + "\n");
  }

  if (intents.some((i) => ["api_endpoint", "domain_overview"].includes(i))) {
    const filtered = controllers.filter(
      (a) => kwFilter(a.controller) || kwFilter(a.action)
    );
    const block = compressControllers(filtered, keywords);
    if (block) sections.push(block + "\n");
  }

  if (intents.some((i) => ["schema_info", "domain_overview"].includes(i)) && schemas.length > 0) {
    const filtered = schemas.filter(
      (s) => kwFilter(s.module) || kwFilter(s.tableName)
    );
    const block = compressSchemas(filtered, keywords, taskWords);
    if (block) sections.push(block + "\n");
  }

  if (intents.some((i) => ["domain_overview", "schema_info"].includes(i)) && contexts.length > 0) {
    const filtered = contexts.filter(
      (c) => kwFilter(c.module) || kwFilter(c.name)
    );
    const block = compressContexts(filtered, keywords);
    if (block) sections.push(block + "\n");
  }

  if (intents.some((i) => ["frontend_usage", "domain_overview", "contract_check"].includes(i)) && feUsages.length > 0) {
    const filtered = feUsages.filter(
      (u) => kwFilter(u.module) || kwFilter(u.urlPattern) || kwFilter(u.functionName)
    );
    const block = compressFrontend(filtered, keywords);
    if (block) sections.push(block + "\n");
  }

  if (intents.some((i) => ["frontend_usage", "domain_overview"].includes(i)) && stores.length > 0) {
    const filtered = stores.filter(
      (s) => kwFilter(s.store) || kwFilter(s.action) || s.apiCalls.some((c) => kwFilter(c.apiModule))
    );
    if (filtered.length > 0) {
      const block = compressStores(filtered, keywords);
      if (block) sections.push(block + "\n");
    }
  }

  // ── Contract mismatches ──
  if (intents.includes("contract_check")) {
    const contracts = buildContractMap(routes, controllers, feUsages);
    const mismatched = findMismatches(contracts);
    const filtered = mismatched.filter(
      (c) => keywords.length === 0 || kwFilter(c.endpoint)
    );

    sections.push(`### Contract Mismatches (${filtered.length})`);
    if (filtered.length === 0) {
      sections.push("No mismatches found.");
    } else {
      for (const c of filtered.slice(0, 15)) {
        for (const m of c.mismatches) {
          sections.push(`[${m.severity.toUpperCase()}] ${m.detail}`);
        }
      }
    }
    sections.push("");
  }

  return sections.join("\n");
}

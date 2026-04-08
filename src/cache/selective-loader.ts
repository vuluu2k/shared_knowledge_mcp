/**
 * Selective Loader
 *
 * Thay vì load TẤT CẢ data rồi filter cuối cùng, module này chain-filter
 * theo dependency graph:
 *
 *   keywords → routes → controllers → schemas → contexts
 *                                                  ↓
 *                                    frontend calls → stores → components
 *
 * Mỗi layer chỉ load data liên quan tới layer trước đó.
 * Giảm ~70-90% data truyền vào buildEntityMap / compress functions.
 */

import {
  cachedPhoenixRoutes,
  cachedPhoenixControllers,
  cachedPhoenixSchemas,
  cachedPhoenixContexts,
  cachedVueApiModules,
  cachedVueStores,
} from "./cached-parsers.js";
import { cachedParse } from "./file-hash-cache.js";
import { parseVueComponentImports, type ComponentImport } from "../parsers/vue-component-imports.js";
import type {
  PhoenixRoute,
  ControllerAction,
  EctoSchema,
  ContextFunction,
  ApiEndpointUsage,
  StoreAction,
  RepoConfig,
} from "../types.js";

// ── Output type ──

export interface ScopedData {
  routes: PhoenixRoute[];
  controllers: ControllerAction[];
  schemas: EctoSchema[];
  contexts: ContextFunction[];
  feUsages: ApiEndpointUsage[];
  stores: StoreAction[];
  components: ComponentImport[];
  /** Keywords used for filtering */
  keywords: string[];
  /** Stats: how much was filtered */
  stats: {
    totalRoutes: number;
    totalControllers: number;
    totalSchemas: number;
    totalContexts: number;
    totalFeUsages: number;
    totalStores: number;
    totalComponents: number;
    loadedRoutes: number;
    loadedControllers: number;
    loadedSchemas: number;
    loadedContexts: number;
    loadedFeUsages: number;
    loadedStores: number;
    loadedComponents: number;
  };
}

// ── Options ──

export interface LoadOptions {
  /** Domain keywords to filter by (e.g., ["order", "customer"]) */
  keywords: string[];
  /** Which layers to include. Default: all */
  layers?: {
    schemas?: boolean;
    contexts?: boolean;
    stores?: boolean;
    components?: boolean;
  };
  /** For analyze_impact: target file/function name instead of keywords */
  target?: string;
}

// ── Keyword matcher ──

function kwMatch(text: string, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

/** Extract controller module names from routes (e.g., "OrderController" → "order") */
function controllerDomains(routes: PhoenixRoute[]): string[] {
  const domains = new Set<string>();
  for (const r of routes) {
    // "OrderController" → "order", "ProductVariationController" → "product_variation"
    const name = r.controller
      .replace(/Controller$/, "")
      .replace(/([A-Z])/g, (m, c, i) => (i === 0 ? c.toLowerCase() : `_${c.toLowerCase()}`))
      .replace(/^_/, "");
    domains.add(name);
    // Also add the singular/plural forms
    domains.add(name.replace(/s$/, ""));
    if (!name.endsWith("s")) domains.add(name + "s");
  }
  return [...domains];
}

/** Extract API module domains from frontend usages (e.g., "orderApi" → "order") */
function feModuleDomains(usages: ApiEndpointUsage[]): string[] {
  const domains = new Set<string>();
  for (const u of usages) {
    const name = u.module
      .replace(/Api$/i, "")
      .replace(/([A-Z])/g, (m, c, i) => (i === 0 ? c.toLowerCase() : `_${c.toLowerCase()}`))
      .replace(/^_/, "");
    domains.add(name);
  }
  return [...domains];
}

// ── Main loader ──

/**
 * Load only the data relevant to the given keywords/target.
 * Uses chain-based filtering: routes → controllers → schemas → contexts → frontend → stores → components.
 */
export async function loadScopedData(
  config: RepoConfig,
  opts: LoadOptions
): Promise<ScopedData> {
  const keywords = opts.keywords.map((k) => k.toLowerCase());
  const layers = opts.layers || {};
  const includeSchemas = layers.schemas !== false;
  const includeContexts = layers.contexts !== false;
  const includeStores = layers.stores !== false;
  const includeComponents = layers.components !== false;

  // Step 1: Load routes + frontend calls (always needed, fast from cache)
  const [allRoutes, allControllers, allFeUsages] = await Promise.all([
    cachedPhoenixRoutes(config.backendPath),
    cachedPhoenixControllers(config.backendPath),
    cachedVueApiModules(config.frontendPath),
  ]);

  // Step 2: Filter routes by keywords or target
  let filteredRoutes: PhoenixRoute[];
  let filteredControllers: ControllerAction[];

  if (opts.target) {
    // Target-based filtering (for analyze_impact)
    const t = opts.target.toLowerCase();
    filteredRoutes = allRoutes.filter(
      (r) =>
        r.controller.toLowerCase().includes(t.replace("controller", "").replace(".ex", "")) ||
        r.action.toLowerCase() === t ||
        r.path.toLowerCase().includes(t)
    );
    filteredControllers = allControllers.filter(
      (a) =>
        a.filePath.includes(opts.target!) ||
        a.controller.toLowerCase().includes(t.replace("controller", "").replace(".ex", "")) ||
        a.action.toLowerCase() === t
    );
  } else if (keywords.length > 0) {
    // Keyword-based filtering
    filteredRoutes = allRoutes.filter(
      (r) => kwMatch(r.path, keywords) || kwMatch(r.controller, keywords) || kwMatch(r.action, keywords)
    );
    filteredControllers = allControllers.filter(
      (a) => kwMatch(a.controller, keywords) || kwMatch(a.action, keywords)
    );
  } else {
    // No filter — return all
    filteredRoutes = allRoutes;
    filteredControllers = allControllers;
  }

  // Step 3: Discover additional keywords from matched routes/controllers
  // This lets us find schemas/contexts that weren't caught by initial keywords
  const discoveredDomains = controllerDomains(filteredRoutes);
  const expandedKeywords = [...new Set([...keywords, ...discoveredDomains])];

  // Step 4: Filter frontend calls by keywords + route paths
  let filteredFeUsages: ApiEndpointUsage[];
  if (keywords.length > 0 || opts.target) {
    // Match by keyword OR by route path similarity
    const routePaths = filteredRoutes.map((r) =>
      r.path.replace(/:(\w+)/g, ":param").toLowerCase()
    );

    filteredFeUsages = allFeUsages.filter((u) => {
      // Direct keyword match
      if (kwMatch(u.module, keywords) || kwMatch(u.urlPattern, keywords) || kwMatch(u.functionName, keywords)) {
        return true;
      }
      // Route-path match: check if this frontend call's URL matches any filtered route
      const normFe = u.urlPattern
        .replace(/:(\w+)/g, ":param")
        .replace(/\$\{[^}]+\}/g, ":param")
        .toLowerCase();
      return routePaths.some((rp) => {
        const rpParts = rp.split("/").filter(Boolean);
        const feParts = normFe.split("/").filter(Boolean);
        if (rpParts.length !== feParts.length) return false;
        return rpParts.every(
          (seg, i) => seg === feParts[i] || seg === ":param" || feParts[i] === ":param"
        );
      });
    });
  } else {
    filteredFeUsages = allFeUsages;
  }

  // Step 5: Expand keywords further from frontend modules
  const feModDomains = feModuleDomains(filteredFeUsages);
  const fullKeywords = [...new Set([...expandedKeywords, ...feModDomains])];

  // Step 6: Load and filter schemas (only if needed)
  let filteredSchemas: EctoSchema[] = [];
  let totalSchemas = 0;
  if (includeSchemas) {
    const allSchemas = await cachedPhoenixSchemas(config.backendPath);
    totalSchemas = allSchemas.length;
    if (fullKeywords.length > 0) {
      filteredSchemas = allSchemas.filter(
        (s) => kwMatch(s.module, fullKeywords) || kwMatch(s.tableName, fullKeywords)
      );
    } else {
      filteredSchemas = allSchemas;
    }
  }

  // Step 7: Load and filter contexts (only if needed)
  let filteredContexts: ContextFunction[] = [];
  let totalContexts = 0;
  if (includeContexts) {
    const allContexts = await cachedPhoenixContexts(config.backendPath);
    totalContexts = allContexts.length;
    if (fullKeywords.length > 0) {
      filteredContexts = allContexts.filter(
        (c) => kwMatch(c.module, fullKeywords) || kwMatch(c.name, fullKeywords)
      );
    } else {
      filteredContexts = allContexts;
    }
  }

  // Step 8: Load and filter stores (only if needed)
  let filteredStores: StoreAction[] = [];
  let totalStores = 0;
  if (includeStores) {
    const allStores = await cachedVueStores(config.frontendPath);
    totalStores = allStores.length;

    // Match stores by: keyword OR by API module name from filtered frontend calls
    const feModuleNames = [...new Set(filteredFeUsages.map((u) => u.module.toLowerCase()))];
    if (fullKeywords.length > 0 || feModuleNames.length > 0) {
      filteredStores = allStores.filter(
        (s) =>
          kwMatch(s.store, fullKeywords) ||
          kwMatch(s.action, fullKeywords) ||
          s.apiCalls.some((c) =>
            kwMatch(c.apiModule, fullKeywords) ||
            feModuleNames.some((m) => c.apiModule.toLowerCase().includes(m))
          )
      );
    } else {
      filteredStores = allStores;
    }
  }

  // Step 9: Load and filter components (only if needed)
  let filteredComponents: ComponentImport[] = [];
  let totalComponents = 0;
  if (includeComponents) {
    const { data: allComponents } = await cachedParse(
      "src/{views,components}/**/*.vue",
      config.frontendPath,
      () => parseVueComponentImports(config.frontendPath)
    );
    totalComponents = allComponents.length;

    // Match components by: store imports from filtered stores
    const storeNames = [...new Set(filteredStores.map((s) => s.store.toLowerCase()))];
    const apiModuleNames = [...new Set(filteredFeUsages.map((u) => u.module.toLowerCase()))];

    if (storeNames.length > 0 || apiModuleNames.length > 0) {
      filteredComponents = allComponents.filter((c) =>
        c.storeImports.some((si) =>
          storeNames.some((sn) => si.toLowerCase().includes(sn))
        ) ||
        c.apiImports.some((ai) =>
          apiModuleNames.some((m) => ai.toLowerCase().includes(m))
        )
      );
    } else if (fullKeywords.length > 0) {
      // Fallback: keyword match on file path
      filteredComponents = allComponents.filter((c) =>
        kwMatch(c.filePath, fullKeywords) || kwMatch(c.component, fullKeywords)
      );
    } else {
      filteredComponents = allComponents;
    }
  }

  return {
    routes: filteredRoutes,
    controllers: filteredControllers,
    schemas: filteredSchemas,
    contexts: filteredContexts,
    feUsages: filteredFeUsages,
    stores: filteredStores,
    components: filteredComponents,
    keywords: opts.keywords,
    stats: {
      totalRoutes: allRoutes.length,
      totalControllers: allControllers.length,
      totalSchemas,
      totalContexts,
      totalFeUsages: allFeUsages.length,
      totalStores,
      totalComponents,
      loadedRoutes: filteredRoutes.length,
      loadedControllers: filteredControllers.length,
      loadedSchemas: filteredSchemas.length,
      loadedContexts: filteredContexts.length,
      loadedFeUsages: filteredFeUsages.length,
      loadedStores: filteredStores.length,
      loadedComponents: filteredComponents.length,
    },
  };
}

/**
 * Format stats as a compact summary line.
 */
export function formatScopedStats(stats: ScopedData["stats"]): string {
  const parts: string[] = [];
  if (stats.totalRoutes > 0) parts.push(`routes:${stats.loadedRoutes}/${stats.totalRoutes}`);
  if (stats.totalControllers > 0) parts.push(`ctrl:${stats.loadedControllers}/${stats.totalControllers}`);
  if (stats.totalSchemas > 0) parts.push(`schema:${stats.loadedSchemas}/${stats.totalSchemas}`);
  if (stats.totalContexts > 0) parts.push(`ctx:${stats.loadedContexts}/${stats.totalContexts}`);
  if (stats.totalFeUsages > 0) parts.push(`fe:${stats.loadedFeUsages}/${stats.totalFeUsages}`);
  if (stats.totalStores > 0) parts.push(`store:${stats.loadedStores}/${stats.totalStores}`);
  if (stats.totalComponents > 0) parts.push(`comp:${stats.loadedComponents}/${stats.totalComponents}`);
  return `Scoped: ${parts.join(" | ")}`;
}

import { execSync } from "child_process";
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
import type { RepoConfig } from "../types.js";

export interface AnalyzeImpactArgs {
  target: string;
  repo?: "backend" | "frontend" | "auto";
  direction?: "both" | "dependents" | "dependencies";
  depth?: number;
}

type RepoType = "backend" | "frontend";

export async function analyzeImpact(config: RepoConfig, args: AnalyzeImpactArgs) {
  const maxDepth = Math.min(args.depth || 3, 5);
  const direction = args.direction || "both";
  const repo = detectRepo(args.target, args.repo);
  const sections: string[] = [];

  // Load all data in parallel
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

  const target = args.target;
  sections.push(`## Impact Analysis: ${target}`);
  sections.push(`_Repo: ${repo} | Direction: ${direction} | Depth: ${maxDepth}_\n`);

  if (repo === "backend") {
    // ── Backend target ──
    const targetLower = target.toLowerCase();
    const isSchemaFile = targetLower.includes("/") && targetLower.endsWith(".ex");
    const isController = targetLower.includes("controller");

    // Find matching schema
    const matchedSchema = schemas.find(
      (s) =>
        s.filePath.includes(target) ||
        s.module.toLowerCase().includes(targetLower.replace(".ex", "")) ||
        s.tableName === targetLower
    );

    // Find matching context functions
    const matchedContexts = contexts.filter(
      (c) =>
        c.filePath.includes(target) ||
        c.module.toLowerCase().includes(targetLower.replace(".ex", "")) ||
        c.name.toLowerCase().includes(targetLower)
    );

    // Find matching controllers
    const matchedControllers = controllers.filter(
      (a) =>
        a.filePath.includes(target) ||
        a.controller.toLowerCase().includes(targetLower.replace("controller", "").replace(".ex", "")) ||
        a.action.toLowerCase() === targetLower
    );

    // Find matching routes
    const matchedRoutes = routes.filter(
      (r) =>
        r.controller.toLowerCase().includes(targetLower.replace("controller", "").replace(".ex", "")) ||
        r.action.toLowerCase() === targetLower ||
        r.path.includes(targetLower)
    );

    // ── Dependencies (what this depends on) ──
    if (direction === "both" || direction === "dependencies") {
      sections.push("### Dependencies (this depends on)");

      if (matchedSchema) {
        sections.push(`Schema: **${matchedSchema.tableName}** (${matchedSchema.fields.length} fields)`);
        if (matchedSchema.associations.length > 0) {
          sections.push(
            `  Associations: ${matchedSchema.associations.map((a) => `${a.type} ${a.name} → ${a.target}`).join(", ")}`
          );
        }
      }

      if (matchedContexts.length > 0) {
        const modules = [...new Set(matchedContexts.map((c) => c.module))];
        sections.push(`Context modules: ${modules.join(", ")}`);
      }
      sections.push("");
    }

    // ── Dependents (what depends on this) ──
    if (direction === "both" || direction === "dependents") {
      sections.push("### Dependents (affected by changes)");

      // Backend chain: schema → context → controller → route
      if (matchedSchema) {
        const relatedContexts = contexts.filter(
          (c) =>
            c.module.toLowerCase().includes(matchedSchema.tableName.replace(/s$/, "")) ||
            c.module.toLowerCase().includes(matchedSchema.tableName)
        );
        if (relatedContexts.length > 0) {
          const modules = [...new Set(relatedContexts.map((c) => c.module))];
          sections.push(`**Context layer:** ${modules.join(", ")} (${relatedContexts.length} functions)`);
        }
      }

      if (matchedControllers.length > 0) {
        sections.push(`**Controller layer:** ${matchedControllers.length} actions`);
        for (const a of matchedControllers.slice(0, 10)) {
          sections.push(`  ${a.controller}.${a.action} → ${a.responseType}`);
        }
      }

      if (matchedRoutes.length > 0) {
        sections.push(`**Route layer:** ${matchedRoutes.length} routes`);
        for (const r of matchedRoutes.slice(0, 10)) {
          sections.push(`  ${r.method.padEnd(6)} ${r.path}`);
        }
      }

      // Cross-repo: route → frontend API → store → component
      const routePaths = matchedRoutes.map((r) => r.path.toLowerCase());
      const matchedFeUsages = feUsages.filter((u) =>
        routePaths.some((rp) => {
          const normRoute = rp.replace(/:(\w+)/g, "");
          const normFe = u.urlPattern.replace(/:(\w+)/g, "").replace(/\$\{[^}]+\}/g, "");
          return pathOverlap(normRoute, normFe);
        }) ||
        matchedControllers.some(
          (c) =>
            u.urlPattern.toLowerCase().includes(c.controller.toLowerCase().replace("controller", "")) ||
            u.module.toLowerCase().includes(targetLower.replace(".ex", "").replace("controller", ""))
        )
      );

      if (matchedFeUsages.length > 0) {
        const byModule = groupBy(matchedFeUsages, (u) => u.module);
        sections.push(`**Frontend API layer:** ${matchedFeUsages.length} usages`);
        for (const [mod, usages] of Object.entries(byModule)) {
          sections.push(`  ${mod}: ${usages.map((u) => `${u.httpMethod} ${u.urlPattern}`).join(", ")}`);
        }
      }

      // Stores that call these API modules
      const feModules = [...new Set(matchedFeUsages.map((u) => u.module.toLowerCase()))];
      const matchedStores = stores.filter((s) =>
        s.apiCalls.some((c) => feModules.some((m) => c.apiModule.toLowerCase().includes(m)))
      );

      if (matchedStores.length > 0) {
        const byStore = groupBy(matchedStores, (s) => s.store);
        sections.push(`**Store layer:** ${Object.keys(byStore).length} stores`);
        for (const [store, actions] of Object.entries(byStore)) {
          sections.push(`  ${store}: ${actions.map((a) => a.action).join(", ")}`);
        }
      }

      // Components that use these stores
      const storeNames = [...new Set(matchedStores.map((s) => s.store.toLowerCase()))];
      const matchedComponents = components.filter((c) =>
        c.storeImports.some((si) => storeNames.some((sn) => si.toLowerCase().includes(sn)))
      );

      if (matchedComponents.length > 0) {
        sections.push(`**Component layer:** ${matchedComponents.length} components`);
        for (const c of matchedComponents.slice(0, 15)) {
          sections.push(`  ${c.filePath}`);
        }
      }

      sections.push("");

      // Risk assessment
      sections.push("### Risk Assessment");
      const totalFrontendImpact = matchedFeUsages.length + matchedStores.length + matchedComponents.length;
      if (totalFrontendImpact === 0) {
        sections.push("LOW — No frontend dependencies detected");
      } else if (totalFrontendImpact < 5) {
        sections.push(`MEDIUM — ${totalFrontendImpact} frontend artifacts affected`);
      } else {
        sections.push(`HIGH — ${totalFrontendImpact} frontend artifacts affected`);
        sections.push("Recommend: check response shape compatibility before deploying");
      }
    }
  } else {
    // ── Frontend target ──
    const targetLower = target.toLowerCase();

    // Find matching API modules
    const matchedFeUsages = feUsages.filter(
      (u) =>
        u.filePath.includes(target) ||
        u.module.toLowerCase().includes(targetLower.replace(/\.(js|ts|vue)$/, "")) ||
        u.functionName.toLowerCase() === targetLower
    );

    // Find matching stores
    const matchedStores = stores.filter(
      (s) =>
        s.filePath.includes(target) ||
        s.store.toLowerCase().includes(targetLower.replace(/\.(js|ts)$/, ""))
    );

    // Find matching components
    const matchedComponents = components.filter(
      (c) =>
        c.filePath.includes(target) ||
        c.component.toLowerCase().includes(targetLower.replace(/\.vue$/, ""))
    );

    if (direction === "both" || direction === "dependencies") {
      sections.push("### Dependencies (this calls)");

      if (matchedFeUsages.length > 0) {
        sections.push(`**API calls:** ${matchedFeUsages.length}`);
        for (const u of matchedFeUsages.slice(0, 15)) {
          sections.push(`  ${u.httpMethod} ${u.urlPattern} (${u.module}.${u.functionName})`);
        }
      }

      // Store → API module dependencies
      if (matchedStores.length > 0) {
        sections.push(`**Store API calls:**`);
        for (const s of matchedStores) {
          if (s.apiCalls.length > 0) {
            sections.push(`  ${s.store}.${s.action} → ${s.apiCalls.map((c) => `${c.apiModule}.${c.method}`).join(", ")}`);
          }
        }
      }

      // Trace to backend
      const allUrls = matchedFeUsages.map((u) => u.urlPattern);
      const storeApis = matchedStores.flatMap((s) => s.apiCalls);
      const matchedRoutes = routes.filter((r) =>
        allUrls.some((url) => pathOverlap(r.path, url)) ||
        storeApis.some((api) =>
          r.controller.toLowerCase().includes(api.apiModule.toLowerCase().replace("api", ""))
        )
      );

      if (matchedRoutes.length > 0) {
        sections.push(`**Backend routes hit:**`);
        for (const r of matchedRoutes.slice(0, 10)) {
          sections.push(`  ${r.method.padEnd(6)} ${r.path} → ${r.controller}.${r.action}`);
        }
      }

      sections.push("");
    }

    if (direction === "both" || direction === "dependents") {
      sections.push("### Dependents (who uses this)");

      // Components using matched stores
      if (matchedStores.length > 0) {
        const storeNamesList = matchedStores.map((s) => s.store.toLowerCase());
        const dependentComponents = components.filter((c) =>
          c.storeImports.some((si) => storeNamesList.some((sn) => si.toLowerCase().includes(sn)))
        );
        if (dependentComponents.length > 0) {
          sections.push(`**Components using these stores:** ${dependentComponents.length}`);
          for (const c of dependentComponents.slice(0, 15)) {
            sections.push(`  ${c.filePath} (imports: ${c.storeImports.join(", ")})`);
          }
        }
      }

      sections.push("");
    }
  }

  return sections.join("\n");
}

// ── Helpers ──

function detectRepo(target: string, hint?: string): RepoType {
  if (hint === "backend" || hint === "frontend") return hint;
  if (target.endsWith(".ex") || target.endsWith(".exs") || target.includes("builderx_api"))
    return "backend";
  if (target.endsWith(".vue") || target.endsWith(".js") || target.endsWith(".ts") || target.includes("builderx_spa"))
    return "frontend";
  // Default: backend
  return "backend";
}

function pathOverlap(a: string, b: string): boolean {
  const normalize = (p: string) =>
    p
      .replace(/:(\w+)/g, "*")
      .replace(/\$\{[^}]+\}/g, "*")
      .split("/")
      .filter(Boolean);
  const aParts = normalize(a);
  const bParts = normalize(b);

  // Check if meaningful segments overlap
  const aSet = new Set(aParts.filter((p) => p !== "*" && p.length > 2));
  const bSet = new Set(bParts.filter((p) => p !== "*" && p.length > 2));

  let overlap = 0;
  for (const seg of aSet) {
    if (bSet.has(seg)) overlap++;
  }

  return overlap >= 2;
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!result[key]) result[key] = [];
    result[key].push(item);
  }
  return result;
}

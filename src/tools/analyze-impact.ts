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
import {
  buildEntityMap,
  findAffectedEntities,
  traceRouteChain,
} from "./cross-project-linker.js";
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

  // Build entity map for cross-project linking
  const entities = buildEntityMap(
    routes, controllers, schemas, contexts, feUsages, stores, components
  );
  const affectedEntities = findAffectedEntities(entities, target);

  if (repo === "backend") {
    // ── Backend target ──
    const targetLower = target.toLowerCase();

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

    // Cross-repo via entity linker (accurate URL matching)
    const matchedFeUsages = affectedEntities.flatMap((e) => e.frontend.apiCalls);
    const matchedStores = affectedEntities.flatMap((e) => e.frontend.stores);
    const matchedComponents = affectedEntities.flatMap((e) => e.frontend.components);
    // Deduplicate
    const uniqueFeUsages = [...new Map(matchedFeUsages.map((u) => [`${u.module}:${u.functionName}`, u])).values()];
    const uniqueStores = [...new Map(matchedStores.map((s) => [`${s.store}:${s.action}`, s])).values()];
    const uniqueComponents = [...new Map(matchedComponents.map((c) => [c.filePath, c])).values()];

    // ── Section 1: What is affected ──
    sections.push("### What is affected");

    if (direction === "both" || direction === "dependencies") {
      sections.push("**Dependencies (this depends on):**");
      if (matchedSchema) {
        sections.push(`- Schema: **${matchedSchema.tableName}** (${matchedSchema.fields.length} fields)`);
        if (matchedSchema.associations.length > 0) {
          sections.push(
            `  Associations: ${matchedSchema.associations.map((a) => `${a.type} ${a.name} → ${a.target}`).join(", ")}`
          );
        }
      }
      if (matchedContexts.length > 0) {
        const modules = [...new Set(matchedContexts.map((c) => c.module))];
        sections.push(`- Context modules: ${modules.join(", ")}`);
      }
      if (!matchedSchema && matchedContexts.length === 0) {
        sections.push(`- None detected`);
      }
      sections.push("");
    }

    if (direction === "both" || direction === "dependents") {
      sections.push("**Dependents (affected by changes):**");

      if (matchedSchema) {
        const relatedContexts = contexts.filter(
          (c) =>
            c.module.toLowerCase().includes(matchedSchema.tableName.replace(/s$/, "")) ||
            c.module.toLowerCase().includes(matchedSchema.tableName)
        );
        if (relatedContexts.length > 0) {
          const modules = [...new Set(relatedContexts.map((c) => c.module))];
          sections.push(`- Context layer: ${modules.join(", ")} (${relatedContexts.length} functions)`);
        }
      }

      if (matchedControllers.length > 0) {
        sections.push(`- Controller layer: ${matchedControllers.length} actions`);
        for (const a of matchedControllers.slice(0, 10)) {
          sections.push(`  ${a.controller}.${a.action} → ${a.responseType}`);
        }
      }

      if (matchedRoutes.length > 0) {
        sections.push(`- Route layer: ${matchedRoutes.length} routes`);
        for (const r of matchedRoutes.slice(0, 10)) {
          sections.push(`  ${r.method.padEnd(6)} ${r.path}`);
        }
      }

      // Cross-project impact via entity linker
      if (uniqueFeUsages.length > 0) {
        const byModule = groupBy(uniqueFeUsages, (u) => u.module);
        sections.push(`- Frontend API layer: ${uniqueFeUsages.length} usages (via entity linker)`);
        for (const [mod, usages] of Object.entries(byModule)) {
          sections.push(`  ${mod}: ${usages.map((u) => `${u.httpMethod} ${u.urlPattern}`).join(", ")}`);
        }
      }

      if (uniqueStores.length > 0) {
        const byStore = groupBy(uniqueStores, (s) => s.store);
        sections.push(`- Store layer: ${Object.keys(byStore).length} stores`);
        for (const [store, actions] of Object.entries(byStore)) {
          sections.push(`  ${store}: ${actions.map((a) => a.action).join(", ")}`);
        }
      }

      if (uniqueComponents.length > 0) {
        sections.push(`- Component layer: ${uniqueComponents.length} components`);
        for (const c of uniqueComponents.slice(0, 15)) {
          sections.push(`  ${c.filePath}`);
        }
      }

      sections.push("");
    }

    // ── Cross-Project Chains ──
    if (affectedEntities.length > 0) {
      sections.push("### Cross-Project Chains");
      for (const entity of affectedEntities.slice(0, 3)) {
        for (const route of entity.backend.routes.slice(0, 3)) {
          const chain = traceRouteChain(entity, route);
          sections.push(`${entity.domain}: ${chain.join(" → ")}`);
        }
      }
      sections.push("");
    }

    // ── Section 2: Why ──
    sections.push("### Why");
    const whyParts: string[] = [];
    if (matchedSchema) whyParts.push(`Schema "${matchedSchema.tableName}" is the data source`);
    if (matchedControllers.length > 0) whyParts.push(`${matchedControllers.length} controller action(s) expose this as API`);
    if (uniqueFeUsages.length > 0) whyParts.push(`Frontend makes ${uniqueFeUsages.length} call(s) to these endpoints`);
    if (uniqueStores.length > 0) whyParts.push(`${uniqueStores.length} store(s) cache/transform this data`);
    if (uniqueComponents.length > 0) whyParts.push(`${uniqueComponents.length} component(s) render this in UI`);
    sections.push(whyParts.length > 0
      ? `Changes propagate through: ${whyParts.join(" → ")}`
      : "No dependency chain detected — changes are isolated."
    );
    sections.push("");

    // ── Section 3: Risk Level ──
    const totalFrontendImpact = uniqueFeUsages.length + uniqueStores.length + uniqueComponents.length;
    const riskLevel = totalFrontendImpact === 0 ? "LOW" : totalFrontendImpact < 5 ? "MEDIUM" : "HIGH";

    sections.push(`### Risk Level: ${riskLevel}`);
    if (riskLevel === "LOW") {
      sections.push(`No frontend dependencies detected. Backend-only change.`);
    } else if (riskLevel === "MEDIUM") {
      sections.push(`${totalFrontendImpact} frontend artifact(s) affected. Verify API contract compatibility.`);
    } else {
      sections.push(`${totalFrontendImpact} frontend artifact(s) affected. High blast radius.`);
    }
    // Show link confidence
    const lowConfLinks = affectedEntities.flatMap((e) => e.links.filter((l) => l.confidence < 0.8));
    if (lowConfLinks.length > 0) {
      sections.push(`⚠ ${lowConfLinks.length} link(s) are fuzzy-matched — verify these connections manually.`);
    }
    sections.push("");

    // ── Section 4: Suggested Approach ──
    sections.push("### Suggested Approach");
    if (riskLevel === "LOW") {
      sections.push("1. Make the change directly");
      sections.push("2. Run `sync_contract` to verify no new mismatches");
    } else if (riskLevel === "MEDIUM") {
      sections.push("1. Check response shape — ensure no breaking changes to API contract");
      sections.push("2. Update frontend API module if endpoint signature changed");
      sections.push("3. Run `sync_contract` to verify");
      sections.push("4. Test affected components manually");
    } else {
      sections.push("1. **Review all affected components** before changing");
      sections.push("2. Consider backward-compatible changes (add fields, don't remove)");
      sections.push("3. Update frontend API modules + stores in same PR");
      sections.push("4. Run `sync_contract` to verify full contract integrity");
      sections.push("5. Test all affected components + stores");
      sections.push("6. `save_memory` the change for future reference");
    }
  } else {
    // ── Frontend target ──
    const targetLower = target.toLowerCase();

    const matchedFeUsages = feUsages.filter(
      (u) =>
        u.filePath.includes(target) ||
        u.module.toLowerCase().includes(targetLower.replace(/\.(js|ts|vue)$/, "")) ||
        u.functionName.toLowerCase() === targetLower
    );

    const matchedStores = stores.filter(
      (s) =>
        s.filePath.includes(target) ||
        s.store.toLowerCase().includes(targetLower.replace(/\.(js|ts)$/, ""))
    );

    const matchedComponents = components.filter(
      (c) =>
        c.filePath.includes(target) ||
        c.component.toLowerCase().includes(targetLower.replace(/\.vue$/, ""))
    );

    // Cross-project: use entity linker to find backend routes
    const beRoutes = affectedEntities.flatMap((e) => e.backend.routes);
    const beControllers = affectedEntities.flatMap((e) => e.backend.controllers);
    const beSchemas = affectedEntities.flatMap((e) => e.backend.schemas);
    const uniqueBeRoutes = [...new Map(beRoutes.map((r) => [`${r.method}:${r.path}`, r])).values()];
    const uniqueBeControllers = [...new Map(beControllers.map((c) => [`${c.controller}:${c.action}`, c])).values()];

    // ── Section 1: What is affected ──
    sections.push("### What is affected");

    if (direction === "both" || direction === "dependencies") {
      sections.push("**Dependencies (this calls):**");

      if (matchedFeUsages.length > 0) {
        sections.push(`- API calls: ${matchedFeUsages.length}`);
        for (const u of matchedFeUsages.slice(0, 15)) {
          sections.push(`  ${u.httpMethod} ${u.urlPattern} (${u.module}.${u.functionName})`);
        }
      }

      if (matchedStores.length > 0) {
        sections.push(`- Store API calls:`);
        for (const s of matchedStores) {
          if (s.apiCalls.length > 0) {
            sections.push(`  ${s.store}.${s.action} → ${s.apiCalls.map((c) => `${c.apiModule}.${c.method}`).join(", ")}`);
          }
        }
      }

      // Backend routes via entity linker (replaces pathOverlap)
      if (uniqueBeRoutes.length > 0) {
        sections.push(`- Backend routes hit (via entity linker):`);
        for (const r of uniqueBeRoutes.slice(0, 10)) {
          const ctrl = uniqueBeControllers.find(
            (c) => c.controller === r.controller && c.action === r.action
          );
          sections.push(`  ${r.method.padEnd(6)} ${r.path} → ${r.controller}.${r.action}${ctrl ? ` (${ctrl.responseType})` : ""}`);
        }
      }

      // Backend schemas connected to this frontend code
      if (beSchemas.length > 0) {
        sections.push(`- Backend schemas:`);
        for (const s of beSchemas.slice(0, 5)) {
          sections.push(`  ${s.tableName} (${s.fields.length} fields, ${s.associations.length} assoc)`);
        }
      }

      sections.push("");
    }

    if (direction === "both" || direction === "dependents") {
      sections.push("**Dependents (who uses this):**");

      if (matchedStores.length > 0) {
        const storeNamesList = matchedStores.map((s) => s.store.toLowerCase());
        const dependentComponents = components.filter((c) =>
          c.storeImports.some((si) => storeNamesList.some((sn) => si.toLowerCase().includes(sn)))
        );
        if (dependentComponents.length > 0) {
          sections.push(`- Components using these stores: ${dependentComponents.length}`);
          for (const c of dependentComponents.slice(0, 15)) {
            sections.push(`  ${c.filePath} (imports: ${c.storeImports.join(", ")})`);
          }
        } else {
          sections.push(`- No dependent components found`);
        }
      } else {
        sections.push(`- No dependent stores/components found`);
      }

      sections.push("");
    }

    // ── Cross-Project Chains ──
    if (affectedEntities.length > 0) {
      sections.push("### Cross-Project Chains");
      for (const entity of affectedEntities.slice(0, 3)) {
        for (const route of entity.backend.routes.slice(0, 2)) {
          const chain = traceRouteChain(entity, route);
          sections.push(`${entity.domain}: ${chain.join(" → ")}`);
        }
      }
      sections.push("");
    }

    // ── Section 2: Why ──
    sections.push("### Why");
    const feWhyParts: string[] = [];
    if (matchedFeUsages.length > 0) feWhyParts.push(`${matchedFeUsages.length} API call(s) may break if endpoint changes`);
    if (matchedStores.length > 0) feWhyParts.push(`${matchedStores.length} store(s) depend on this data`);
    if (matchedComponents.length > 0) feWhyParts.push(`${matchedComponents.length} component(s) consume this`);
    if (uniqueBeRoutes.length > 0) feWhyParts.push(`${uniqueBeRoutes.length} backend route(s) serve this data`);
    sections.push(feWhyParts.length > 0
      ? feWhyParts.join(". ") + "."
      : "No dependency chain detected — changes are isolated."
    );
    sections.push("");

    // ── Section 3: Risk Level ──
    const feTotalImpact = matchedFeUsages.length + matchedStores.length + matchedComponents.length;
    const crossProjectImpact = uniqueBeRoutes.length + beSchemas.length;
    const feRiskLevel = feTotalImpact === 0 && crossProjectImpact === 0
      ? "LOW"
      : (feTotalImpact + crossProjectImpact) < 5
      ? "MEDIUM"
      : "HIGH";

    sections.push(`### Risk Level: ${feRiskLevel}`);
    sections.push(`${feTotalImpact} frontend artifact(s) + ${crossProjectImpact} backend artifact(s) in dependency chain.`);
    sections.push("");

    // ── Section 4: Suggested Approach ──
    sections.push("### Suggested Approach");
    if (feRiskLevel === "LOW") {
      sections.push("1. Make the change directly");
      sections.push("2. Verify no console errors in browser");
    } else {
      sections.push("1. Check all dependent components still render correctly");
      sections.push("2. Verify store state updates propagate to UI");
      if (crossProjectImpact > 0) {
        sections.push("3. Verify backend API contract has not changed (use `sync_contract`)");
        sections.push("4. Check backend schemas and controllers for compatibility");
      } else {
        sections.push("3. Run `sync_contract` if API call signatures changed");
      }
      sections.push(`${crossProjectImpact > 0 ? "5" : "4"}. Test affected views manually`);
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

function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!result[key]) result[key] = [];
    result[key].push(item);
  }
  return result;
}

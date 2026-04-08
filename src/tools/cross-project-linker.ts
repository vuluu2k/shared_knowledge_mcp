/**
 * Cross-Project Linker
 *
 * Builds explicit links between backend (Phoenix) and frontend (Vue) artifacts.
 * Creates unified "entity" maps that show exactly how data flows across projects:
 *
 *   Schema → Context → Controller → Route  ←→  API Module → Store → Component
 *
 * Used by smart_context, analyze_impact, and suggest_plan for accurate
 * cross-project synthesis instead of loose keyword matching.
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

// ── Types ──

export interface RouteEndpointLink {
  /** Backend route */
  route: PhoenixRoute;
  /** Controller action handling this route */
  controller?: ControllerAction;
  /** Frontend API calls that hit this route */
  frontendCalls: ApiEndpointUsage[];
  /** Match confidence: 1 = exact, 0.8 = param-normalized, 0.5 = fuzzy */
  confidence: number;
}

export interface CrossProjectEntity {
  /** Domain name (e.g., "order", "customer") */
  domain: string;
  backend: {
    schemas: EctoSchema[];
    contexts: ContextFunction[];
    controllers: ControllerAction[];
    routes: PhoenixRoute[];
  };
  frontend: {
    apiCalls: ApiEndpointUsage[];
    stores: StoreAction[];
    components: ComponentImport[];
  };
  /** Explicit route↔frontend links */
  links: RouteEndpointLink[];
  /** Gaps: routes/calls with no counterpart */
  gaps: CrossProjectGap[];
}

export interface CrossProjectGap {
  type: "route_no_frontend" | "frontend_no_route" | "store_no_api" | "api_no_store";
  detail: string;
  severity: "error" | "warning" | "info";
  artifact: PhoenixRoute | ApiEndpointUsage | StoreAction;
}

export interface LinkResult {
  /** All explicit route↔frontend links */
  links: RouteEndpointLink[];
  /** Routes with no frontend caller */
  unlinkedRoutes: PhoenixRoute[];
  /** Frontend calls with no backend route */
  unlinkedFrontendCalls: ApiEndpointUsage[];
}

// ── URL normalization (shared logic with diff-engine) ──

function normalizePath(path: string): string {
  return (
    path
      .replace(/^https?:\/\/[^/]+/, "")
      .replace(/:(\w+)/g, ":param")
      .replace(/\$\{[^}]+\}/g, ":param")
      .replace(/\/+/g, "/")
      .replace(/\/$/, "") || "/"
  );
}

function normalizeMethod(method: string): string {
  return method.toUpperCase().replace("PATCH", "PUT");
}

// ── Core linking ──

/**
 * Build explicit links between backend routes and frontend API calls.
 * Uses multi-pass matching: exact → param-normalized → segment-fuzzy.
 */
export function linkRoutesToFrontend(
  routes: PhoenixRoute[],
  controllers: ControllerAction[],
  frontendCalls: ApiEndpointUsage[]
): LinkResult {
  const links: RouteEndpointLink[] = [];
  const matchedRouteIndices = new Set<number>();
  const matchedFrontendIndices = new Set<number>();

  // Index controllers by controller:action
  const controllerMap = new Map<string, ControllerAction>();
  for (const c of controllers) {
    controllerMap.set(`${c.controller}:${c.action}`, c);
  }

  // Pre-normalize all paths
  const normalizedRoutes = routes.map((r) => ({
    route: r,
    normPath: normalizePath(r.path),
    normMethod: normalizeMethod(r.method),
  }));

  const normalizedFeCalls = frontendCalls.map((f) => ({
    call: f,
    normPath: normalizePath(f.urlPattern),
    normMethod: normalizeMethod(f.httpMethod),
  }));

  // Pass 1: Exact match (method + normalized path)
  for (let ri = 0; ri < normalizedRoutes.length; ri++) {
    const nr = normalizedRoutes[ri];
    const matched: ApiEndpointUsage[] = [];

    for (let fi = 0; fi < normalizedFeCalls.length; fi++) {
      if (matchedFrontendIndices.has(fi)) continue;
      const nf = normalizedFeCalls[fi];

      if (nr.normMethod === nf.normMethod && nr.normPath === nf.normPath) {
        matched.push(nf.call);
        matchedFrontendIndices.add(fi);
      }
    }

    if (matched.length > 0) {
      matchedRouteIndices.add(ri);
      links.push({
        route: nr.route,
        controller: controllerMap.get(`${nr.route.controller}:${nr.route.action}`),
        frontendCalls: matched,
        confidence: 1,
      });
    }
  }

  // Pass 2: Param-normalized match (ignore param names)
  for (let ri = 0; ri < normalizedRoutes.length; ri++) {
    if (matchedRouteIndices.has(ri)) continue;
    const nr = normalizedRoutes[ri];
    const routeSegments = nr.normPath.split("/").filter(Boolean);
    const matched: ApiEndpointUsage[] = [];

    for (let fi = 0; fi < normalizedFeCalls.length; fi++) {
      if (matchedFrontendIndices.has(fi)) continue;
      const nf = normalizedFeCalls[fi];

      if (nr.normMethod !== nf.normMethod) continue;

      const feSegments = nf.normPath.split("/").filter(Boolean);
      if (routeSegments.length !== feSegments.length) continue;

      const segmentMatch = routeSegments.every(
        (seg, i) =>
          seg === feSegments[i] ||
          seg === ":param" ||
          feSegments[i] === ":param"
      );

      if (segmentMatch) {
        matched.push(nf.call);
        matchedFrontendIndices.add(fi);
      }
    }

    if (matched.length > 0) {
      matchedRouteIndices.add(ri);
      links.push({
        route: nr.route,
        controller: controllerMap.get(`${nr.route.controller}:${nr.route.action}`),
        frontendCalls: matched,
        confidence: 0.8,
      });
    }
  }

  // Pass 3: Fuzzy match - same static segments (≥3 matching non-param segments)
  for (let ri = 0; ri < normalizedRoutes.length; ri++) {
    if (matchedRouteIndices.has(ri)) continue;
    const nr = normalizedRoutes[ri];
    const routeStatic = nr.normPath
      .split("/")
      .filter((s) => s && s !== ":param" && s.length > 1);

    if (routeStatic.length < 2) continue;

    const matched: ApiEndpointUsage[] = [];

    for (let fi = 0; fi < normalizedFeCalls.length; fi++) {
      if (matchedFrontendIndices.has(fi)) continue;
      const nf = normalizedFeCalls[fi];

      if (nr.normMethod !== nf.normMethod) continue;

      const feStatic = nf.normPath
        .split("/")
        .filter((s) => s && s !== ":param" && s.length > 1);

      // Count overlapping static segments
      const overlap = routeStatic.filter((s) => feStatic.includes(s)).length;
      // Require ≥ 60% of the shorter set to match, minimum 2
      const minRequired = Math.max(2, Math.ceil(Math.min(routeStatic.length, feStatic.length) * 0.6));

      if (overlap >= minRequired) {
        matched.push(nf.call);
        matchedFrontendIndices.add(fi);
      }
    }

    if (matched.length > 0) {
      matchedRouteIndices.add(ri);
      links.push({
        route: nr.route,
        controller: controllerMap.get(`${nr.route.controller}:${nr.route.action}`),
        frontendCalls: matched,
        confidence: 0.5,
      });
    }
  }

  // Collect unlinked
  const unlinkedRoutes = normalizedRoutes
    .filter((_, i) => !matchedRouteIndices.has(i))
    .map((nr) => nr.route);

  const unlinkedFrontendCalls = normalizedFeCalls
    .filter((_, i) => !matchedFrontendIndices.has(i))
    .map((nf) => nf.call);

  return { links, unlinkedRoutes, unlinkedFrontendCalls };
}

// ── Store ↔ API Module linking ──

export interface StoreApiLink {
  store: StoreAction;
  apiModules: string[];
  components: ComponentImport[];
}

/**
 * Link stores to their API modules and consuming components.
 */
export function linkStoresDown(
  stores: StoreAction[],
  components: ComponentImport[]
): StoreApiLink[] {
  return stores.map((store) => {
    const apiModules = [...new Set(store.apiCalls.map((c) => c.apiModule))];
    const storeLower = store.store.toLowerCase();

    const matchedComponents = components.filter((c) =>
      c.storeImports.some((si) => si.toLowerCase().includes(storeLower))
    );

    return { store, apiModules, components: matchedComponents };
  });
}

// ── Entity builder ──

/**
 * Build unified cross-project entities from all parsed data.
 * Groups by domain keyword and links all layers together.
 */
export function buildEntityMap(
  routes: PhoenixRoute[],
  controllers: ControllerAction[],
  schemas: EctoSchema[],
  contexts: ContextFunction[],
  frontendCalls: ApiEndpointUsage[],
  stores: StoreAction[],
  components: ComponentImport[],
  filterKeywords?: string[]
): CrossProjectEntity[] {
  // Step 1: Link routes to frontend
  const linkResult = linkRoutesToFrontend(routes, controllers, frontendCalls);

  // Step 2: Extract domain names from schemas (most reliable)
  const domains = new Map<string, CrossProjectEntity>();

  function getOrCreateEntity(domain: string): CrossProjectEntity {
    if (!domains.has(domain)) {
      domains.set(domain, {
        domain,
        backend: { schemas: [], contexts: [], controllers: [], routes: [] },
        frontend: { apiCalls: [], stores: [], components: [] },
        links: [],
        gaps: [],
      });
    }
    return domains.get(domain)!;
  }

  // Infer domain from table name: "orders" → "order", "loyalty_programs" → "loyalty_program"
  function tableToDomain(table: string): string {
    return table.replace(/s$/, "").replace(/ies$/, "y");
  }

  // Infer domain from controller: "OrderController" → "order"
  function controllerToDomain(ctrl: string): string {
    return ctrl
      .replace(/Controller$/, "")
      .replace(/([A-Z])/g, (m, c, i) => (i === 0 ? c.toLowerCase() : `_${c.toLowerCase()}`))
      .replace(/^_/, "");
  }

  // Infer domain from module name: "orderApi" → "order"
  function moduleToDomain(mod: string): string {
    return mod
      .replace(/Api$/i, "")
      .replace(/([A-Z])/g, (m, c, i) => (i === 0 ? c.toLowerCase() : `_${c.toLowerCase()}`))
      .replace(/^_/, "");
  }

  // Step 3: Populate from schemas
  for (const schema of schemas) {
    const domain = tableToDomain(schema.tableName);
    const entity = getOrCreateEntity(domain);
    entity.backend.schemas.push(schema);
  }

  // Step 4: Populate contexts
  for (const ctx of contexts) {
    const moduleLower = ctx.module.toLowerCase();
    // Find best matching domain
    let bestDomain: string | null = null;
    let bestLen = 0;
    for (const d of domains.keys()) {
      if (moduleLower.includes(d) && d.length > bestLen) {
        bestDomain = d;
        bestLen = d.length;
      }
    }
    if (bestDomain) {
      domains.get(bestDomain)!.backend.contexts.push(ctx);
    } else {
      // Create from module name
      const parts = ctx.module.split(".").pop()?.toLowerCase() || ctx.module;
      const domain = parts.replace(/s$/, "");
      getOrCreateEntity(domain).backend.contexts.push(ctx);
    }
  }

  // Step 5: Populate controllers + routes via links
  for (const link of linkResult.links) {
    const ctrlDomain = controllerToDomain(link.route.controller);
    let bestDomain = ctrlDomain;
    // Prefer existing entity
    if (!domains.has(ctrlDomain)) {
      for (const d of domains.keys()) {
        if (ctrlDomain.includes(d) || d.includes(ctrlDomain)) {
          bestDomain = d;
          break;
        }
      }
    }
    const entity = getOrCreateEntity(bestDomain);
    if (!entity.backend.routes.includes(link.route)) {
      entity.backend.routes.push(link.route);
    }
    if (link.controller && !entity.backend.controllers.includes(link.controller)) {
      entity.backend.controllers.push(link.controller);
    }
    for (const fc of link.frontendCalls) {
      if (!entity.frontend.apiCalls.includes(fc)) {
        entity.frontend.apiCalls.push(fc);
      }
    }
    entity.links.push(link);
  }

  // Add unlinked routes
  for (const route of linkResult.unlinkedRoutes) {
    const ctrlDomain = controllerToDomain(route.controller);
    let bestDomain = ctrlDomain;
    for (const d of domains.keys()) {
      if (ctrlDomain.includes(d) || d.includes(ctrlDomain)) {
        bestDomain = d;
        break;
      }
    }
    const entity = getOrCreateEntity(bestDomain);
    if (!entity.backend.routes.includes(route)) {
      entity.backend.routes.push(route);
    }
    entity.gaps.push({
      type: "route_no_frontend",
      detail: `${route.method} ${route.path} has no frontend caller`,
      severity: "info",
      artifact: route,
    });
  }

  // Add unlinked frontend calls
  for (const call of linkResult.unlinkedFrontendCalls) {
    const modDomain = moduleToDomain(call.module);
    let bestDomain = modDomain;
    for (const d of domains.keys()) {
      if (modDomain.includes(d) || d.includes(modDomain)) {
        bestDomain = d;
        break;
      }
    }
    const entity = getOrCreateEntity(bestDomain);
    if (!entity.frontend.apiCalls.includes(call)) {
      entity.frontend.apiCalls.push(call);
    }
    entity.gaps.push({
      type: "frontend_no_route",
      detail: `${call.httpMethod} ${call.urlPattern} (${call.module}.${call.functionName}) has no backend route`,
      severity: "error",
      artifact: call,
    });
  }

  // Step 6: Populate stores + components
  const storeLinks = linkStoresDown(stores, components);
  for (const sl of storeLinks) {
    // Find entity by API module name
    const apiDomains = sl.apiModules.map(moduleToDomain);
    let bestDomain: string | null = null;
    for (const ad of apiDomains) {
      for (const d of domains.keys()) {
        if (ad.includes(d) || d.includes(ad)) {
          bestDomain = d;
          break;
        }
      }
      if (bestDomain) break;
    }
    // Fallback: try store name
    if (!bestDomain) {
      const storeDomain = sl.store.store.toLowerCase().replace(/store$/i, "").replace(/s$/, "");
      for (const d of domains.keys()) {
        if (storeDomain.includes(d) || d.includes(storeDomain)) {
          bestDomain = d;
          break;
        }
      }
    }
    if (bestDomain) {
      const entity = domains.get(bestDomain)!;
      if (!entity.frontend.stores.some((s) => s.store === sl.store.store && s.action === sl.store.action)) {
        entity.frontend.stores.push(sl.store);
      }
      for (const comp of sl.components) {
        if (!entity.frontend.components.some((c) => c.filePath === comp.filePath)) {
          entity.frontend.components.push(comp);
        }
      }
      // Check store→API gaps
      if (sl.apiModules.length === 0) {
        entity.gaps.push({
          type: "store_no_api",
          detail: `Store ${sl.store.store}.${sl.store.action} has no API calls`,
          severity: "info",
          artifact: sl.store,
        });
      }
    }
  }

  // Step 7: Filter by keywords if provided
  let entities = [...domains.values()];
  if (filterKeywords && filterKeywords.length > 0) {
    entities = entities.filter((e) =>
      filterKeywords.some(
        (kw) =>
          e.domain.includes(kw.toLowerCase()) ||
          kw.toLowerCase().includes(e.domain) ||
          e.backend.schemas.some((s) => s.tableName.toLowerCase().includes(kw.toLowerCase())) ||
          e.backend.routes.some((r) => r.path.toLowerCase().includes(kw.toLowerCase()))
      )
    );
  }

  // Sort: entities with more cross-project links first
  entities.sort((a, b) => {
    const scoreA = a.links.length * 3 + a.frontend.stores.length * 2 + a.frontend.components.length;
    const scoreB = b.links.length * 3 + b.frontend.stores.length * 2 + b.frontend.components.length;
    return scoreB - scoreA;
  });

  return entities;
}

// ── Query helpers ──

/**
 * Find all entities affected by changing a specific file or function.
 */
export function findAffectedEntities(
  entities: CrossProjectEntity[],
  target: string
): CrossProjectEntity[] {
  const targetLower = target.toLowerCase();
  return entities.filter(
    (e) =>
      e.backend.schemas.some((s) => s.filePath.includes(target) || s.tableName.toLowerCase().includes(targetLower)) ||
      e.backend.controllers.some((c) => c.filePath.includes(target) || c.controller.toLowerCase().includes(targetLower)) ||
      e.backend.contexts.some((c) => c.filePath.includes(target) || c.name.toLowerCase().includes(targetLower)) ||
      e.backend.routes.some((r) => r.path.toLowerCase().includes(targetLower)) ||
      e.frontend.apiCalls.some((a) => a.filePath.includes(target) || a.module.toLowerCase().includes(targetLower)) ||
      e.frontend.stores.some((s) => s.filePath.includes(target) || s.store.toLowerCase().includes(targetLower)) ||
      e.frontend.components.some((c) => c.filePath.includes(target))
  );
}

/**
 * Trace the full cross-project chain for a given route.
 * Returns: Schema → Context → Controller → Route → API Call → Store → Component
 */
export function traceRouteChain(
  entity: CrossProjectEntity,
  route: PhoenixRoute
): string[] {
  const chain: string[] = [];

  // Find linked schemas (by controller domain)
  if (entity.backend.schemas.length > 0) {
    chain.push(`Schema(${entity.backend.schemas.map((s) => s.tableName).join(",")})`);
  }

  // Context
  if (entity.backend.contexts.length > 0) {
    const modules = [...new Set(entity.backend.contexts.map((c) => c.module))];
    chain.push(`Context(${modules.join(",")})`);
  }

  // Controller
  chain.push(`Controller(${route.controller}.${route.action})`);

  // Route
  chain.push(`Route(${route.method} ${route.path})`);

  // Find link for this route
  const link = entity.links.find((l) => l.route === route);
  if (link && link.frontendCalls.length > 0) {
    const modules = [...new Set(link.frontendCalls.map((f) => `${f.module}.${f.functionName}`))];
    chain.push(`API(${modules.join(",")})`);
  }

  // Stores
  if (entity.frontend.stores.length > 0) {
    const storeNames = [...new Set(entity.frontend.stores.map((s) => s.store))];
    chain.push(`Store(${storeNames.join(",")})`);
  }

  // Components
  if (entity.frontend.components.length > 0) {
    const compNames = entity.frontend.components.slice(0, 3).map((c) => c.component);
    const suffix = entity.frontend.components.length > 3
      ? ` +${entity.frontend.components.length - 3}`
      : "";
    chain.push(`Component(${compNames.join(",")}${suffix})`);
  }

  return chain;
}

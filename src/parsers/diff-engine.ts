import type {
  PhoenixRoute,
  ControllerAction,
  ApiEndpointUsage,
  ApiContract,
  ContractMismatch,
} from "../types.js";

/**
 * Build a contract map by correlating backend routes with frontend API usage.
 * This is the core diff engine that finds mismatches.
 */
export function buildContractMap(
  routes: PhoenixRoute[],
  actions: ControllerAction[],
  frontendUsages: ApiEndpointUsage[]
): ApiContract[] {
  const contracts: ApiContract[] = [];

  // Index backend routes by normalized path
  const routeMap = new Map<string, PhoenixRoute>();
  for (const route of routes) {
    const key = `${route.method} ${normalizePath(route.path)}`;
    routeMap.set(key, route);
  }

  // Index controller actions by controller+action
  const actionMap = new Map<string, ControllerAction>();
  for (const action of actions) {
    const key = `${action.controller}:${action.action}`;
    actionMap.set(key, action);
  }

  // Group frontend usages by normalized URL
  const frontendMap = new Map<string, ApiEndpointUsage[]>();
  for (const usage of frontendUsages) {
    const normalized = normalizePath(usage.urlPattern);
    const key = `${usage.httpMethod} ${normalized}`;
    const existing = frontendMap.get(key) || [];
    existing.push(usage);
    frontendMap.set(key, existing);
  }

  // 1. Check all backend routes for frontend coverage
  for (const [routeKey, route] of routeMap) {
    const frontendHits = frontendMap.get(routeKey) || [];
    const actionKey = `${route.controller}:${route.action}`;
    const action = actionMap.get(actionKey);

    const mismatches: ContractMismatch[] = [];

    if (frontendHits.length === 0) {
      mismatches.push({
        type: "missing_frontend",
        detail: `Backend route ${route.method} ${route.path} has no frontend usage`,
        severity: "info",
      });
    }

    contracts.push({
      endpoint: route.path,
      method: route.method,
      backendRoute: route,
      backendAction: action,
      frontendUsages: frontendHits,
      mismatches,
    });
  }

  // 2. Check frontend usages that have no backend route
  for (const [feKey, usages] of frontendMap) {
    if (routeMap.has(feKey)) continue;

    // Try fuzzy matching
    const fuzzyMatch = findFuzzyRouteMatch(feKey, routeMap);

    const mismatches: ContractMismatch[] = [];
    if (fuzzyMatch) {
      mismatches.push({
        type: "method_mismatch",
        detail: `Frontend uses ${feKey} but backend has ${fuzzyMatch.method} ${fuzzyMatch.path}`,
        severity: "warning",
      });
    } else {
      mismatches.push({
        type: "missing_backend",
        detail: `Frontend calls ${feKey} but no matching backend route found`,
        severity: "error",
      });
    }

    contracts.push({
      endpoint: usages[0].urlPattern,
      method: usages[0].httpMethod,
      backendRoute: fuzzyMatch || undefined,
      frontendUsages: usages,
      mismatches,
    });
  }

  return contracts;
}

/**
 * Filter contracts to only those with mismatches.
 */
export function findMismatches(
  contracts: ApiContract[],
  severity?: ContractMismatch["severity"]
): ApiContract[] {
  return contracts.filter((c) => {
    if (c.mismatches.length === 0) return false;
    if (severity) {
      return c.mismatches.some((m) => m.severity === severity);
    }
    return true;
  });
}

/**
 * Generate a summary of the contract analysis.
 */
export function generateContractSummary(contracts: ApiContract[]): {
  totalEndpoints: number;
  coveredEndpoints: number;
  missingFrontend: number;
  missingBackend: number;
  methodMismatches: number;
  paramMismatches: number;
} {
  let coveredEndpoints = 0;
  let missingFrontend = 0;
  let missingBackend = 0;
  let methodMismatches = 0;
  let paramMismatches = 0;

  for (const contract of contracts) {
    if (contract.backendRoute && contract.frontendUsages.length > 0) {
      coveredEndpoints++;
    }

    for (const m of contract.mismatches) {
      switch (m.type) {
        case "missing_frontend":
          missingFrontend++;
          break;
        case "missing_backend":
          missingBackend++;
          break;
        case "method_mismatch":
          methodMismatches++;
          break;
        case "param_mismatch":
          paramMismatches++;
          break;
      }
    }
  }

  return {
    totalEndpoints: contracts.length,
    coveredEndpoints,
    missingFrontend,
    missingBackend,
    methodMismatches,
    paramMismatches,
  };
}

// ── Helpers ──

function normalizePath(path: string): string {
  return (
    path
      // Remove host/base prefixes
      .replace(/^https?:\/\/[^/]+/, "")
      // Normalize param segments
      .replace(/:(\w+)/g, ":param")
      .replace(/\$\{[^}]+\}/g, ":param")
      // Clean slashes
      .replace(/\/+/g, "/")
      .replace(/\/$/, "")
      || "/"
  );
}

function findFuzzyRouteMatch(
  feKey: string,
  routeMap: Map<string, PhoenixRoute>
): PhoenixRoute | null {
  const [, fePath] = feKey.split(" ", 2);
  const normalizedFe = normalizePath(fePath);

  for (const [, route] of routeMap) {
    const normalizedBe = normalizePath(route.path);
    if (normalizedFe === normalizedBe) {
      return route;
    }
  }

  // Try matching without param segments
  const feSegments = normalizedFe.split("/").filter(Boolean);
  for (const [, route] of routeMap) {
    const beSegments = normalizePath(route.path).split("/").filter(Boolean);
    if (feSegments.length !== beSegments.length) continue;

    const match = feSegments.every(
      (seg, i) =>
        seg === beSegments[i] ||
        seg === ":param" ||
        beSegments[i] === ":param"
    );
    if (match) return route;
  }

  return null;
}

import { parsePhoenixRoutes } from "../parsers/phoenix-router.js";
import { parsePhoenixControllers } from "../parsers/phoenix-controller.js";
import { parseVueApiModules } from "../parsers/vue-api.js";
import {
  buildContractMap,
  findMismatches,
  generateContractSummary,
} from "../parsers/diff-engine.js";
import type { RepoConfig, ContractMismatch } from "../types.js";

export interface SyncContractArgs {
  /** Only show mismatches of this severity or higher */
  severity?: "error" | "warning" | "info";
  /** Filter by endpoint path (substring match) */
  endpoint_filter?: string;
  /** Only show endpoints with mismatches */
  mismatches_only?: boolean;
}

export async function syncContract(
  config: RepoConfig,
  args: SyncContractArgs
) {
  const [routes, controllers, frontendUsages] = await Promise.all([
    parsePhoenixRoutes(config.backendPath),
    parsePhoenixControllers(config.backendPath),
    parseVueApiModules(config.frontendPath),
  ]);

  // Build full contract map
  let contracts = buildContractMap(routes, controllers, frontendUsages);

  // Apply filters
  if (args.endpoint_filter) {
    contracts = contracts.filter((c) =>
      c.endpoint.includes(args.endpoint_filter!)
    );
  }

  if (args.mismatches_only !== false) {
    contracts = findMismatches(contracts, args.severity);
  }

  const summary = generateContractSummary(contracts);

  return {
    summary,
    contracts: contracts.map((c) => ({
      endpoint: c.endpoint,
      method: c.method,
      hasBackend: !!c.backendRoute,
      hasFrontend: c.frontendUsages.length > 0,
      frontendUsageCount: c.frontendUsages.length,
      mismatches: c.mismatches.map((m: ContractMismatch) => ({
        type: m.type,
        detail: m.detail,
        severity: m.severity,
      })),
      backendDetails: c.backendRoute
        ? {
            controller: c.backendRoute.controller,
            action: c.backendRoute.action,
            pipelines: c.backendRoute.pipelines,
          }
        : null,
      frontendDetails: c.frontendUsages.map((u) => ({
        module: u.module,
        function: u.functionName,
        file: u.filePath,
      })),
    })),
  };
}

import { parseVueApiModules } from "../parsers/vue-api.js";
import { parseVueStores } from "../parsers/vue-store.js";
import type { RepoConfig } from "../types.js";

export interface GetUiRequirementsArgs {
  /** Filter by API module name */
  api_module?: string;
  /** Filter by store name */
  store?: string;
  /** Filter by URL pattern (substring match) */
  url_pattern?: string;
  /** Filter by HTTP method */
  method?: string;
}

export async function getUiRequirements(
  config: RepoConfig,
  args: GetUiRequirementsArgs
) {
  const [apiUsages, storeActions] = await Promise.all([
    parseVueApiModules(config.frontendPath),
    parseVueStores(config.frontendPath),
  ]);

  // Filter API usages
  let filteredUsages = apiUsages;
  if (args.api_module) {
    filteredUsages = filteredUsages.filter((u) =>
      u.module.toLowerCase().includes(args.api_module!.toLowerCase())
    );
  }
  if (args.url_pattern) {
    filteredUsages = filteredUsages.filter((u) =>
      u.urlPattern.includes(args.url_pattern!)
    );
  }
  if (args.method) {
    filteredUsages = filteredUsages.filter(
      (u) => u.httpMethod === args.method!.toUpperCase()
    );
  }

  // Filter store actions
  let filteredStores = storeActions;
  if (args.store) {
    filteredStores = filteredStores.filter((s) =>
      s.store.toLowerCase().includes(args.store!.toLowerCase())
    );
  }

  // Group usages by endpoint
  const endpointMap = new Map<
    string,
    {
      url: string;
      method: string;
      callers: { module: string; function: string; file: string }[];
      responseFields: string[];
    }
  >();

  for (const usage of filteredUsages) {
    const key = `${usage.httpMethod} ${usage.urlPattern}`;
    const existing = endpointMap.get(key) || {
      url: usage.urlPattern,
      method: usage.httpMethod,
      callers: [],
      responseFields: [],
    };
    existing.callers.push({
      module: usage.module,
      function: usage.functionName,
      file: usage.filePath,
    });
    existing.responseFields = [
      ...new Set([...existing.responseFields, ...usage.responseFields]),
    ];
    endpointMap.set(key, existing);
  }

  return {
    totalApiUsages: apiUsages.length,
    filteredUsages: filteredUsages.length,
    endpoints: Array.from(endpointMap.values()),
    stores: filteredStores.map((s) => ({
      store: s.store,
      action: s.action,
      apiCalls: s.apiCalls,
      stateUpdates: s.stateUpdates,
      file: s.filePath,
    })),
  };
}

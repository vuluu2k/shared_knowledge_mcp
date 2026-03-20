import { cachedParse } from "./file-hash-cache.js";
import { parsePhoenixRoutes } from "../parsers/phoenix-router.js";
import { parsePhoenixControllers } from "../parsers/phoenix-controller.js";
import { parsePhoenixSchemas } from "../parsers/phoenix-schema.js";
import { parsePhoenixContexts } from "../parsers/phoenix-context.js";
import { parseVueApiModules } from "../parsers/vue-api.js";
import { parseVueStores } from "../parsers/vue-store.js";
import type {
  PhoenixRoute,
  ControllerAction,
  EctoSchema,
  ContextFunction,
  ApiEndpointUsage,
  StoreAction,
} from "../types.js";

// Re-export filter functions (no caching needed for pure functions)
export { filterRoutes } from "../parsers/phoenix-router.js";
export { filterActions } from "../parsers/phoenix-controller.js";
export { findSchema } from "../parsers/phoenix-schema.js";
export { filterContextFunctions } from "../parsers/phoenix-context.js";
export { buildContractMap, findMismatches, generateContractSummary } from "../parsers/diff-engine.js";

// ── Cached parsers ──

export async function cachedPhoenixRoutes(backendPath: string): Promise<PhoenixRoute[]> {
  const { data } = await cachedParse(
    "lib/builderx_api_web/router/*.ex",
    backendPath,
    () => parsePhoenixRoutes(backendPath)
  );
  return data;
}

export async function cachedPhoenixControllers(backendPath: string): Promise<ControllerAction[]> {
  const { data } = await cachedParse(
    "lib/builderx_api_web/controllers/v1/**/*_controller.ex",
    backendPath,
    () => parsePhoenixControllers(backendPath)
  );
  return data;
}

export async function cachedPhoenixSchemas(backendPath: string): Promise<EctoSchema[]> {
  const { data } = await cachedParse(
    "lib/builderx_api/**/*.ex",
    backendPath,
    () => parsePhoenixSchemas(backendPath)
  );
  return data;
}

export async function cachedPhoenixContexts(backendPath: string): Promise<ContextFunction[]> {
  const { data } = await cachedParse(
    "lib/builderx_api/**/*.ex",
    backendPath,
    () => parsePhoenixContexts(backendPath)
  );
  return data;
}

export async function cachedVueApiModules(frontendPath: string): Promise<ApiEndpointUsage[]> {
  const { data } = await cachedParse(
    "src/{api,views,components,stores}/**/*.{js,ts,vue}",
    frontendPath,
    () => parseVueApiModules(frontendPath)
  );
  return data;
}

export async function cachedVueStores(frontendPath: string): Promise<StoreAction[]> {
  const { data } = await cachedParse(
    "src/stores/**/*.{js,ts}",
    frontendPath,
    () => parseVueStores(frontendPath)
  );
  return data;
}

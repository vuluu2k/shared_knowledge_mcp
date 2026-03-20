import { parsePhoenixRoutes, filterRoutes } from "../parsers/phoenix-router.js";
import {
  parsePhoenixControllers,
  filterActions,
} from "../parsers/phoenix-controller.js";
import { parsePhoenixSchemas, findSchema } from "../parsers/phoenix-schema.js";
import {
  parsePhoenixContexts,
  filterContextFunctions,
} from "../parsers/phoenix-context.js";
import type { RepoConfig } from "../types.js";

export interface GetApiSchemaArgs {
  /** Filter by path prefix, e.g. "/api/v1/dashboard" */
  path_prefix?: string;
  /** Filter by HTTP method */
  method?: string;
  /** Filter by controller name */
  controller?: string;
  /** Filter by pipeline */
  pipeline?: string;
  /** Include schema details for matched controllers */
  include_schemas?: boolean;
  /** Include context function signatures */
  include_context?: boolean;
}

export async function getApiSchema(
  config: RepoConfig,
  args: GetApiSchemaArgs
) {
  const [routes, controllers, schemas, contexts] = await Promise.all([
    parsePhoenixRoutes(config.backendPath),
    parsePhoenixControllers(config.backendPath),
    args.include_schemas !== false
      ? parsePhoenixSchemas(config.backendPath)
      : Promise.resolve([]),
    args.include_context
      ? parsePhoenixContexts(config.backendPath)
      : Promise.resolve([]),
  ]);

  // Apply filters
  const filteredRoutes = filterRoutes(routes, {
    pathPrefix: args.path_prefix,
    method: args.method,
    controller: args.controller,
    pipeline: args.pipeline,
  });

  // Match routes with controller actions
  const endpoints = filteredRoutes.map((route) => {
    const matchedActions = filterActions(controllers, {
      controller: route.controller.split(".").pop(),
      action: route.action,
    });

    const action = matchedActions[0];

    // Find related schema
    const controllerDomain = route.controller
      .replace("Controller", "")
      .split(".")
      .pop()
      ?.toLowerCase();
    const relatedSchema = controllerDomain
      ? findSchema(schemas, controllerDomain)
      : undefined;

    // Find related context functions
    const relatedContext = controllerDomain
      ? filterContextFunctions(contexts, { module: controllerDomain })
      : [];

    return {
      route: {
        method: route.method,
        path: route.path,
        pipelines: route.pipelines,
      },
      controller: route.controller,
      action: route.action,
      params: action?.params || [],
      responseType: action?.responseType || "unknown",
      plugs: action?.plugs || [],
      schema: relatedSchema
        ? {
            table: relatedSchema.tableName,
            fields: relatedSchema.fields,
            associations: relatedSchema.associations,
            jsonFields: relatedSchema.jsonFields,
          }
        : undefined,
      contextFunctions: relatedContext.map((f) => ({
        name: f.name,
        arity: f.arity,
        hasSiteId: f.hasSiteId,
        repo: f.repo,
      })),
    };
  });

  return {
    totalRoutes: routes.length,
    filteredCount: endpoints.length,
    endpoints,
  };
}

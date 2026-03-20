import { parsePhoenixRoutes, filterRoutes } from "../parsers/phoenix-router.js";
import {
  parsePhoenixControllers,
  filterActions,
} from "../parsers/phoenix-controller.js";
import { parsePhoenixSchemas, findSchema } from "../parsers/phoenix-schema.js";
import type { RepoConfig, PhoenixRoute, ControllerAction } from "../types.js";

export interface GenerateClientArgs {
  /** Filter by path prefix */
  path_prefix?: string;
  /** Filter by controller name */
  controller?: string;
  /** Output format: "typescript" | "javascript" */
  format?: "typescript" | "javascript";
  /** Generate as Vue composable (useXxxApi) or plain class */
  style?: "composable" | "class";
}

export async function generateClient(
  config: RepoConfig,
  args: GenerateClientArgs
) {
  const [routes, controllers, schemas] = await Promise.all([
    parsePhoenixRoutes(config.backendPath),
    parsePhoenixControllers(config.backendPath),
    parsePhoenixSchemas(config.backendPath),
  ]);

  const filteredRoutes = filterRoutes(routes, {
    pathPrefix: args.path_prefix,
    controller: args.controller,
  });

  const format = args.format || "typescript";
  const style = args.style || "class";

  // Group routes by controller
  const controllerGroups = new Map<string, PhoenixRoute[]>();
  for (const route of filteredRoutes) {
    const ctrl = route.controller.split(".").pop() || route.controller;
    const existing = controllerGroups.get(ctrl) || [];
    existing.push(route);
    controllerGroups.set(ctrl, existing);
  }

  const generatedFiles: { filename: string; content: string }[] = [];

  // Generate types file
  if (format === "typescript") {
    const typesContent = generateTypes(filteredRoutes, controllers, schemas);
    generatedFiles.push({ filename: "api-types.ts", content: typesContent });
  }

  // Generate client files per controller
  for (const [ctrlName, ctrlRoutes] of controllerGroups) {
    const content =
      style === "composable"
        ? generateComposableClient(ctrlName, ctrlRoutes, controllers, format)
        : generateClassClient(ctrlName, ctrlRoutes, controllers, format);

    const ext = format === "typescript" ? "ts" : "js";
    const filename = `${camelToKebab(ctrlName.replace("Controller", ""))}Api.${ext}`;
    generatedFiles.push({ filename, content });
  }

  return {
    totalEndpoints: filteredRoutes.length,
    filesGenerated: generatedFiles.length,
    files: generatedFiles,
  };
}

function generateTypes(
  routes: PhoenixRoute[],
  controllers: ControllerAction[],
  schemas: ReturnType<typeof parsePhoenixSchemas> extends Promise<infer T>
    ? T
    : never
): string {
  const lines: string[] = [
    "// Auto-generated API types from Phoenix backend",
    "// Do not edit manually",
    "",
  ];

  // Generate response types from schemas
  const seenSchemas = new Set<string>();
  for (const route of routes) {
    const domain = route.controller
      .replace("Controller", "")
      .split(".")
      .pop()
      ?.toLowerCase();
    if (!domain || seenSchemas.has(domain)) continue;
    seenSchemas.add(domain);

    const schema = findSchema(schemas, domain);
    if (!schema) continue;

    const typeName = pascalCase(domain);
    lines.push(`export interface ${typeName} {`);
    for (const field of schema.fields) {
      if (schema.privateFields.includes(field.name)) continue;
      const tsType = elixirTypeToTs(field.type);
      lines.push(`  ${field.name}: ${tsType};`);
    }
    lines.push(`}`);
    lines.push("");
  }

  // Generate response wrapper types
  lines.push("export interface ApiSuccessResponse<T = unknown> {");
  lines.push("  success: true;");
  lines.push("  data?: T;");
  lines.push("  [key: string]: unknown;");
  lines.push("}");
  lines.push("");
  lines.push("export interface ApiErrorResponse {");
  lines.push("  success: false;");
  lines.push("  reason?: { message_code: number; message: string };");
  lines.push("  code?: number;");
  lines.push("}");
  lines.push("");
  lines.push(
    "export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;"
  );
  lines.push("");

  return lines.join("\n");
}

function generateClassClient(
  ctrlName: string,
  routes: PhoenixRoute[],
  controllers: ControllerAction[],
  format: string
): string {
  const className = ctrlName.replace("Controller", "") + "Api";
  const isTs = format === "typescript";
  const lines: string[] = [];

  lines.push(
    `// Auto-generated API client for ${ctrlName}`
  );
  lines.push(`import BaseApi from './baseApi'${isTs ? "" : ""}`);
  if (isTs) {
    lines.push(`import type { ApiResponse } from './api-types'`);
  }
  lines.push("");
  lines.push(`class ${className} extends BaseApi {`);
  lines.push(`  constructor() {`);

  // Infer controller name from routes
  const controllerPath = inferControllerPath(routes);
  lines.push(`    super()`);
  lines.push(`    this.controller = '${controllerPath}'`);
  lines.push(`    this.v1 = true`);
  lines.push(`  }`);
  lines.push("");

  for (const route of routes) {
    const action = filterActions(controllers, {
      controller: ctrlName.split(".").pop(),
      action: route.action,
    })[0];

    const methodName = routeToMethodName(route);
    const params = action?.params || [];
    const bodyParams = params.filter((p) => p.source === "body");
    const pathParams = params.filter((p) => p.source === "path");

    // Build function signature
    const sigParams: string[] = [];
    if (pathParams.length > 0) {
      for (const p of pathParams) {
        if (p.name === "site_id") continue; // handled by BaseApi
        sigParams.push(isTs ? `${p.name}: string` : p.name);
      }
    }
    if (bodyParams.length > 0 || route.method === "POST") {
      sigParams.push(isTs ? `params: Record<string, unknown>` : "params");
    }

    const returnType = isTs ? `: Promise<ApiResponse>` : "";

    lines.push(
      `  async ${methodName}(${sigParams.join(", ")})${returnType} {`
    );

    const httpMethod = route.method.toLowerCase();
    const actionPath = routeToActionPath(route, controllerPath);

    if (httpMethod === "get") {
      lines.push(
        `    return this.axios.get(this.getUrl(${bodyParams.length > 0 || sigParams.includes("params") ? "params" : "{}"}, { path: '${actionPath}' })${sigParams.includes("params") ? ", { params }" : ""})`
      );
    } else {
      lines.push(
        `    return this.axios.post(this.getUrl(${sigParams.includes("params") ? "params" : "{}"}, { path: '${actionPath}' }), ${sigParams.includes("params") ? "params" : "{}"})`
      );
    }

    lines.push(`  }`);
    lines.push("");
  }

  lines.push(`}`);
  lines.push("");
  lines.push(`export default new ${className}()`);

  return lines.join("\n");
}

function generateComposableClient(
  ctrlName: string,
  routes: PhoenixRoute[],
  controllers: ControllerAction[],
  format: string
): string {
  const composableName = `use${ctrlName.replace("Controller", "")}Api`;
  const isTs = format === "typescript";
  const lines: string[] = [];

  lines.push(
    `// Auto-generated composable API client for ${ctrlName}`
  );
  lines.push(`import { useApiget, useApipost } from '@/composable/fetch'`);
  if (isTs) {
    lines.push(`import type { ApiResponse } from './api-types'`);
  }
  lines.push("");

  const controllerPath = inferControllerPath(routes);

  lines.push(`export function ${composableName}(siteId${isTs ? ": string" : ""}) {`);
  lines.push(`  const baseUrl = \`\${import.meta.env.VITE_BUILDERX_API_URL}/api/v1/site/\${siteId}/${controllerPath}\``);
  lines.push("");

  for (const route of routes) {
    const action = filterActions(controllers, {
      controller: ctrlName.split(".").pop(),
      action: route.action,
    })[0];

    const methodName = routeToMethodName(route);
    const actionPath = routeToActionPath(route, controllerPath);
    const returnType = isTs ? `: Promise<ApiResponse>` : "";

    if (route.method === "GET") {
      lines.push(
        `  async function ${methodName}(params${isTs ? ": Record<string, unknown> = {}" : " = {}"})${returnType} {`
      );
      lines.push(
        `    return useApiget(\`\${baseUrl}${actionPath}\`, params)`
      );
    } else {
      lines.push(
        `  async function ${methodName}(body${isTs ? ": Record<string, unknown> = {}" : " = {}"})${returnType} {`
      );
      lines.push(
        `    return useApipost(\`\${baseUrl}${actionPath}\`, null, body)`
      );
    }
    lines.push(`  }`);
    lines.push("");
  }

  lines.push(`  return {`);
  for (const route of routes) {
    const methodName = routeToMethodName(route);
    lines.push(`    ${methodName},`);
  }
  lines.push(`  }`);
  lines.push(`}`);

  return lines.join("\n");
}

// ── Helpers ──

function routeToMethodName(route: PhoenixRoute): string {
  const action = route.action;
  const method = route.method.toLowerCase();

  // Map common actions
  if (action === "index" || action === "all") return "getAll";
  if (action === "show" || action === "edit") return "getById";
  if (action === "create") return "create";
  if (action === "update") return "update";
  if (action === "delete") return "remove";

  // Use action name directly
  return action;
}

function routeToActionPath(
  route: PhoenixRoute,
  controllerPath: string
): string {
  let path = route.path;
  // Remove everything up to and including the controller path
  const ctrlIdx = path.indexOf(controllerPath);
  if (ctrlIdx >= 0) {
    path = path.slice(ctrlIdx + controllerPath.length);
  }
  // Convert :param to ${param}
  path = path.replace(/:(\w+)/g, "${$1}");
  return path || "";
}

function inferControllerPath(routes: PhoenixRoute[]): string {
  if (routes.length === 0) return "";
  const firstPath = routes[0].path;
  const segments = firstPath.split("/").filter(Boolean);
  // Find the controller segment (usually after site/:site_id/)
  for (let i = segments.length - 1; i >= 0; i--) {
    if (!segments[i].startsWith(":") && !["api", "v1", "site", "dashboard"].includes(segments[i])) {
      return segments[i];
    }
  }
  return segments[segments.length - 1] || "";
}

function elixirTypeToTs(elixirType: string): string {
  const typeMap: Record<string, string> = {
    ":string": "string",
    ":integer": "number",
    ":float": "number",
    ":boolean": "boolean",
    ":map": "Record<string, unknown>",
    ":date": "string",
    ":utc_datetime": "string",
    ":naive_datetime": "string",
    ":binary_id": "string",
    "Ecto.UUID": "string",
    ":id": "number",
  };

  if (elixirType.includes("{:array,")) {
    const inner = elixirType.match(/\{:array,\s*(.+)\}/)?.[1] || ":string";
    return `${elixirTypeToTs(inner)}[]`;
  }

  return typeMap[elixirType] || "unknown";
}

function camelToKebab(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .toLowerCase();
}

function pascalCase(str: string): string {
  return str
    .split(/[-_]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
}

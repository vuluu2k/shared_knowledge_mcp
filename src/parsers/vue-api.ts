import { readFileSync } from "fs";
import { glob } from "glob";
import type { ApiEndpointUsage } from "../types.js";

/**
 * Parse Vue API modules to extract endpoint usage.
 * Handles both BaseApi class modules and composable fetch calls.
 */
export async function parseVueApiModules(
  frontendPath: string
): Promise<ApiEndpointUsage[]> {
  const usages: ApiEndpointUsage[] = [];

  // 1. Parse API module files (class-based, extending BaseApi)
  const apiFiles = await glob("src/api/**/*.{js,ts}", {
    cwd: frontendPath,
    absolute: true,
  });

  for (const file of apiFiles) {
    const content = readFileSync(file, "utf-8");
    const parsed = extractApiModuleUsage(content, file);
    usages.push(...parsed);
  }

  // 2. Parse direct useApiget/useApipost calls in components and stores
  const componentFiles = await glob(
    "src/{views,components,stores}/**/*.{vue,js,ts}",
    { cwd: frontendPath, absolute: true }
  );

  for (const file of componentFiles) {
    const content = readFileSync(file, "utf-8");
    const parsed = extractComposableUsage(content, file);
    usages.push(...parsed);
  }

  return usages;
}

/**
 * Extract API calls from class-based API modules.
 * Pattern: class XxxApi extends BaseApi { method(params) { return this.axios.get/post(...) } }
 */
function extractApiModuleUsage(
  content: string,
  filePath: string
): ApiEndpointUsage[] {
  const usages: ApiEndpointUsage[] = [];
  const lines = content.split("\n");

  // Detect module/class name
  const classMatch = content.match(/class\s+(\w+)\s+extends\s+BaseApi/);
  const moduleName = classMatch?.[1] ?? extractModuleName(filePath);

  // Detect controller name from constructor
  const controllerMatch = content.match(
    /this\.controller\s*=\s*['"](\w+)['"]/
  );
  const controller = controllerMatch?.[1] ?? "";

  // Detect base URL prefix
  const prefixMatch = content.match(
    /this\.prefix\s*=\s*['"]([^'"]+)['"]/
  );
  const prefix = prefixMatch?.[1] ?? "/api/v1/";

  // Detect if v1 flag is set
  const v1Flag = content.includes("this.v1 = true") || content.includes("this.v1=true");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Match method definitions with axios calls
    // Pattern: async methodName(params) { ... this.axios.get/post(url, ...) }
    const methodMatch = line.match(
      /(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*\{/
    );
    if (!methodMatch) continue;
    if (["constructor", "getUrl"].includes(methodMatch[1])) continue;

    const functionName = methodMatch[1];
    const paramStr = methodMatch[2];

    // Scan method body for HTTP calls
    const bodyEnd = findMethodEnd(lines, i);
    const body = lines.slice(i, bodyEnd).join("\n");

    // Match this.axios.get/post calls
    const axiosCallRegex =
      /this\.axios\.(get|post|put|patch|delete)\s*\(\s*(?:this\.getUrl\([^)]*(?:path:\s*['"]([^'"]*)['"]\s*)?[^)]*\)|['"`]([^'"`]+)['"`])/g;

    let axiosMatch: RegExpExecArray | null;
    while ((axiosMatch = axiosCallRegex.exec(body)) !== null) {
      const httpMethod = axiosMatch[1].toUpperCase();
      const pathFromGetUrl = axiosMatch[2] || "";
      const directUrl = axiosMatch[3] || "";

      let urlPattern: string;
      if (directUrl) {
        urlPattern = directUrl;
      } else {
        // Reconstruct from getUrl
        const basePath = v1Flag ? `/api/v1` : prefix;
        urlPattern = `${basePath}/${controller}${pathFromGetUrl ? "/" + pathFromGetUrl.replace(/^\//, "") : ""}`;
      }

      // Extract response field accesses
      const responseFields = extractResponseFields(body);

      usages.push({
        module: moduleName,
        method: functionName,
        functionName,
        httpMethod,
        urlPattern: normalizeUrl(urlPattern),
        params: extractParamNames(paramStr),
        responseFields,
        filePath,
        lineNumber: i + 1,
      });
    }

    // Match return this.list(), this.create(), etc. (BaseApi methods)
    const baseApiCallMatch = body.match(
      /return\s+this\.(list|getById|create|update|delete)\s*\(/
    );
    if (baseApiCallMatch && !axiosCallRegex.exec(body)) {
      const baseMethod = baseApiCallMatch[1];
      const httpMethodMap: Record<string, string> = {
        list: "GET",
        getById: "GET",
        create: "POST",
        update: "POST",
        delete: "POST",
      };

      const pathMap: Record<string, string> = {
        list: "/all",
        getById: "",
        create: "/create",
        update: "/edit",
        delete: "/delete",
      };

      const basePath = v1Flag ? `/api/v1` : prefix;
      usages.push({
        module: moduleName,
        method: functionName,
        functionName,
        httpMethod: httpMethodMap[baseMethod] || "GET",
        urlPattern: normalizeUrl(
          `${basePath}/${controller}${pathMap[baseMethod] || ""}`
        ),
        params: extractParamNames(paramStr),
        responseFields: [],
        filePath,
        lineNumber: i + 1,
      });
    }
  }

  return usages;
}

/**
 * Extract direct useApiget/useApipost calls from components and stores.
 */
function extractComposableUsage(
  content: string,
  filePath: string
): ApiEndpointUsage[] {
  const usages: ApiEndpointUsage[] = [];

  // Skip API module files (already parsed)
  if (filePath.includes("/api/")) return [];

  const lines = content.split("\n");
  const moduleName = extractModuleName(filePath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match useApiget(url, ...) or useApipost(url, ...) patterns
    const composableMatch = line.match(
      /useApi(get|post|Delete)\s*\(\s*(?:['"`]([^'"`]+)['"`]|`([^`]+)`|(\w+))/
    );
    if (!composableMatch) continue;

    const [, method, directUrl, templateUrl, varUrl] = composableMatch;
    const httpMethod = method === "Delete" ? "DELETE" : method.toUpperCase();

    let urlPattern = directUrl || templateUrl || "";

    // Handle template literals with ${} interpolation
    if (templateUrl) {
      urlPattern = templateUrl.replace(/\$\{[^}]+\}/g, (match) => {
        if (match.includes("site_id") || match.includes("siteId"))
          return ":site_id";
        if (match.includes("page_id") || match.includes("pageId"))
          return ":page_id";
        if (match.includes("id")) return ":id";
        if (match.includes("host") || match.includes("HOST") || match.includes("VITE_"))
          return "";
        return ":param";
      });
    }

    // Handle variable URLs - try to resolve from nearby lines
    if (varUrl && !urlPattern) {
      const urlDefRegex = new RegExp(
        `(?:const|let|var)\\s+${varUrl}\\s*=\\s*\`([^\`]+)\``
      );
      const urlDefMatch = content.match(urlDefRegex);
      if (urlDefMatch) {
        urlPattern = urlDefMatch[1].replace(
          /\$\{[^}]+\}/g,
          (match) => {
            if (match.includes("site_id") || match.includes("siteId"))
              return ":site_id";
            if (match.includes("host") || match.includes("HOST") || match.includes("VITE_"))
              return "";
            if (match.includes("id")) return ":id";
            return ":param";
          }
        );
      }
    }

    // Extract the function context
    let enclosingFunction = "anonymous";
    for (let j = i - 1; j >= Math.max(0, i - 20); j--) {
      const prevLine = lines[j].trim();
      const fnMatch = prevLine.match(
        /(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/
      );
      if (fnMatch) {
        enclosingFunction = fnMatch[1];
        break;
      }
    }

    usages.push({
      module: moduleName,
      method: enclosingFunction,
      functionName: `useApi${method}`,
      httpMethod,
      urlPattern: normalizeUrl(urlPattern),
      params: [],
      responseFields: extractResponseFieldsFromContext(lines, i),
      filePath,
      lineNumber: i + 1,
    });
  }

  return usages;
}

function extractParamNames(paramStr: string): string[] {
  return paramStr
    .split(",")
    .map((p) => p.trim().replace(/\s*=\s*.+$/, ""))
    .filter((p) => p && p !== "");
}

function extractResponseFields(body: string): string[] {
  const fields: string[] = [];
  const fieldAccess =
    /(?:res|response|data)\.(?:data\.)?(\w+)/g;
  let match: RegExpExecArray | null;
  const seen = new Set<string>();

  while ((match = fieldAccess.exec(body)) !== null) {
    const field = match[1];
    if (
      !seen.has(field) &&
      !["status", "statusText", "headers", "config", "request"].includes(
        field
      )
    ) {
      seen.add(field);
      fields.push(field);
    }
  }

  return fields;
}

function extractResponseFieldsFromContext(
  lines: string[],
  startLine: number
): string[] {
  // Look at lines after the API call for response field usage
  const contextLines = lines
    .slice(startLine, Math.min(startLine + 15, lines.length))
    .join("\n");
  return extractResponseFields(contextLines);
}

function findMethodEnd(lines: string[], startLine: number): number {
  let depth = 0;
  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === "{") depth++;
      if (ch === "}") {
        depth--;
        if (depth <= 0) return i + 1;
      }
    }
  }
  return Math.min(startLine + 50, lines.length);
}

function extractModuleName(filePath: string): string {
  const parts = filePath.split("/");
  const fileName = parts[parts.length - 1];
  return fileName.replace(/\.(js|ts|vue)$/, "");
}

function normalizeUrl(url: string): string {
  return url
    .replace(/\/+/g, "/")
    .replace(/^\//, "/")
    .replace(/\/$/, "")
    .replace(/^(?!\/)/, "/");
}

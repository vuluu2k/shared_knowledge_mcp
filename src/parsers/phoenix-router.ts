import { readFileSync } from "fs";
import { glob } from "glob";
import { join } from "path";
import type { PhoenixRoute } from "../types.js";

/**
 * Parse all Phoenix router files and extract route definitions.
 */
export async function parsePhoenixRoutes(
  backendPath: string
): Promise<PhoenixRoute[]> {
  const routerFiles = await glob("lib/builderx_api_web/router/*.ex", {
    cwd: backendPath,
    absolute: true,
  });

  const routes: PhoenixRoute[] = [];

  for (const file of routerFiles) {
    const content = readFileSync(file, "utf-8");
    const parsed = extractRoutes(content, file);
    routes.push(...parsed);
  }

  return routes;
}

interface ScopeFrame {
  path: string;
  alias: string;
  pipelines: string[];
}

function extractRoutes(content: string, _filePath: string): PhoenixRoute[] {
  const routes: PhoenixRoute[] = [];
  const lines = content.split("\n");

  const scopeStack: ScopeFrame[] = [
    { path: "", alias: "", pipelines: [] },
  ];

  let braceDepth = 0;
  const scopeAtDepth: Map<number, ScopeFrame> = new Map();

  for (const line of lines) {
    const trimmed = line.trim();

    // Track pipe_through for current scope
    const pipeMatch = trimmed.match(
      /pipe_through\s+\[?([:"\w,\s]+)\]?/
    );
    if (pipeMatch) {
      const pipelines = pipeMatch[1]
        .split(",")
        .map((p) => p.trim().replace(/^:/, "").replace(/"/g, ""))
        .filter(Boolean);
      const current = scopeStack[scopeStack.length - 1];
      current.pipelines = [...current.pipelines, ...pipelines];
    }

    // Track scope blocks
    const scopeMatch = trimmed.match(
      /scope\s+"([^"]*)"(?:\s*,\s*(\w+))?\s+do/
    );
    if (scopeMatch) {
      const parent = scopeStack[scopeStack.length - 1];
      const scopePath = scopeMatch[1];
      const scopeAlias = scopeMatch[2] || "";
      const newScope: ScopeFrame = {
        path: parent.path + scopePath,
        alias: scopeAlias || parent.alias,
        pipelines: [...parent.pipelines],
      };
      braceDepth++;
      scopeStack.push(newScope);
      scopeAtDepth.set(braceDepth, newScope);
    }

    // Detect scope with pipe_through inline
    const scopePipeMatch = trimmed.match(
      /scope\s+"([^"]*)"(?:\s*,\s*(\w+))?\s*do/
    );
    // Already handled above

    // Track do/end blocks for scope nesting
    if (trimmed === "end" && scopeStack.length > 1) {
      const popped = scopeAtDepth.get(braceDepth);
      if (popped) {
        scopeStack.pop();
        scopeAtDepth.delete(braceDepth);
        braceDepth--;
      }
    }

    // Match route definitions: get, post, put, patch, delete, resources
    const routeMatch = trimmed.match(
      /^(get|post|put|patch|delete|options|head)\s+"([^"]+)"\s*,\s*(\w+)\s*,\s*:(\w+)/
    );
    if (routeMatch) {
      const current = scopeStack[scopeStack.length - 1];
      const [, method, path, controller, action] = routeMatch;
      routes.push({
        method: method.toUpperCase(),
        path: current.path + path,
        controller: current.alias
          ? `${current.alias}.${controller}`
          : controller,
        action,
        pipelines: [...current.pipelines],
        scope: current.path,
      });
      continue;
    }

    // Match resources
    const resourceMatch = trimmed.match(
      /resources\s+"([^"]+)"\s*,\s*(\w+)(?:\s*,\s*only:\s*\[([^\]]+)\])?/
    );
    if (resourceMatch) {
      const current = scopeStack[scopeStack.length - 1];
      const [, path, controller, onlyStr] = resourceMatch;
      const only = onlyStr
        ? onlyStr
            .split(",")
            .map((a) => a.trim().replace(/^:/, ""))
        : ["index", "show", "create", "update", "delete"];

      const resourceRoutes: Record<string, { method: string; suffix: string }> =
        {
          index: { method: "GET", suffix: "" },
          show: { method: "GET", suffix: "/:id" },
          create: { method: "POST", suffix: "" },
          update: { method: "PUT", suffix: "/:id" },
          delete: { method: "DELETE", suffix: "/:id" },
        };

      for (const action of only) {
        const r = resourceRoutes[action];
        if (r) {
          routes.push({
            method: r.method,
            path: current.path + path + r.suffix,
            controller: current.alias
              ? `${current.alias}.${controller}`
              : controller,
            action,
            pipelines: [...current.pipelines],
            scope: current.path,
          });
        }
      }
    }
  }

  return routes;
}

/**
 * Filter routes by path prefix, method, or controller.
 */
export function filterRoutes(
  routes: PhoenixRoute[],
  filters: {
    pathPrefix?: string;
    method?: string;
    controller?: string;
    pipeline?: string;
  }
): PhoenixRoute[] {
  return routes.filter((r) => {
    if (filters.pathPrefix && !r.path.startsWith(filters.pathPrefix))
      return false;
    if (
      filters.method &&
      r.method.toUpperCase() !== filters.method.toUpperCase()
    )
      return false;
    if (
      filters.controller &&
      !r.controller.toLowerCase().includes(filters.controller.toLowerCase())
    )
      return false;
    if (filters.pipeline && !r.pipelines.includes(filters.pipeline))
      return false;
    return true;
  });
}

import { readFileSync } from "fs";
import { glob } from "glob";
import type { ContextFunction } from "../types.js";

/**
 * Parse Phoenix context modules and extract public function signatures.
 */
export async function parsePhoenixContexts(
  backendPath: string
): Promise<ContextFunction[]> {
  // Context modules are typically at lib/builderx_api/{domain}/{domain}s.ex
  // or lib/builderx_api/{domain}.ex
  const contextFiles = await glob(
    "lib/builderx_api/**/*.ex",
    { cwd: backendPath, absolute: true }
  );

  const functions: ContextFunction[] = [];

  for (const file of contextFiles) {
    const content = readFileSync(file, "utf-8");
    // Context modules typically import Ecto.Query and alias Repo
    if (
      !content.includes("import Ecto.Query") &&
      !content.includes("Ecto.Query")
    )
      continue;
    // Skip schema files (they have `schema "table_name"`)
    if (content.match(/schema\s+"/)) continue;

    const parsed = extractContextFunctions(content, file);
    functions.push(...parsed);
  }

  return functions;
}

function extractContextFunctions(
  content: string,
  filePath: string
): ContextFunction[] {
  const functions: ContextFunction[] = [];
  const lines = content.split("\n");

  // Module name
  const moduleMatch = content.match(/defmodule\s+([\w.]+)\s+do/);
  if (!moduleMatch) return [];
  const moduleName = moduleMatch[1];

  // Detect which repo is aliased/used
  let repo = "unknown";
  if (content.includes("alias BuilderxApi.Citus, as: Repo") || content.includes("BuilderxApi.Citus"))
    repo = "Citus";
  else if (content.includes("BuilderxApi.CitusCoord")) repo = "CitusCoord";
  else if (content.includes("BuilderxApi.Repo")) repo = "Repo";
  else if (content.includes("BuilderxApi.MongoRepo")) repo = "MongoRepo";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Match public function definitions
    // def function_name(arg1, arg2, ...) do
    const defMatch = line.match(
      /^def\s+(\w+)\(([^)]*)\)(?:\s+do|\s+when\b|\s*,)/
    );
    if (!defMatch) {
      // Also match: def function_name(arg1, arg2) do
      const defMatch2 = line.match(/^def\s+(\w+)\(([^)]*)\)\s+do/);
      if (!defMatch2) continue;
      const [, name, argsStr] = defMatch2;
      const args = argsStr
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);
      const hasSiteId =
        args[0]?.includes("site_id") ||
        argsStr.includes("site_id");

      functions.push({
        module: moduleName,
        name,
        arity: args.length,
        hasSiteId,
        repo,
        filePath,
        lineNumber: i + 1,
      });
      continue;
    }

    const [, name, argsStr] = defMatch;
    if (name.startsWith("_")) continue;

    const args = argsStr
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
    const hasSiteId =
      args[0]?.includes("site_id") || argsStr.includes("site_id");

    functions.push({
      module: moduleName,
      name,
      arity: args.length,
      hasSiteId,
      repo,
      filePath,
      lineNumber: i + 1,
    });
  }

  return functions;
}

/**
 * Filter context functions by module or function name.
 */
export function filterContextFunctions(
  functions: ContextFunction[],
  filters: { module?: string; name?: string; hasSiteId?: boolean }
): ContextFunction[] {
  return functions.filter((f) => {
    if (
      filters.module &&
      !f.module.toLowerCase().includes(filters.module.toLowerCase())
    )
      return false;
    if (filters.name && !f.name.includes(filters.name)) return false;
    if (filters.hasSiteId !== undefined && f.hasSiteId !== filters.hasSiteId)
      return false;
    return true;
  });
}

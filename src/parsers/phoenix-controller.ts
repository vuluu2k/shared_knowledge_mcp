import { readFileSync } from "fs";
import { glob } from "glob";
import type { ControllerAction, ParamInfo, PlugInfo } from "../types.js";

/**
 * Parse all Phoenix v1 controllers and extract action definitions.
 */
export async function parsePhoenixControllers(
  backendPath: string
): Promise<ControllerAction[]> {
  const controllerFiles = await glob(
    "lib/builderx_api_web/controllers/v1/**/*_controller.ex",
    { cwd: backendPath, absolute: true }
  );

  const actions: ControllerAction[] = [];

  for (const file of controllerFiles) {
    const content = readFileSync(file, "utf-8");
    const parsed = extractControllerActions(content, file);
    actions.push(...parsed);
  }

  return actions;
}

function extractControllerActions(
  content: string,
  filePath: string
): ControllerAction[] {
  const actions: ControllerAction[] = [];
  const lines = content.split("\n");

  // Extract module name
  const moduleMatch = content.match(
    /defmodule\s+([\w.]+)\s+do/
  );
  const moduleName = moduleMatch?.[1] ?? "Unknown";
  const controllerName = moduleName
    .replace("BuilderxApiWeb.", "")
    .replace("V1.", "");

  // Extract plugs
  const plugs = extractPlugs(content);

  // Extract action functions
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Match: def action_name(conn, params_pattern) do
    const defMatch = line.match(
      /^def\s+(\w+)\s*\(\s*(\w+)\s*,\s*(.+?)\s*\)\s+do/
    );
    if (!defMatch) continue;

    const [, actionName, connVar, paramsStr] = defMatch;

    // Skip private/helper functions
    if (actionName.startsWith("_")) continue;

    // Parse params from pattern match
    const params = extractParams(paramsStr, connVar, lines, i);

    // Find response type by scanning the function body
    const responseType = extractResponseType(lines, i);

    // Find which plugs guard this action
    const actionPlugs = plugs.filter(
      (p) =>
        p.guardedActions.length === 0 ||
        p.guardedActions.includes(actionName)
    );

    actions.push({
      controller: controllerName,
      action: actionName,
      params,
      responseType,
      plugs: actionPlugs,
      filePath,
      lineNumber: i + 1,
    });
  }

  return actions;
}

function extractPlugs(content: string): PlugInfo[] {
  const plugs: PlugInfo[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // plug BuilderxApiWeb.Plug.SitePermissionPlug, [opts] when action in [...]
    const plugMatch = line.match(
      /plug\s+([\w.]+)(?:\s*,\s*\[([^\]]*)\])?/
    );
    if (!plugMatch) continue;

    const plugName = plugMatch[1];
    const optsStr = plugMatch[2] || "";

    // Parse options
    const options: Record<string, unknown> = {};
    const sitePermsMatch = optsStr.match(
      /site_permissions:\s*\[([^\]]*)\]/
    );
    if (sitePermsMatch) {
      options.site_permissions = sitePermsMatch[1]
        .split(",")
        .map((p) => p.trim().replace(/"/g, ""));
    }
    const errorCodeMatch = optsStr.match(/error_code:\s*(\d+)/);
    if (errorCodeMatch) {
      options.error_code = parseInt(errorCodeMatch[1]);
    }

    // Check for guard clause: when action in [...]
    let guardedActions: string[] = [];
    const fullLine = lines[i] + (lines[i + 1] || "");
    const guardMatch = fullLine.match(
      /when\s+action\s+in\s+\[([^\]]*)\]/
    );
    if (guardMatch) {
      guardedActions = guardMatch[1]
        .split(",")
        .map((a) => a.trim().replace(/^:/, ""));
    }

    plugs.push({ name: plugName, options, guardedActions });
  }

  return plugs;
}

function extractParams(
  paramsStr: string,
  _connVar: string,
  lines: string[],
  startLine: number
): ParamInfo[] {
  const params: ParamInfo[] = [];

  // Pattern match: %{"key" => var, ...}
  const mapMatch = paramsStr.match(/%\{([^}]+)\}/);
  if (mapMatch) {
    const entries = mapMatch[1].split(",");
    for (const entry of entries) {
      const kv = entry.match(/"(\w+)"\s*=>\s*(\w+)/);
      if (kv) {
        const name = kv[1];
        params.push({
          name,
          source: name === "id" || name === "site_id" ? "path" : "body",
          required: true,
        });
      }
    }
  }

  // Also check for params["key"] usage within function body
  const bodyEnd = findFunctionEnd(lines, startLine);
  const bodyLines = lines.slice(startLine, bodyEnd);
  const bodyText = bodyLines.join("\n");

  const paramAccessRegex = /params\["(\w+)"\]/g;
  let match: RegExpExecArray | null;
  const seen = new Set(params.map((p) => p.name));

  while ((match = paramAccessRegex.exec(bodyText)) !== null) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      params.push({
        name,
        source: "body",
        required: false,
      });
    }
  }

  // Check conn.assigns usage
  const assignsRegex = /conn\.assigns\.(\w+)/g;
  while ((match = assignsRegex.exec(bodyText)) !== null) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      params.push({
        name,
        source: "conn_assigns",
        required: true,
      });
    }
  }

  return params;
}

function extractResponseType(lines: string[], startLine: number): string {
  const bodyEnd = findFunctionEnd(lines, startLine);
  const bodyText = lines.slice(startLine, bodyEnd).join("\n");

  if (bodyText.includes("{:success, :success_only}")) return "success_only";
  if (bodyText.includes("{:success, :with_data,")) {
    const keyMatch = bodyText.match(
      /\{:success,\s*:with_data,\s*"?:?(\w+)"?,/
    );
    return keyMatch ? `with_data:${keyMatch[1]}` : "with_data";
  }
  if (bodyText.includes("{:failed, :with_reason"))
    return "failed_with_reason";
  if (bodyText.includes("{:failed, :with_code")) return "failed_with_code";
  if (bodyText.includes("{:error, changeset}") || bodyText.includes("{:error, %Ecto.Changeset"))
    return "changeset_error";

  return "unknown";
}

function findFunctionEnd(lines: string[], startLine: number): number {
  let depth = 0;
  let started = false;

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i].trim();

    // Count do/end nesting
    if (line.match(/\bdo\b/) || line.match(/\bfn\b.*->$/)) {
      depth++;
      started = true;
    }
    if (line === "end" || line.match(/^\bend\b/)) {
      depth--;
      if (started && depth <= 0) return i + 1;
    }
  }

  return Math.min(startLine + 100, lines.length);
}

/**
 * Get a single controller's actions by controller name.
 */
export function filterActions(
  actions: ControllerAction[],
  filters: { controller?: string; action?: string }
): ControllerAction[] {
  return actions.filter((a) => {
    if (
      filters.controller &&
      !a.controller.toLowerCase().includes(filters.controller.toLowerCase())
    )
      return false;
    if (filters.action && a.action !== filters.action) return false;
    return true;
  });
}

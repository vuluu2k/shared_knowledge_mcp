import { readFileSync } from "fs";
import { glob } from "glob";
import type { StoreAction, ApiCallInfo } from "../types.js";

/**
 * Parse Pinia store files and extract actions with their API calls.
 */
export async function parseVueStores(
  frontendPath: string
): Promise<StoreAction[]> {
  const storeFiles = await glob("src/stores/**/*.{js,ts}", {
    cwd: frontendPath,
    absolute: true,
  });

  const actions: StoreAction[] = [];

  for (const file of storeFiles) {
    const content = readFileSync(file, "utf-8");
    if (!content.includes("defineStore")) continue;
    const parsed = extractStoreActions(content, file);
    actions.push(...parsed);
  }

  return actions;
}

function extractStoreActions(
  content: string,
  filePath: string
): StoreAction[] {
  const actions: StoreAction[] = [];

  // Extract store name
  const storeMatch = content.match(
    /defineStore\s*\(\s*['"](\w+)['"]/
  );
  const storeName = storeMatch?.[1] ?? extractStoreName(filePath);

  // Find the actions block
  const actionsBlockMatch = content.match(
    /actions:\s*\{([\s\S]*?)\n\s*\}\s*(?:,|\))/
  );

  if (!actionsBlockMatch) {
    // Try setup store pattern (composition API style)
    return extractSetupStoreActions(content, storeName, filePath);
  }

  const actionsBlock = actionsBlockMatch[1];
  const lines = actionsBlock.split("\n");

  let currentAction: string | null = null;
  let currentBody: string[] = [];
  let depth = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // Match action method: async actionName(params) {
    const actionMatch = trimmed.match(
      /(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/
    );

    if (actionMatch && depth === 0) {
      // Save previous action
      if (currentAction) {
        actions.push(
          buildStoreAction(
            storeName,
            currentAction,
            currentBody.join("\n"),
            filePath
          )
        );
      }

      currentAction = actionMatch[1];
      currentBody = [line];
      depth = 1;
      continue;
    }

    if (currentAction) {
      currentBody.push(line);
      for (const ch of line) {
        if (ch === "{") depth++;
        if (ch === "}") depth--;
      }

      if (depth <= 0) {
        actions.push(
          buildStoreAction(
            storeName,
            currentAction,
            currentBody.join("\n"),
            filePath
          )
        );
        currentAction = null;
        currentBody = [];
        depth = 0;
      }
    }
  }

  // Handle last action
  if (currentAction) {
    actions.push(
      buildStoreAction(
        storeName,
        currentAction,
        currentBody.join("\n"),
        filePath
      )
    );
  }

  return actions;
}

function extractSetupStoreActions(
  content: string,
  storeName: string,
  filePath: string
): StoreAction[] {
  const actions: StoreAction[] = [];

  // Match function definitions inside setup store
  const fnRegex =
    /(?:const|function)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = fnRegex.exec(content)) !== null) {
    const fnName = match[1];
    const startIdx = match.index + match[0].length;
    const body = extractBody(content, startIdx);

    actions.push(
      buildStoreAction(storeName, fnName, body, filePath)
    );
  }

  return actions;
}

function buildStoreAction(
  storeName: string,
  actionName: string,
  body: string,
  filePath: string
): StoreAction {
  const apiCalls = extractApiCalls(body);
  const stateUpdates = extractStateUpdates(body);

  return {
    store: storeName,
    action: actionName,
    apiCalls,
    stateUpdates,
    filePath,
  };
}

function extractApiCalls(body: string): ApiCallInfo[] {
  const calls: ApiCallInfo[] = [];

  // Match API module calls: xxxApi.methodName(params)
  const apiModuleRegex = /(\w+Api)\.(\w+)\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = apiModuleRegex.exec(body)) !== null) {
    calls.push({
      apiModule: match[1],
      method: match[2],
      url: "",
      httpMethod: inferHttpMethod(match[2]),
    });
  }

  // Match useApiget/useApipost calls
  const composableRegex =
    /useApi(get|post|Delete)\s*\(\s*(?:['"`]([^'"`]+)['"`]|`([^`]+)`|(\w+))/g;

  while ((match = composableRegex.exec(body)) !== null) {
    const [, method, directUrl, templateUrl, _varUrl] = match;
    const url = directUrl || templateUrl || "";

    calls.push({
      apiModule: "composable",
      method: `useApi${method}`,
      url: url.replace(/\$\{[^}]+\}/g, ":param"),
      httpMethod: method === "Delete" ? "DELETE" : method.toUpperCase(),
    });
  }

  return calls;
}

function extractStateUpdates(body: string): string[] {
  const updates: string[] = [];
  const stateRegex = /this\.(\w+)\s*=/g;
  let match: RegExpExecArray | null;
  const seen = new Set<string>();

  while ((match = stateRegex.exec(body)) !== null) {
    const field = match[1];
    if (!seen.has(field) && !["loading", "stateId"].includes(field)) {
      seen.add(field);
      updates.push(field);
    }
  }

  return updates;
}

function inferHttpMethod(methodName: string): string {
  const lower = methodName.toLowerCase();
  if (
    lower.startsWith("get") ||
    lower.startsWith("list") ||
    lower.startsWith("fetch") ||
    lower.startsWith("load") ||
    lower === "all"
  )
    return "GET";
  if (
    lower.startsWith("create") ||
    lower.startsWith("add") ||
    lower.startsWith("insert") ||
    lower.startsWith("save") ||
    lower.startsWith("import") ||
    lower.startsWith("upload")
  )
    return "POST";
  if (lower.startsWith("update") || lower.startsWith("edit")) return "POST";
  if (lower.startsWith("delete") || lower.startsWith("remove")) return "POST";
  return "POST";
}

function extractBody(content: string, startIdx: number): string {
  let depth = 1;
  let i = startIdx;

  while (i < content.length && depth > 0) {
    if (content[i] === "{") depth++;
    if (content[i] === "}") depth--;
    i++;
  }

  return content.slice(startIdx, i);
}

function extractStoreName(filePath: string): string {
  const parts = filePath.split("/");
  return parts[parts.length - 1].replace(/\.(js|ts)$/, "");
}

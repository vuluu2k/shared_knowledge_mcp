import { readFileSync } from "fs";
import { glob } from "glob";

export interface ComponentImport {
  component: string;
  filePath: string;
  storeImports: string[];
  apiImports: string[];
}

/**
 * Lightweight parser: scan .vue files for store and API imports.
 */
export async function parseVueComponentImports(
  frontendPath: string
): Promise<ComponentImport[]> {
  const vueFiles = await glob("src/{views,components}/**/*.vue", {
    cwd: frontendPath,
    absolute: true,
  });

  const results: ComponentImport[] = [];

  for (const file of vueFiles) {
    const content = readFileSync(file, "utf-8");
    const storeImports: string[] = [];
    const apiImports: string[] = [];

    // Match: import { useXxxStore } from '...'
    const storeRegex = /import\s*\{[^}]*(use\w+Store)[^}]*\}\s*from/g;
    let match: RegExpExecArray | null;
    while ((match = storeRegex.exec(content)) !== null) {
      storeImports.push(match[1]);
    }

    // Match: import xxxApi from '...'
    const apiRegex = /import\s+(\w+Api)\s+from/g;
    while ((match = apiRegex.exec(content)) !== null) {
      apiImports.push(match[1]);
    }

    // Match: import { useApiget, useApipost } from
    if (/useApi(get|post|Delete)/.test(content)) {
      apiImports.push("composable");
    }

    if (storeImports.length > 0 || apiImports.length > 0) {
      const relPath = file.replace(frontendPath + "/", "");
      results.push({
        component: relPath.replace(/\.vue$/, "").split("/").pop() || relPath,
        filePath: relPath,
        storeImports,
        apiImports,
      });
    }
  }

  return results;
}

import { createHash } from "crypto";
import { readFileSync, statSync } from "fs";
import { glob } from "glob";

interface FileState {
  mtime: number;
  hash: string;
}

interface CacheEntry<T> {
  fileStates: Map<string, FileState>;
  combinedHash: string;
  result: T;
  cachedAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

function hashContent(content: string): string {
  return createHash("md5").update(content).digest("hex");
}

function getCacheKey(globPattern: string, basePath: string): string {
  return `${basePath}::${globPattern}`;
}

/**
 * Wrap a parser function with file-hash caching.
 * Only re-parses when source files have changed (by mtime + content hash).
 */
export async function cachedParse<T>(
  globPattern: string,
  basePath: string,
  parseFn: () => Promise<T>
): Promise<{ data: T; fromCache: boolean }> {
  const key = getCacheKey(globPattern, basePath);
  const currentFiles = await glob(globPattern, { cwd: basePath, absolute: true });

  // Build current file states (mtime first, hash only if mtime changed)
  const cached = store.get(key) as CacheEntry<T> | undefined;
  const currentStates = new Map<string, FileState>();
  let needsRehash = false;

  for (const file of currentFiles) {
    try {
      const stat = statSync(file);
      const mtime = stat.mtimeMs;
      const cachedState = cached?.fileStates.get(file);

      if (cachedState && cachedState.mtime === mtime) {
        // mtime unchanged — reuse cached hash
        currentStates.set(file, cachedState);
      } else {
        // mtime changed or new file — hash content
        const content = readFileSync(file, "utf-8");
        currentStates.set(file, { mtime, hash: hashContent(content) });
        needsRehash = true;
      }
    } catch {
      needsRehash = true;
    }
  }

  // Check if file count changed
  if (cached && cached.fileStates.size !== currentStates.size) {
    needsRehash = true;
  }

  // Compare combined hash
  if (!needsRehash && cached) {
    const combinedHash = buildCombinedHash(currentStates);
    if (combinedHash === cached.combinedHash) {
      return { data: cached.result, fromCache: true };
    }
  }

  // Cache miss — re-parse
  const result = await parseFn();
  const combinedHash = buildCombinedHash(currentStates);

  store.set(key, {
    fileStates: currentStates,
    combinedHash,
    result,
    cachedAt: Date.now(),
  });

  return { data: result, fromCache: false };
}

function buildCombinedHash(states: Map<string, FileState>): string {
  const sorted = [...states.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const combined = sorted.map(([f, s]) => `${f}:${s.hash}`).join("|");
  return hashContent(combined);
}

/**
 * Invalidate cache entries. If no pattern given, clears all.
 */
export function invalidateCache(globPattern?: string): void {
  if (!globPattern) {
    store.clear();
    return;
  }
  for (const key of store.keys()) {
    if (key.includes(globPattern)) {
      store.delete(key);
    }
  }
}

/**
 * Get cache stats for debugging.
 */
export function getCacheStats(): { entries: number; keys: string[] } {
  return {
    entries: store.size,
    keys: [...store.keys()],
  };
}

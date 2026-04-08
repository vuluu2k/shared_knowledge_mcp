/**
 * Memory Cache Layer
 *
 * Giải quyết 3 vấn đề chính:
 * 1. ensureRepo() gọi git pull mỗi lần → giờ chỉ sync mỗi N phút
 * 2. recallMemory đọc tất cả file từ disk → giờ cache in-memory, đọc 1 lần
 * 3. smart-context gọi recallMemory nhiều lần → giờ lookup từ cache O(1)
 *
 * Architecture:
 *   GitHub repo ←→ local git clone ←→ MemoryCache (in-memory index)
 *                    ↑ sync mỗi N phút       ↑ load 1 lần, invalidate on write
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

// ── Types ──

export interface MemoryCacheEntry {
  id: string;
  category: string;
  title: string;
  tags: string[];
  /** First ~200 chars of content — enough for AI context */
  snippet: string;
  /** Full content — loaded lazily, null until requested */
  fullContent: string | null;
  created_at: string;
  updated_at: string;
  /** File mtime for change detection */
  _mtime: number;
}

interface CacheState {
  entries: Map<string, MemoryCacheEntry>; // key: "category/id"
  lastSyncAt: number;  // last git pull timestamp
  lastLoadAt: number;  // last full disk read timestamp
  dirty: boolean;      // has local writes since last sync
}

// ── Config ──

const SYNC_INTERVAL_MS = parseInt(process.env.MEMORY_SYNC_INTERVAL || "300000", 10); // 5 min default
const SNIPPET_LENGTH = 200;
const CATEGORIES = ["business", "tasks", "analysis", "decisions"] as const;

// ── Singleton cache ──

let cache: CacheState | null = null;

function getCache(): CacheState {
  if (!cache) {
    cache = {
      entries: new Map(),
      lastSyncAt: 0,
      lastLoadAt: 0,
      dirty: false,
    };
  }
  return cache;
}

// ── Frontmatter parser (same logic as memory.ts) ──

function parseEntryFromFile(
  raw: string,
  id: string,
  category: string,
  mtime: number,
  loadFullContent: boolean
): MemoryCacheEntry {
  const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!frontmatterMatch) {
    return {
      id,
      category,
      title: id,
      tags: [],
      snippet: raw.slice(0, SNIPPET_LENGTH),
      fullContent: loadFullContent ? raw : null,
      created_at: "",
      updated_at: "",
      _mtime: mtime,
    };
  }

  const [, meta, content] = frontmatterMatch;
  const titleMatch = meta.match(/title:\s*"([^"]+)"/);
  const tagsMatch = meta.match(/tags:\s*\[([^\]]*)\]/);
  const createdMatch = meta.match(/created_at:\s*(.+)/);
  const updatedMatch = meta.match(/updated_at:\s*(.+)/);

  const trimmedContent = content.trim();

  return {
    id,
    category,
    title: titleMatch?.[1] || id,
    tags: tagsMatch?.[1]
      ? tagsMatch[1]
          .split(",")
          .map((t) => t.trim().replace(/"/g, ""))
          .filter(Boolean)
      : [],
    snippet: trimmedContent.slice(0, SNIPPET_LENGTH),
    fullContent: loadFullContent ? trimmedContent : null,
    created_at: createdMatch?.[1]?.trim() || "",
    updated_at: updatedMatch?.[1]?.trim() || "",
    _mtime: mtime,
  };
}

// ── Core functions ──

/**
 * Load all memories from disk into cache.
 * Only re-reads files whose mtime has changed.
 */
export function loadFromDisk(repoPath: string): void {
  const state = getCache();

  // Track which keys exist on disk (to detect deletions)
  const diskKeys = new Set<string>();

  for (const cat of CATEGORIES) {
    const catDir = join(repoPath, "memories", cat);
    if (!existsSync(catDir)) continue;

    const files = readdirSync(catDir).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      const id = file.replace(/\.md$/, "");
      const key = `${cat}/${id}`;
      const filePath = join(catDir, file);
      diskKeys.add(key);

      try {
        const stat = statSync(filePath);
        const mtime = stat.mtimeMs;

        // Skip if already cached with same mtime
        const existing = state.entries.get(key);
        if (existing && existing._mtime === mtime) {
          continue;
        }

        // Read and parse (snippet only — full content lazy)
        const raw = readFileSync(filePath, "utf-8");
        const entry = parseEntryFromFile(raw, id, cat, mtime, false);
        state.entries.set(key, entry);
      } catch {
        // File read error — skip
      }
    }
  }

  // Remove entries that no longer exist on disk
  for (const key of state.entries.keys()) {
    if (!diskKeys.has(key)) {
      state.entries.delete(key);
    }
  }

  state.lastLoadAt = Date.now();
}

/**
 * Check if cache needs a git sync (pull).
 */
export function needsSync(): boolean {
  const state = getCache();
  return Date.now() - state.lastSyncAt > SYNC_INTERVAL_MS;
}

/**
 * Mark that a git sync just happened.
 */
export function markSynced(): void {
  const state = getCache();
  state.lastSyncAt = Date.now();
}

/**
 * Mark cache as dirty (local write happened).
 */
export function markDirty(): void {
  const state = getCache();
  state.dirty = true;
}

/**
 * Check if cache has local writes pending push.
 */
export function isDirty(): boolean {
  return getCache().dirty;
}

/**
 * Clear dirty flag after successful push.
 */
export function clearDirty(): void {
  getCache().dirty = false;
}

/**
 * Check if cache has been loaded at all.
 */
export function isLoaded(): boolean {
  return getCache().lastLoadAt > 0;
}

// ── Query functions (all from cache, no disk reads) ──

/**
 * Search memories by query string. Matches title, tags, and snippet.
 * Returns compact results (snippet, not full content).
 */
export function searchMemories(opts: {
  query?: string;
  category?: string;
  tag?: string;
  limit?: number;
  mode?: "compact" | "full";
  repoPath?: string;
}): MemoryCacheEntry[] {
  const state = getCache();
  let results = [...state.entries.values()];

  // Category filter
  if (opts.category) {
    results = results.filter((e) => e.category === opts.category);
  }

  // Tag filter
  if (opts.tag) {
    const tagLower = opts.tag.toLowerCase();
    results = results.filter((e) =>
      e.tags.some((t) => t.toLowerCase() === tagLower)
    );
  }

  // Query filter — match against title, tags, snippet
  if (opts.query) {
    const q = opts.query.toLowerCase();
    const queryWords = q.split(/\s+/).filter((w) => w.length > 1);

    results = results
      .map((e) => {
        let score = 0;
        const titleLower = e.title.toLowerCase();
        const snippetLower = e.snippet.toLowerCase();
        const tagStr = e.tags.join(" ").toLowerCase();

        for (const word of queryWords) {
          // Title match = highest weight
          if (titleLower.includes(word)) score += 3;
          // Tag match = high weight
          if (tagStr.includes(word)) score += 2;
          // Snippet match = normal weight
          if (snippetLower.includes(word)) score += 1;
        }

        return { entry: e, score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((r) => r.entry);
  }

  // Sort by updated_at (most recent first)
  results.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));

  // Apply limit
  const limit = opts.limit || 10;
  results = results.slice(0, limit);

  // Load full content if mode=full
  if (opts.mode === "full" && opts.repoPath) {
    for (const entry of results) {
      if (entry.fullContent === null) {
        loadFullContent(entry, opts.repoPath);
      }
    }
  }

  return results;
}

/**
 * List all memories with compact info (no full content).
 */
export function listAllMemories(category?: string): {
  total: number;
  categories: Record<string, { count: number; entries: MemoryCacheEntry[] }>;
} {
  const state = getCache();
  const result: Record<string, { count: number; entries: MemoryCacheEntry[] }> = {};

  const cats = category ? [category] : [...CATEGORIES];
  for (const cat of cats) {
    const entries = [...state.entries.values()]
      .filter((e) => e.category === cat)
      .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));

    result[cat] = { count: entries.length, entries };
  }

  const total = Object.values(result).reduce((s, c) => s + c.count, 0);
  return { total, categories: result };
}

/**
 * Get a single memory by category/id.
 */
export function getMemory(category: string, id: string): MemoryCacheEntry | null {
  return getCache().entries.get(`${category}/${id}`) || null;
}

/**
 * Update cache entry directly (after a save/delete).
 * Avoids re-reading from disk.
 */
export function upsertEntry(entry: MemoryCacheEntry): void {
  const key = `${entry.category}/${entry.id}`;
  getCache().entries.set(key, entry);
  markDirty();
}

/**
 * Remove entry from cache (after delete).
 */
export function removeEntry(category: string, id: string): void {
  getCache().entries.delete(`${category}/${id}`);
  markDirty();
}

/**
 * Get total cached entry count.
 */
export function getCacheSize(): number {
  return getCache().entries.size;
}

/**
 * Get cache stats for debugging.
 */
export function getMemoryCacheStats(): {
  size: number;
  lastSyncAt: number;
  lastLoadAt: number;
  dirty: boolean;
  syncIntervalMs: number;
} {
  const state = getCache();
  return {
    size: state.entries.size,
    lastSyncAt: state.lastSyncAt,
    lastLoadAt: state.lastLoadAt,
    dirty: state.dirty,
    syncIntervalMs: SYNC_INTERVAL_MS,
  };
}

// ── Helpers ──

/**
 * Lazily load full content for a cache entry.
 */
function loadFullContent(entry: MemoryCacheEntry, repoPath: string): void {
  const filePath = join(repoPath, "memories", entry.category, `${entry.id}.md`);
  try {
    const raw = readFileSync(filePath, "utf-8");
    const frontmatterMatch = raw.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
    entry.fullContent = frontmatterMatch ? frontmatterMatch[1].trim() : raw;
  } catch {
    entry.fullContent = entry.snippet;
  }
}

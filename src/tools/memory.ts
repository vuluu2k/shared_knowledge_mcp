import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import {
  loadFromDisk,
  needsSync,
  markSynced,
  markDirty,
  clearDirty,
  isLoaded,
  searchMemories,
  listAllMemories,
  getMemory,
  upsertEntry,
  removeEntry,
  type MemoryCacheEntry,
} from "../cache/memory-cache.js";

const CATEGORIES = ["business", "tasks", "analysis", "decisions"] as const;
type Category = (typeof CATEGORIES)[number];

interface MemoryEntry {
  id: string;
  category: Category;
  title: string;
  content: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

// ── Config (from env vars) ──

interface MemoryConfig {
  repoOwner: string;
  repoName: string;
  repoToken: string;
  localPath: string;
}

function getConfig(): MemoryConfig {
  return {
    repoOwner: process.env.MEMORY_REPO_OWNER || "",
    repoName: process.env.MEMORY_REPO_NAME || "shared-knowledge-memory",
    repoToken: process.env.MEMORY_REPO_TOKEN || "",
    localPath:
      process.env.MEMORY_REPO_PATH ||
      join(process.env.HOME || "/tmp", ".shared-knowledge-memory"),
  };
}

function getRepoUrl(cfg: MemoryConfig): string {
  if (cfg.repoToken) {
    return `https://${cfg.repoToken}@github.com/${cfg.repoOwner}/${cfg.repoName}.git`;
  }
  return `https://github.com/${cfg.repoOwner}/${cfg.repoName}.git`;
}

// ── Git helpers ──

function git(args: string, cwd: string, env?: Record<string, string>): string {
  try {
    return execSync(`git ${args}`, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
    }).trim();
  } catch (e: any) {
    throw new Error(`git ${args} failed: ${e.stderr || e.message}`);
  }
}

function resolveOwner(cfg: MemoryConfig): string {
  if (cfg.repoOwner) return cfg.repoOwner;

  // Fallback: try gh CLI
  try {
    return execSync("gh api user --jq .login", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    throw new Error(
      "MEMORY_REPO_OWNER is not set and gh CLI is not authenticated. " +
        "Set MEMORY_REPO_OWNER env var."
    );
  }
}

/**
 * Ensure local repo exists. Only sync with remote when cache says it's time.
 * This is the key optimization: replaces the old ensureRepo() that pulled every time.
 */
function ensureRepo(): string {
  const cfg = getConfig();
  const owner = resolveOwner(cfg);
  cfg.repoOwner = owner;
  const repoPath = cfg.localPath;

  // Already cloned — conditional sync
  if (existsSync(join(repoPath, ".git"))) {
    if (needsSync()) {
      try {
        git("pull --rebase --quiet", repoPath);
      } catch {
        // offline or conflict, continue with local
      }
      markSynced();
      // Reload cache from disk after pull (files may have changed)
      loadFromDisk(repoPath);
    } else if (!isLoaded()) {
      // First access this session — load from disk (no git pull)
      loadFromDisk(repoPath);
    }
    return repoPath;
  }

  // Try clone existing remote repo
  const remoteUrl = getRepoUrl(cfg);
  try {
    execSync(`git clone --quiet "${remoteUrl}" "${repoPath}"`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    markSynced();
    loadFromDisk(repoPath);
    return repoPath;
  } catch {
    // Repo doesn't exist on GitHub yet — create it
  }

  // Init local repo
  mkdirSync(repoPath, { recursive: true });
  execSync(`git init --quiet "${repoPath}"`, { encoding: "utf-8" });
  git("checkout -b main", repoPath);

  // Create directory structure
  for (const cat of CATEGORIES) {
    const catDir = join(repoPath, "memories", cat);
    mkdirSync(catDir, { recursive: true });
    writeFileSync(join(catDir, ".gitkeep"), "");
  }

  writeFileSync(
    join(repoPath, "README.md"),
    [
      "# Shared Knowledge Memory",
      "",
      "Long-term memory storage for AI agents working on BuilderX.",
      "",
      "## Categories",
      "",
      "- **business/** — Domain knowledge, business rules",
      "- **tasks/** — Task history and results",
      "- **analysis/** — API analysis snapshots (cache)",
      "- **decisions/** — Architecture decisions",
      "",
    ].join("\n")
  );

  git("add -A", repoPath);
  git('commit -m "init: shared knowledge memory"', repoPath);

  // Create remote repo on GitHub + push
  try {
    execSync(
      `gh repo create ${owner}/${cfg.repoName} --private --source="${repoPath}" --push`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );
  } catch {
    // gh CLI failed — try raw git remote
    try {
      git(`remote add origin ${remoteUrl}`, repoPath);
      git("push -u origin main", repoPath);
    } catch {
      // continue local-only
    }
  }

  markSynced();
  loadFromDisk(repoPath);
  return repoPath;
}

function commitAndPush(repoPath: string, message: string): void {
  git("add -A", repoPath);

  // Check if there are staged changes
  try {
    git("diff --cached --quiet", repoPath);
    return; // no changes
  } catch {
    // has changes — commit
  }

  git(`commit -m "${message.replace(/"/g, '\\"')}"`, repoPath);

  // Async push — don't block the response
  try {
    git("push --quiet", repoPath);
    clearDirty();
  } catch {
    // offline — will push next time via sync
    markDirty();
  }
}

// ── File helpers ──

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

function serializeEntry(entry: MemoryEntry): string {
  return [
    "---",
    `title: "${entry.title}"`,
    `category: ${entry.category}`,
    `tags: [${entry.tags.map((t) => `"${t}"`).join(", ")}]`,
    `created_at: ${entry.created_at}`,
    `updated_at: ${entry.updated_at}`,
    "---",
    "",
    entry.content,
  ].join("\n");
}

// ── Tool 1: save_memory ──

export interface SaveMemoryArgs {
  category: string;
  title: string;
  content: string;
  tags?: string[];
  id?: string;
}

export async function saveMemory(args: SaveMemoryArgs) {
  const repoPath = ensureRepo();
  const category = validateCategory(args.category);
  const now = new Date().toISOString();
  const id = args.id || slugify(args.title);
  const filePath = join(repoPath, "memories", category, `${id}.md`);

  let created_at = now;
  // Check cache first, then disk
  const cached = getMemory(category, id);
  if (cached) {
    created_at = cached.created_at || now;
  } else if (existsSync(filePath)) {
    const raw = readFileSync(filePath, "utf-8");
    const frontmatterMatch = raw.match(/created_at:\s*(.+)/);
    created_at = frontmatterMatch?.[1]?.trim() || now;
  }

  const entry: MemoryEntry = {
    id,
    category,
    title: args.title,
    content: args.content,
    tags: args.tags || [],
    created_at,
    updated_at: now,
  };

  mkdirSync(join(repoPath, "memories", category), { recursive: true });
  writeFileSync(filePath, serializeEntry(entry));

  // Update cache immediately (no need to re-read from disk)
  upsertEntry({
    id,
    category,
    title: args.title,
    tags: args.tags || [],
    snippet: args.content.slice(0, 200),
    fullContent: args.content,
    created_at,
    updated_at: now,
    _mtime: Date.now(),
  });

  const isNew = created_at === now && !args.id;
  commitAndPush(repoPath, `${isNew ? "add" : "update"}: [${category}] ${args.title}`);

  return {
    success: true,
    action: isNew ? "created" : "updated",
    id,
    category,
    title: args.title,
    path: `memories/${category}/${id}.md`,
  };
}

// ── Tool 2: recall_memory ──

export interface RecallMemoryArgs {
  query?: string;
  category?: string;
  tag?: string;
  limit?: number;
  /** "compact" = snippet only (default), "full" = load full content */
  mode?: "compact" | "full";
}

export async function recallMemory(args: RecallMemoryArgs) {
  const repoPath = ensureRepo();
  const limit = args.limit || 10;
  const mode = args.mode || "compact";

  const results = searchMemories({
    query: args.query,
    category: args.category,
    tag: args.tag,
    limit,
    mode,
    repoPath,
  });

  return {
    total: results.length,
    query: args.query || null,
    filters: { category: args.category || "all", tag: args.tag || null },
    mode,
    results: results.map((e) => ({
      id: e.id,
      category: e.category,
      title: e.title,
      tags: e.tags,
      content: mode === "full" ? (e.fullContent || e.snippet) : e.snippet,
      created_at: e.created_at,
      updated_at: e.updated_at,
    })),
  };
}

// ── Tool 3: list_memories ──

export interface ListMemoriesArgs {
  category?: string;
}

export async function listMemories(args: ListMemoriesArgs) {
  ensureRepo();

  const { total, categories } = listAllMemories(args.category);

  const result: Record<
    string,
    { count: number; entries: { id: string; title: string; tags: string[]; updated_at: string }[] }
  > = {};

  for (const [cat, data] of Object.entries(categories)) {
    result[cat] = {
      count: data.count,
      entries: data.entries.map((e) => ({
        id: e.id,
        title: e.title,
        tags: e.tags,
        updated_at: e.updated_at,
      })),
    };
  }

  return { total, categories: result };
}

// ── Tool 4: delete_memory ──

export interface DeleteMemoryArgs {
  category: string;
  id: string;
}

export async function deleteMemory(args: DeleteMemoryArgs) {
  const repoPath = ensureRepo();
  const category = validateCategory(args.category);
  const filePath = join(repoPath, "memories", category, `${args.id}.md`);

  if (!existsSync(filePath)) {
    throw new Error(`Memory not found: ${category}/${args.id}`);
  }

  // Get title from cache or file
  const cached = getMemory(category, args.id);
  let title = cached?.title || args.id;
  if (!cached) {
    const raw = readFileSync(filePath, "utf-8");
    const titleMatch = raw.match(/title:\s*"([^"]+)"/);
    title = titleMatch?.[1] || args.id;
  }

  execSync(`rm "${filePath}"`, { encoding: "utf-8" });

  // Remove from cache immediately
  removeEntry(category, args.id);

  commitAndPush(repoPath, `delete: [${category}] ${title}`);

  return {
    success: true,
    deleted: { id: args.id, category, title },
  };
}

// ── Validation ──

function validateCategory(cat: string): Category {
  if (!CATEGORIES.includes(cat as Category)) {
    throw new Error(`Invalid category "${cat}". Must be one of: ${CATEGORIES.join(", ")}`);
  }
  return cat as Category;
}

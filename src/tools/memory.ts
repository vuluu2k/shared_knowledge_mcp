import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";

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

function ensureRepo(): string {
  const cfg = getConfig();
  const owner = resolveOwner(cfg);
  cfg.repoOwner = owner;
  const repoPath = cfg.localPath;

  // Already cloned — pull latest
  if (existsSync(join(repoPath, ".git"))) {
    try {
      git("pull --rebase --quiet", repoPath);
    } catch {
      // offline or conflict, continue with local
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

  try {
    git("push --quiet", repoPath);
  } catch {
    // offline — will push next time
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

function parseEntry(raw: string, id: string, category: Category): MemoryEntry {
  const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!frontmatterMatch) {
    return { id, category, title: id, content: raw, tags: [], created_at: "", updated_at: "" };
  }

  const [, meta, content] = frontmatterMatch;
  const titleMatch = meta.match(/title:\s*"([^"]+)"/);
  const tagsMatch = meta.match(/tags:\s*\[([^\]]*)\]/);
  const createdMatch = meta.match(/created_at:\s*(.+)/);
  const updatedMatch = meta.match(/updated_at:\s*(.+)/);

  return {
    id,
    category,
    title: titleMatch?.[1] || id,
    content: content.trim(),
    tags: tagsMatch?.[1]
      ? tagsMatch[1]
          .split(",")
          .map((t) => t.trim().replace(/"/g, ""))
          .filter(Boolean)
      : [],
    created_at: createdMatch?.[1]?.trim() || "",
    updated_at: updatedMatch?.[1]?.trim() || "",
  };
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
  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, "utf-8");
    const parsed = parseEntry(existing, id, category);
    created_at = parsed.created_at || now;
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
}

export async function recallMemory(args: RecallMemoryArgs) {
  const repoPath = ensureRepo();
  const limit = args.limit || 10;
  const entries: MemoryEntry[] = [];

  const cats = args.category ? [validateCategory(args.category)] : [...CATEGORIES];

  for (const cat of cats) {
    const catDir = join(repoPath, "memories", cat);
    if (!existsSync(catDir)) continue;

    for (const file of readdirSync(catDir).filter((f) => f.endsWith(".md"))) {
      const raw = readFileSync(join(catDir, file), "utf-8");
      entries.push(parseEntry(raw, file.replace(/\.md$/, ""), cat));
    }
  }

  let results = entries;

  if (args.query) {
    const q = args.query.toLowerCase();
    results = results.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        e.content.toLowerCase().includes(q) ||
        e.tags.some((t) => t.toLowerCase().includes(q))
    );
  }

  if (args.tag) {
    const tag = args.tag.toLowerCase();
    results = results.filter((e) => e.tags.some((t) => t.toLowerCase() === tag));
  }

  results.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
  results = results.slice(0, limit);

  return {
    total: results.length,
    query: args.query || null,
    filters: { category: args.category || "all", tag: args.tag || null },
    results: results.map((e) => ({
      id: e.id,
      category: e.category,
      title: e.title,
      tags: e.tags,
      content: e.content,
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
  const repoPath = ensureRepo();

  const cats = args.category ? [validateCategory(args.category)] : [...CATEGORIES];

  const result: Record<
    string,
    { count: number; entries: { id: string; title: string; tags: string[]; updated_at: string }[] }
  > = {};

  for (const cat of cats) {
    const catDir = join(repoPath, "memories", cat);
    if (!existsSync(catDir)) {
      result[cat] = { count: 0, entries: [] };
      continue;
    }

    const entries = readdirSync(catDir)
      .filter((f) => f.endsWith(".md"))
      .map((file) => {
        const parsed = parseEntry(readFileSync(join(catDir, file), "utf-8"), file.replace(/\.md$/, ""), cat);
        return { id: parsed.id, title: parsed.title, tags: parsed.tags, updated_at: parsed.updated_at };
      });

    entries.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
    result[cat] = { count: entries.length, entries };
  }

  return {
    total: Object.values(result).reduce((s, c) => s + c.count, 0),
    categories: result,
  };
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

  const raw = readFileSync(filePath, "utf-8");
  const entry = parseEntry(raw, args.id, category);

  execSync(`rm "${filePath}"`, { encoding: "utf-8" });
  commitAndPush(repoPath, `delete: [${category}] ${entry.title}`);

  return {
    success: true,
    deleted: { id: args.id, category, title: entry.title },
  };
}

// ── Validation ──

function validateCategory(cat: string): Category {
  if (!CATEGORIES.includes(cat as Category)) {
    throw new Error(`Invalid category "${cat}". Must be one of: ${CATEGORIES.join(", ")}`);
  }
  return cat as Category;
}

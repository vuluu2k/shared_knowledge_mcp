import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const REPO_NAME = "shared-knowledge-memory";
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

// ── Git helpers ──

function getMemoryRepoPath(): string {
  return join(
    process.env.MEMORY_REPO_PATH ||
      join(process.env.HOME || "/tmp", ".shared-knowledge-memory")
  );
}

function git(args: string, cwd: string): string {
  try {
    return execSync(`git ${args}`, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch (e: any) {
    throw new Error(`git ${args} failed: ${e.stderr || e.message}`);
  }
}

function ensureRepo(): string {
  const repoPath = getMemoryRepoPath();

  if (existsSync(join(repoPath, ".git"))) {
    // Pull latest
    try {
      git("pull --rebase --quiet", repoPath);
    } catch {
      // offline or no remote yet, continue
    }
    return repoPath;
  }

  // Try clone existing repo
  const ghUser = getGhUser();
  try {
    execSync(
      `gh repo clone ${ghUser}/${REPO_NAME} "${repoPath}" -- --quiet 2>/dev/null`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );
    return repoPath;
  } catch {
    // Repo doesn't exist, create it
  }

  // Create GitHub repo + local clone
  mkdirSync(repoPath, { recursive: true });
  execSync(`git init --quiet "${repoPath}"`, { encoding: "utf-8" });
  execSync(`git -C "${repoPath}" checkout -b main`, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });

  // Create directory structure
  for (const cat of CATEGORIES) {
    const catDir = join(repoPath, "memories", cat);
    mkdirSync(catDir, { recursive: true });
    writeFileSync(join(catDir, ".gitkeep"), "");
  }

  // Write README
  writeFileSync(
    join(repoPath, "README.md"),
    `# Shared Knowledge Memory\n\nLong-term memory storage for AI agents working on BuilderX.\n\n## Categories\n\n- **business/** — Domain knowledge, business rules\n- **tasks/** — Task history and results\n- **analysis/** — API analysis snapshots (cache)\n- **decisions/** — Architecture decisions\n`
  );

  // Initial commit
  git("add -A", repoPath);
  git('commit -m "init: shared knowledge memory"', repoPath);

  // Create GitHub repo and push
  try {
    execSync(
      `gh repo create ${REPO_NAME} --private --source="${repoPath}" --push`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );
  } catch (e: any) {
    // If repo already exists on GitHub, just add remote and push
    try {
      git(`remote add origin https://github.com/${ghUser}/${REPO_NAME}.git`, repoPath);
      git("push -u origin main", repoPath);
    } catch {
      // continue without remote — works locally
    }
  }

  return repoPath;
}

function getGhUser(): string {
  try {
    const out = execSync("gh api user --jq .login", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return out;
  } catch {
    return "LuuCongQuangVu";
  }
}

function commitAndPush(repoPath: string, message: string): void {
  git("add -A", repoPath);

  // Check if there are changes to commit
  try {
    git("diff --cached --quiet", repoPath);
    return; // no changes
  } catch {
    // has changes, commit
  }

  git(`commit -m "${message.replace(/"/g, '\\"')}"`, repoPath);

  try {
    git("push --quiet", repoPath);
  } catch {
    // offline, will push later
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
    return {
      id,
      category,
      title: id,
      content: raw,
      tags: [],
      created_at: "",
      updated_at: "",
    };
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
      ? tagsMatch[1].split(",").map((t) => t.trim().replace(/"/g, "")).filter(Boolean)
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
  /** If provided, updates existing memory instead of creating new */
  id?: string;
}

export async function saveMemory(args: SaveMemoryArgs) {
  const repoPath = ensureRepo();
  const category = validateCategory(args.category);
  const now = new Date().toISOString();
  const id = args.id || slugify(args.title);
  const filePath = join(repoPath, "memories", category, `${id}.md`);

  let created_at = now;
  // If updating, preserve created_at
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
  /** Search query (matches title, content, tags) */
  query?: string;
  /** Filter by category */
  category?: string;
  /** Filter by tag */
  tag?: string;
  /** Max results (default 10) */
  limit?: number;
}

export async function recallMemory(args: RecallMemoryArgs) {
  const repoPath = ensureRepo();
  const limit = args.limit || 10;
  const entries: MemoryEntry[] = [];

  const categoriesToSearch = args.category
    ? [validateCategory(args.category)]
    : [...CATEGORIES];

  for (const cat of categoriesToSearch) {
    const catDir = join(repoPath, "memories", cat);
    if (!existsSync(catDir)) continue;

    const files = readdirSync(catDir).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      const raw = readFileSync(join(catDir, file), "utf-8");
      const id = file.replace(/\.md$/, "");
      const entry = parseEntry(raw, id, cat);
      entries.push(entry);
    }
  }

  // Filter
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
    results = results.filter((e) =>
      e.tags.some((t) => t.toLowerCase() === tag)
    );
  }

  // Sort by updated_at desc
  results.sort(
    (a, b) => (b.updated_at || "").localeCompare(a.updated_at || "")
  );

  // Limit
  results = results.slice(0, limit);

  return {
    total: results.length,
    query: args.query || null,
    filters: {
      category: args.category || "all",
      tag: args.tag || null,
    },
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
  /** Filter by category */
  category?: string;
}

export async function listMemories(args: ListMemoriesArgs) {
  const repoPath = ensureRepo();

  const categoriesToList = args.category
    ? [validateCategory(args.category)]
    : [...CATEGORIES];

  const result: Record<string, { count: number; entries: { id: string; title: string; tags: string[]; updated_at: string }[] }> = {};

  for (const cat of categoriesToList) {
    const catDir = join(repoPath, "memories", cat);
    if (!existsSync(catDir)) {
      result[cat] = { count: 0, entries: [] };
      continue;
    }

    const files = readdirSync(catDir).filter((f) => f.endsWith(".md"));
    const entries = files.map((file) => {
      const raw = readFileSync(join(catDir, file), "utf-8");
      const id = file.replace(/\.md$/, "");
      const parsed = parseEntry(raw, id, cat);
      return {
        id: parsed.id,
        title: parsed.title,
        tags: parsed.tags,
        updated_at: parsed.updated_at,
      };
    });

    // Sort by updated_at desc
    entries.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));

    result[cat] = { count: entries.length, entries };
  }

  const totalCount = Object.values(result).reduce((sum, c) => sum + c.count, 0);

  return {
    total: totalCount,
    categories: result,
  };
}

// ── Validation ──

function validateCategory(cat: string): Category {
  const valid = CATEGORIES.includes(cat as Category);
  if (!valid) {
    throw new Error(
      `Invalid category "${cat}". Must be one of: ${CATEGORIES.join(", ")}`
    );
  }
  return cat as Category;
}

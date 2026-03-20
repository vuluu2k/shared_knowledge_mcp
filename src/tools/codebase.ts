import { execSync } from "child_process";
import { readFileSync, existsSync, statSync } from "fs";
import { join, relative } from "path";
import type { RepoConfig } from "../types.js";

// ── Tool: search_code ──

export interface SearchCodeArgs {
  /** Search pattern (regex supported) */
  query: string;
  /** Which repo: "backend", "frontend", or "both" */
  repo?: "backend" | "frontend" | "both";
  /** Glob pattern to filter files, e.g. "*.ex", "*.vue" */
  file_pattern?: string;
  /** Max results (default 20) */
  limit?: number;
  /** Lines of context around each match (default 2) */
  context_lines?: number;
}

export async function searchCode(config: RepoConfig, args: SearchCodeArgs) {
  const repos = args.repo || "both";
  const limit = args.limit || 20;
  const contextLines = args.context_lines ?? 2;
  const results: SearchResult[] = [];

  const targets: { name: string; path: string }[] = [];
  if (repos === "backend" || repos === "both") {
    targets.push({ name: "backend", path: config.backendPath });
  }
  if (repos === "frontend" || repos === "both") {
    targets.push({ name: "frontend", path: config.frontendPath });
  }

  for (const target of targets) {
    if (!existsSync(target.path)) continue;

    let cmd = `grep -rn --include='*' -C ${contextLines}`;

    if (args.file_pattern) {
      cmd = `grep -rn --include='${args.file_pattern}' -C ${contextLines}`;
    } else {
      // Default: skip non-code files
      const excludes = [
        "--exclude-dir=node_modules",
        "--exclude-dir=_build",
        "--exclude-dir=deps",
        "--exclude-dir=dist",
        "--exclude-dir=.git",
        "--exclude-dir=.elixir_ls",
        "--exclude='*.beam'",
        "--exclude='*.lock'",
        "--exclude='*.map'",
      ].join(" ");
      cmd = `grep -rn ${excludes} -C ${contextLines}`;
    }

    cmd += ` -E "${args.query.replace(/"/g, '\\"')}" "${target.path}" 2>/dev/null || true`;

    try {
      const output = execSync(cmd, {
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
        timeout: 15000,
      });

      const matches = parseGrepOutput(output, target.name, target.path);
      results.push(...matches);
    } catch {
      // grep error or timeout — skip
    }
  }

  // Deduplicate and limit
  const limited = results.slice(0, limit);

  return {
    query: args.query,
    total: results.length,
    showing: limited.length,
    results: limited,
  };
}

interface SearchResult {
  repo: string;
  file: string;
  line: number;
  match: string;
  context: string;
}

function parseGrepOutput(output: string, repoName: string, repoPath: string): SearchResult[] {
  const results: SearchResult[] = [];
  if (!output.trim()) return results;

  // Split by -- (grep group separator)
  const groups = output.split("\n--\n");

  for (const group of groups) {
    const lines = group.trim().split("\n").filter(Boolean);
    if (lines.length === 0) continue;

    // Find the actual match line (has line number)
    for (const line of lines) {
      const match = line.match(/^(.+?):(\d+):(.*)$/);
      if (!match) continue;

      const [, filePath, lineNum, content] = match;
      const relPath = relative(repoPath, filePath);

      // Skip if already have this exact location
      if (results.some((r) => r.file === relPath && r.line === parseInt(lineNum))) continue;

      results.push({
        repo: repoName,
        file: relPath,
        line: parseInt(lineNum),
        match: content.trim(),
        context: group.trim(),
      });
      break; // one result per group
    }
  }

  return results;
}

// ── Tool: read_source ──

export interface ReadSourceArgs {
  /** Which repo: "backend" or "frontend" */
  repo: "backend" | "frontend";
  /** File path relative to repo root */
  file_path: string;
  /** Start line (1-based, default 1) */
  start_line?: number;
  /** Number of lines to read (default: entire file, max 500) */
  num_lines?: number;
}

export async function readSource(config: RepoConfig, args: ReadSourceArgs) {
  const basePath = args.repo === "backend" ? config.backendPath : config.frontendPath;
  const fullPath = join(basePath, args.file_path);

  // Security: prevent path traversal
  if (!fullPath.startsWith(basePath)) {
    throw new Error("Path traversal not allowed");
  }

  if (!existsSync(fullPath)) {
    throw new Error(`File not found: ${args.file_path} (in ${args.repo})`);
  }

  const stat = statSync(fullPath);
  if (stat.isDirectory()) {
    // List directory contents
    const entries = execSync(`ls -la "${fullPath}" 2>/dev/null || true`, {
      encoding: "utf-8",
    }).trim();
    return {
      type: "directory",
      repo: args.repo,
      path: args.file_path,
      content: entries,
    };
  }

  const raw = readFileSync(fullPath, "utf-8");
  const allLines = raw.split("\n");
  const totalLines = allLines.length;

  const startLine = Math.max(1, args.start_line || 1);
  const numLines = Math.min(args.num_lines || totalLines, 500);
  const endLine = Math.min(startLine + numLines - 1, totalLines);

  const selectedLines = allLines.slice(startLine - 1, endLine);
  const numbered = selectedLines
    .map((line, i) => `${startLine + i}│ ${line}`)
    .join("\n");

  return {
    type: "file",
    repo: args.repo,
    path: args.file_path,
    totalLines,
    startLine,
    endLine,
    content: numbered,
  };
}

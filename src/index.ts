#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { resolve } from "path";

import { getApiSchema } from "./tools/get-api-schema.js";
import { getUiRequirements } from "./tools/get-ui-requirements.js";
import { syncContract } from "./tools/sync-contract.js";
import { generateClient } from "./tools/generate-client.js";
import { generateBackendCode } from "./tools/generate-backend-code.js";
import { saveMemory, recallMemory, listMemories, deleteMemory } from "./tools/memory.js";
import { searchCode, readSource } from "./tools/codebase.js";
import { smartContext } from "./tools/smart-context.js";
import { analyzeImpact } from "./tools/analyze-impact.js";
import { suggestPlan } from "./tools/suggest-plan.js";
import type { RepoConfig } from "./types.js";

// ── Repo paths (configurable via env vars) ──

const config: RepoConfig = {
  backendPath: resolve(
    process.env.BUILDERX_API_PATH || "../builderx_api"
  ),
  frontendPath: resolve(
    process.env.BUILDERX_SPA_PATH || "../builderx_spa"
  ),
};

// ── MCP Server ──

const server = new McpServer({
  name: "shared-knowledge-mcp",
  version: "1.0.0",
});

// ── Tool 1: get_api_schema ──
server.tool(
  "get_api_schema",
  "[DETAIL] Parse Phoenix backend to extract API endpoints with routes, controllers, params, response types, schemas, and context functions. Only use when smart_context doesn't provide enough detail. Use filters to narrow results.",
  {
    path_prefix: z
      .string()
      .optional()
      .describe("Filter by URL path prefix, e.g. '/api/v1/dashboard'"),
    method: z
      .string()
      .optional()
      .describe("Filter by HTTP method: GET, POST, PUT, DELETE"),
    controller: z
      .string()
      .optional()
      .describe("Filter by controller name (substring match)"),
    pipeline: z
      .string()
      .optional()
      .describe("Filter by pipeline name: api, auth, account, site"),
    include_schemas: z
      .boolean()
      .optional()
      .default(true)
      .describe("Include Ecto schema field details"),
    include_context: z
      .boolean()
      .optional()
      .default(false)
      .describe("Include context module function signatures"),
  },
  async (args) => {
    try {
      const result = await getApiSchema(config, args);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ── Tool 2: get_ui_requirements ──
server.tool(
  "get_ui_requirements",
  "[DETAIL] Parse Vue 3 frontend to extract API endpoint usage from API modules, composable fetch calls, and Pinia stores. Only use when smart_context doesn't provide enough detail.",
  {
    api_module: z
      .string()
      .optional()
      .describe("Filter by API module name, e.g. 'customerApi'"),
    store: z
      .string()
      .optional()
      .describe("Filter by Pinia store name, e.g. 'customer'"),
    url_pattern: z
      .string()
      .optional()
      .describe("Filter by URL pattern substring, e.g. '/customer'"),
    method: z
      .string()
      .optional()
      .describe("Filter by HTTP method: GET, POST"),
  },
  async (args) => {
    try {
      const result = await getUiRequirements(config, args);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ── Tool 3: sync_contract ──
server.tool(
  "sync_contract",
  "[CONTRACT] Compare backend API routes with frontend API usage to find mismatches: missing endpoints, unused routes, method mismatches. Use after code changes to verify contract integrity.",
  {
    severity: z
      .enum(["error", "warning", "info"])
      .optional()
      .describe("Minimum severity to show: error > warning > info"),
    endpoint_filter: z
      .string()
      .optional()
      .describe("Filter by endpoint path substring"),
    mismatches_only: z
      .boolean()
      .optional()
      .default(true)
      .describe("Only show endpoints with mismatches"),
  },
  async (args) => {
    try {
      const result = await syncContract(config, args);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ── Tool 4: generate_client ──
server.tool(
  "generate_client",
  "[GENERATE] Generate TypeScript/JavaScript API client code from Phoenix backend routes. Supports class-based (BaseApi) or Vue composable styles matching BuilderX SPA patterns.",
  {
    path_prefix: z
      .string()
      .optional()
      .describe("Generate clients for routes matching this prefix"),
    controller: z
      .string()
      .optional()
      .describe("Generate client for a specific controller"),
    format: z
      .enum(["typescript", "javascript"])
      .optional()
      .default("typescript")
      .describe("Output format"),
    style: z
      .enum(["composable", "class"])
      .optional()
      .default("class")
      .describe("'class' extends BaseApi (SPA pattern), 'composable' generates useXxxApi()"),
  },
  async (args) => {
    try {
      const result = await generateClient(config, args);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ── Tool 5: generate_backend_code ──
server.tool(
  "generate_backend_code",
  "[GENERATE] Generate Phoenix backend boilerplate (schema, context, controller, migration, route snippet) following BuilderX conventions: Citus sharding, UUID PKs, site_id scoping, FallbackController tuples.",
  {
    domain: z
      .string()
      .describe("Domain name in snake_case, e.g. 'loyalty_programs'"),
    table_name: z
      .string()
      .optional()
      .describe("Database table name (defaults to domain name)"),
    fields: z
      .array(
        z.object({
          name: z.string().describe("Field name"),
          type: z.string().describe("Elixir type, e.g. ':string', ':integer', ':map'"),
          default: z.string().optional().describe("Default value"),
        })
      )
      .describe("Schema fields"),
    actions: z
      .array(z.string())
      .optional()
      .default(["index", "show", "create", "update", "delete"])
      .describe("Controller actions to generate"),
    sharded: z
      .boolean()
      .optional()
      .default(true)
      .describe("Whether the table is Citus-sharded by site_id"),
    route_scope: z
      .string()
      .optional()
      .default("/dashboard")
      .describe("Route scope prefix"),
    permissions: z
      .array(z.string())
      .optional()
      .describe("Required site permissions, e.g. ['view_loyalty', 'manage_loyalty']"),
  },
  async (args) => {
    try {
      const result = await generateBackendCode(config, args);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ── Tool 6: save_memory ──
server.tool(
  "save_memory",
  "[MEMORY] Save business knowledge, rules, decisions, or analysis to persistent memory. ALWAYS save when discovering new business rules or making architecture decisions. AI agents recall this across conversations.",
  {
    category: z
      .enum(["business", "tasks", "analysis", "decisions"])
      .describe("Memory category: business (domain rules), tasks (work history), analysis (API cache), decisions (architecture)"),
    title: z
      .string()
      .describe("Short descriptive title for the memory"),
    content: z
      .string()
      .describe("Full content — business rules, task details, analysis results, etc."),
    tags: z
      .array(z.string())
      .optional()
      .describe("Tags for filtering, e.g. ['customer', 'order', 'api']"),
    id: z
      .string()
      .optional()
      .describe("If provided, updates existing memory with this ID instead of creating new"),
  },
  async (args) => {
    try {
      const result = await saveMemory(args);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ── Tool 7: recall_memory ──
server.tool(
  "recall_memory",
  "[PRIMARY for business rules] Search saved business rules, past decisions, domain knowledge. Use when question involves business logic, past decisions, or domain constraints. Use BEFORE coding to check existing rules.",
  {
    query: z
      .string()
      .optional()
      .describe("Search query — matches title, content, and tags"),
    category: z
      .enum(["business", "tasks", "analysis", "decisions"])
      .optional()
      .describe("Filter by category"),
    tag: z
      .string()
      .optional()
      .describe("Filter by exact tag match"),
    limit: z
      .number()
      .optional()
      .default(10)
      .describe("Max results to return (default 10)"),
  },
  async (args) => {
    try {
      const result = await recallMemory(args);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ── Tool 8: list_memories ──
server.tool(
  "list_memories",
  "List all saved memories, optionally filtered by category. Returns title, tags, and last updated time for each entry.",
  {
    category: z
      .enum(["business", "tasks", "analysis", "decisions"])
      .optional()
      .describe("Filter by category (omit to list all)"),
  },
  async (args) => {
    try {
      const result = await listMemories(args);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ── Tool 9: delete_memory ──
server.tool(
  "delete_memory",
  "Delete a saved memory by category and ID. Use list_memories first to find the ID.",
  {
    category: z
      .enum(["business", "tasks", "analysis", "decisions"])
      .describe("Category of the memory to delete"),
    id: z
      .string()
      .describe("Memory ID (the slug, e.g. 'customer-order-flow')"),
  },
  async (args) => {
    try {
      const result = await deleteMemory(args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          { type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` },
        ],
        isError: true,
      };
    }
  }
);

// ── Tool 10: search_code ──
server.tool(
  "search_code",
  "[LOW PRIORITY] Direct code search across repos. Only use when smart_context and analyze_impact don't provide enough detail. Prefer smart_context for understanding, analyze_impact for changes.",
  {
    query: z
      .string()
      .describe("Search pattern (regex supported), e.g. 'def create_order', 'useApipost.*customer'"),
    repo: z
      .enum(["backend", "frontend", "both"])
      .optional()
      .default("both")
      .describe("Which repo to search"),
    file_pattern: z
      .string()
      .optional()
      .describe("Glob filter for files, e.g. '*.ex', '*.vue', '*.js'"),
    limit: z
      .number()
      .optional()
      .default(20)
      .describe("Max results (default 20)"),
    context_lines: z
      .number()
      .optional()
      .default(2)
      .describe("Lines of context around each match (default 2)"),
  },
  async (args) => {
    try {
      const result = await searchCode(config, args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          { type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` },
        ],
        isError: true,
      };
    }
  }
);

// ── Tool 11: read_source ──
server.tool(
  "read_source",
  "[LOW PRIORITY] Read raw source file. Only use when you need exact code AFTER smart_context/analyze_impact provided the file location. Do not use for exploration.",
  {
    repo: z
      .enum(["backend", "frontend"])
      .describe("Which repo: 'backend' (Phoenix) or 'frontend' (Vue)"),
    file_path: z
      .string()
      .describe("File path relative to repo root, e.g. 'lib/builderx_api/orders/orders.ex'"),
    start_line: z
      .number()
      .optional()
      .describe("Start line (1-based, default: beginning of file)"),
    num_lines: z
      .number()
      .optional()
      .describe("Number of lines to read (default: entire file, max 500)"),
  },
  async (args) => {
    try {
      const result = await readSource(config, args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          { type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` },
        ],
        isError: true,
      };
    }
  }
);

// ── Tool 12: smart_context ──
server.tool(
  "smart_context",
  "[PRIMARY] ONE call answers any question about system, API, flow, architecture. Auto-analyzes all layers (routes → schemas → controllers → frontend → stores → memory). Returns structured format: Purpose, Flow, Key Components, Dependencies, Risks. USE THIS FIRST before any other tool. Saves 70%+ tokens.",
  {
    question: z
      .string()
      .describe("Natural language question, e.g. 'How does the order API work?', 'What calls the customer endpoint?', 'Show me product schema'"),
    depth: z
      .enum(["brief", "detailed"])
      .optional()
      .default("brief")
      .describe("'brief' = compact summary, 'detailed' = full field lists and file paths"),
  },
  async (args) => {
    try {
      const result = await smartContext(config, args);
      return {
        content: [{ type: "text" as const, text: result }],
      };
    } catch (error) {
      return {
        content: [
          { type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` },
        ],
        isError: true,
      };
    }
  }
);

// ── Tool 13: analyze_impact ──
server.tool(
  "analyze_impact",
  "[PRIMARY for changes] Use BEFORE modifying code, schema, or refactoring. Traces full dependency chain across backend + frontend. Returns structured format: What is affected, Why, Risk level (LOW/MEDIUM/HIGH), Suggested approach.",
  {
    target: z
      .string()
      .describe("File path or function name, e.g. 'lib/builderx_api/orders/order.ex', 'create_order', 'orderApi.js'"),
    repo: z
      .enum(["backend", "frontend", "auto"])
      .optional()
      .default("auto")
      .describe("Which repo. 'auto' detects from file extension"),
    direction: z
      .enum(["both", "dependents", "dependencies"])
      .optional()
      .default("both")
      .describe("'dependents' = what breaks, 'dependencies' = what this uses"),
    depth: z
      .number()
      .optional()
      .default(3)
      .describe("Trace depth 1-5 (default 3)"),
  },
  async (args) => {
    try {
      const result = await analyzeImpact(config, args);
      return {
        content: [{ type: "text" as const, text: result }],
      };
    } catch (error) {
      return {
        content: [
          { type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` },
        ],
        isError: true,
      };
    }
  }
);

// ── Tool 14: suggest_plan ──
server.tool(
  "suggest_plan",
  "[PLAN] Generate implementation plan for any task. Auto-checks memory (business rules) + analyzes current code + traces impact. Returns: business rules, related code, step-by-step plan, impact assessment, checklist. Follows BuilderX conventions.",
  {
    task: z
      .string()
      .describe("Mô tả task cần làm, vd: 'Thêm tính năng giảm giá cho order', 'Fix bug customer không tạo được'"),
    depth: z
      .enum(["brief", "detailed"])
      .optional()
      .default("brief")
      .describe("'brief' = plan gọn, 'detailed' = bao gồm code locations + full field lists"),
  },
  async (args) => {
    try {
      const result = await suggestPlan(config, args);
      return {
        content: [{ type: "text" as const, text: result }],
      };
    } catch (error) {
      return {
        content: [
          { type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` },
        ],
        isError: true,
      };
    }
  }
);

// ── Start server ──

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `shared-knowledge-mcp started (backend: ${config.backendPath}, frontend: ${config.frontendPath})`
  );
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

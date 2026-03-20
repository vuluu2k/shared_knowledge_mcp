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
import { saveMemory, recallMemory, listMemories } from "./tools/memory.js";
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
  "Parse Phoenix backend to extract all API endpoints with routes, controllers, params, response types, schemas, and context functions. Use filters to narrow results.",
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
  "Parse Vue 3 frontend to extract all API endpoint usage from API modules, composable fetch calls, and Pinia stores. Shows what the frontend expects from the backend.",
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
  "Compare backend API routes with frontend API usage to find mismatches: missing endpoints, unused routes, method mismatches. The core contract analysis tool.",
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
  "Generate TypeScript/JavaScript API client code from Phoenix backend routes. Supports class-based (BaseApi) or Vue composable styles matching BuilderX SPA patterns.",
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
  "Generate Phoenix backend boilerplate (schema, context, controller, migration, route snippet) following BuilderX conventions: Citus sharding, UUID PKs, site_id scoping, FallbackController tuples.",
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
  "Save business knowledge, task results, analysis, or decisions to long-term memory (GitHub repo). AI agents can recall this later across conversations.",
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
  "Search and retrieve saved memories by query, category, or tag. Use this to recall business context, past task results, or architecture decisions.",
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

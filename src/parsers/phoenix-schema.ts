import { readFileSync } from "fs";
import { glob } from "glob";
import type { EctoSchema, SchemaField, AssociationInfo } from "../types.js";

/**
 * Parse all Ecto schema files from the backend repo.
 */
export async function parsePhoenixSchemas(
  backendPath: string
): Promise<EctoSchema[]> {
  // Find schema files (exclude context modules which are the *s.ex pattern)
  const schemaFiles = await glob(
    "lib/builderx_api/**/*.ex",
    { cwd: backendPath, absolute: true }
  );

  const schemas: EctoSchema[] = [];

  for (const file of schemaFiles) {
    const content = readFileSync(file, "utf-8");
    // Only parse files that contain `schema` macro
    if (!content.includes("schema \"") && !content.includes("schema(\""))
      continue;

    const parsed = extractSchema(content, file);
    if (parsed) schemas.push(parsed);
  }

  return schemas;
}

function extractSchema(
  content: string,
  filePath: string
): EctoSchema | null {
  const lines = content.split("\n");

  // Extract module name
  const moduleMatch = content.match(/defmodule\s+([\w.]+)\s+do/);
  if (!moduleMatch) return null;
  const moduleName = moduleMatch[1];

  // Extract table name
  const tableMatch = content.match(/schema\s+"(\w+)"\s+do/);
  if (!tableMatch) return null;
  const tableName = tableMatch[1];

  // Extract fields
  const fields: SchemaField[] = [];
  const associations: AssociationInfo[] = [];

  const fieldRegex =
    /field\s+:(\w+),\s*([^,\n]+?)(?:,\s*default:\s*(.+?))?$/gm;
  let match: RegExpExecArray | null;

  while ((match = fieldRegex.exec(content)) !== null) {
    const [, name, typeStr, defaultVal] = match;
    fields.push({
      name,
      type: typeStr.trim(),
      default: defaultVal?.trim(),
    });
  }

  // Extract associations
  const assocRegex =
    /(belongs_to|has_many|has_one|many_to_many)\s*[\(:](\w+),?\s*([\w.]+)/g;
  while ((match = assocRegex.exec(content)) !== null) {
    const [, type, name, target] = match;
    const fkMatch = content.match(
      new RegExp(
        `${type}[^)]*${name}[^)]*foreign_key:\\s*:(\\w+)`
      )
    );
    associations.push({
      type: type as AssociationInfo["type"],
      name,
      target: target.replace("BuilderxApi.", ""),
      foreignKey: fkMatch?.[1],
    });
  }

  // Extract JSON rendering fields (from json/1 function)
  const jsonFields = extractJsonFields(content);

  // Extract private fields
  const privateMatch = content.match(
    /@private_fields\s+\[([^\]]+)\]/
  );
  const privateFields = privateMatch
    ? privateMatch[1]
        .split(",")
        .map((f) => f.trim().replace(/^:/, ""))
    : [];

  return {
    module: moduleName,
    tableName,
    fields,
    associations,
    jsonFields,
    privateFields,
    filePath,
  };
}

function extractJsonFields(content: string): string[] {
  // Look for Map.take patterns in json/1
  const takeMatch = content.match(
    /Map\.take\(\s*\w+\s*,\s*\[([^\]]+)\]/
  );
  if (takeMatch) {
    return takeMatch[1]
      .split(",")
      .map((f) => f.trim().replace(/^:/, ""))
      .filter(Boolean);
  }

  // Look for @private_fields exclusion pattern
  const privateMatch = content.match(
    /@private_fields\s+\[([^\]]+)\]/
  );
  if (privateMatch && content.includes("__schema__(:fields) -- @private_fields")) {
    // All fields minus private ones = JSON fields
    return ["__all_minus_private__"];
  }

  return [];
}

/**
 * Find schema by module name or table name.
 */
export function findSchema(
  schemas: EctoSchema[],
  query: string
): EctoSchema | undefined {
  const q = query.toLowerCase();
  return schemas.find(
    (s) =>
      s.module.toLowerCase().includes(q) ||
      s.tableName.toLowerCase() === q
  );
}

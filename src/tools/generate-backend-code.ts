import type { RepoConfig } from "../types.js";

export interface GenerateBackendCodeArgs {
  /** Domain name, e.g. "loyalty_programs" */
  domain: string;
  /** Table name, e.g. "loyalty_programs" */
  table_name?: string;
  /** Schema fields as array of {name, type, default?} */
  fields: { name: string; type: string; default?: string }[];
  /** Actions to generate: "crud" or specific list */
  actions?: string[];
  /** Whether this is a sharded (tenant-scoped) table */
  sharded?: boolean;
  /** Route scope prefix, e.g. "/dashboard" */
  route_scope?: string;
  /** Required permissions for actions */
  permissions?: string[];
}

export async function generateBackendCode(
  _config: RepoConfig,
  args: GenerateBackendCodeArgs
) {
  const domain = args.domain;
  const tableName = args.table_name || domain;
  const sharded = args.sharded !== false;
  const actions = args.actions || ["index", "show", "create", "update", "delete"];
  const routeScope = args.route_scope || "/dashboard";
  const permissions = args.permissions || [];

  const moduleParts = domain
    .split("_")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");

  const singularModule = moduleParts.replace(/s$/, "");
  const singularVar = domain.replace(/s$/, "");

  const files: { filename: string; path: string; content: string }[] = [];

  // 1. Schema file
  files.push({
    filename: `${singularVar}.ex`,
    path: `lib/builderx_api/${domain}/${singularVar}.ex`,
    content: generateSchema(singularModule, tableName, args.fields, sharded),
  });

  // 2. Context module
  files.push({
    filename: `${domain}.ex`,
    path: `lib/builderx_api/${domain}/${domain}.ex`,
    content: generateContext(moduleParts, singularModule, singularVar, domain, args.fields, sharded),
  });

  // 3. Controller
  files.push({
    filename: `${singularVar}_controller.ex`,
    path: `lib/builderx_api_web/controllers/v1/${domain}/${singularVar}_controller.ex`,
    content: generateController(
      moduleParts,
      singularModule,
      singularVar,
      domain,
      actions,
      permissions,
      sharded
    ),
  });

  // 4. Migration
  files.push({
    filename: `create_${tableName}.exs`,
    path: `priv/repo/migrations/XXXXXX_create_${tableName}.exs`,
    content: generateMigration(tableName, args.fields, sharded),
  });

  // 5. Route snippet
  const routeSnippet = generateRouteSnippet(
    routeScope,
    singularVar,
    singularModule,
    actions
  );

  return {
    domain,
    filesGenerated: files.length,
    files,
    routeSnippet,
    instructions: [
      `1. Create the files in the listed paths`,
      `2. Add the route snippet to lib/builderx_api_web/router/router.ex`,
      `3. Run: mix ecto.migrate`,
      sharded
        ? `4. Distribute the table: SELECT create_distributed_table('${tableName}', 'site_id');`
        : null,
    ].filter(Boolean),
  };
}

function generateSchema(
  moduleName: string,
  tableName: string,
  fields: GenerateBackendCodeArgs["fields"],
  sharded: boolean
): string {
  const lines: string[] = [];

  lines.push(`defmodule BuilderxApi.${moduleName}.${moduleName.replace(/s$/, "")} do`);
  lines.push(`  use Ecto.Schema`);
  lines.push(`  import Ecto.Changeset`);
  lines.push(``);
  lines.push(`  @primary_key {:id, :binary_id, autogenerate: true}`);
  lines.push(`  @foreign_key_type :binary_id`);
  lines.push(``);
  lines.push(`  schema "${tableName}" do`);

  if (sharded) {
    lines.push(
      `    belongs_to :site, BuilderxApi.Sites.Site, type: Ecto.UUID, primary_key: true`
    );
  }

  for (const field of fields) {
    let fieldLine = `    field :${field.name}, ${field.type}`;
    if (field.default !== undefined) {
      fieldLine += `, default: ${field.default}`;
    }
    lines.push(fieldLine);
  }

  lines.push(``);
  lines.push(`    timestamps()`);
  lines.push(`  end`);
  lines.push(``);

  // Changeset
  const fieldNames = fields.map((f) => f.name);
  lines.push(`  @required_fields [${fieldNames.map((f) => `:${f}`).join(", ")}]`);
  lines.push(``);
  lines.push(`  def changeset(%__MODULE__{} = struct, attrs) do`);
  lines.push(`    fields = __schema__(:fields) -- [:id, :inserted_at, :updated_at]`);
  lines.push(``);
  lines.push(`    struct`);
  lines.push(`    |> cast(attrs, fields)`);
  lines.push(`    |> validate_required(@required_fields)`);
  lines.push(`  end`);
  lines.push(``);

  // JSON rendering
  lines.push(`  def json(%__MODULE__{} = record) do`);
  lines.push(`    Map.take(record, __schema__(:fields))`);
  lines.push(`  end`);
  lines.push(``);
  lines.push(`  def json(records) when is_list(records) do`);
  lines.push(`    Enum.map(records, &json/1)`);
  lines.push(`  end`);
  lines.push(``);
  lines.push(`  def json(_), do: nil`);
  lines.push(`end`);

  return lines.join("\n");
}

function generateContext(
  moduleParts: string,
  singularModule: string,
  singularVar: string,
  domain: string,
  fields: GenerateBackendCodeArgs["fields"],
  sharded: boolean
): string {
  const repo = sharded ? "BuilderxApi.Citus" : "BuilderxApi.Repo";
  const lines: string[] = [];

  lines.push(`defmodule BuilderxApi.${moduleParts} do`);
  lines.push(`  import Ecto.Query, warn: false`);
  lines.push(``);
  lines.push(`  alias ${repo}, as: Repo`);
  lines.push(
    `  alias BuilderxApi.${moduleParts}.${singularModule}`
  );
  lines.push(``);

  // List
  if (sharded) {
    lines.push(
      `  def list_${domain}(site_id, params \\\\ %{}) do`
    );
    lines.push(`    page = Map.get(params, "page", 1)`);
    lines.push(`    limit = Map.get(params, "limit", 20)`);
    lines.push(`    offset = (page - 1) * limit`);
    lines.push(``);
    lines.push(`    query =`);
    lines.push(`      ${singularModule}`);
    lines.push(
      `      |> where([r], r.site_id == ^site_id)`
    );
    lines.push(`      |> order_by([r], desc: r.inserted_at)`);
    lines.push(``);
    lines.push(`    total = Repo.aggregate(query, :count)`);
    lines.push(
      `    data = query |> limit(^limit) |> offset(^offset) |> Repo.all()`
    );
    lines.push(``);
    lines.push(
      `    {:ok, %{data: data, total_entries: total, page: page, limit: limit}}`
    );
    lines.push(`  end`);
  } else {
    lines.push(`  def list_${domain}(params \\\\ %{}) do`);
    lines.push(`    {:ok, Repo.all(${singularModule})}`);
    lines.push(`  end`);
  }
  lines.push(``);

  // Get by ID
  if (sharded) {
    lines.push(
      `  def get_${singularVar}(site_id, id) do`
    );
    lines.push(`    ${singularModule}`);
    lines.push(
      `    |> where([r], r.site_id == ^site_id and r.id == ^id)`
    );
    lines.push(`    |> Repo.one()`);
    lines.push(`    |> case do`);
    lines.push(`      nil -> {:error, :not_found}`);
    lines.push(`      record -> {:ok, record}`);
    lines.push(`    end`);
    lines.push(`  end`);
  } else {
    lines.push(`  def get_${singularVar}(id) do`);
    lines.push(`    case Repo.get(${singularModule}, id) do`);
    lines.push(`      nil -> {:error, :not_found}`);
    lines.push(`      record -> {:ok, record}`);
    lines.push(`    end`);
    lines.push(`  end`);
  }
  lines.push(``);

  // Create
  lines.push(`  def create_${singularVar}(attrs) do`);
  lines.push(`    %${singularModule}{}`);
  lines.push(`    |> ${singularModule}.changeset(attrs)`);
  lines.push(`    |> Repo.insert()`);
  lines.push(`  end`);
  lines.push(``);

  // Update
  lines.push(
    `  def update_${singularVar}(%${singularModule}{} = record, attrs) do`
  );
  lines.push(`    record`);
  lines.push(`    |> ${singularModule}.changeset(attrs)`);
  lines.push(`    |> Repo.update()`);
  lines.push(`  end`);
  lines.push(``);

  // Delete
  if (sharded) {
    lines.push(
      `  def delete_${singularVar}(site_id, id) do`
    );
    lines.push(`    case get_${singularVar}(site_id, id) do`);
    lines.push(`      {:ok, record} -> Repo.delete(record)`);
    lines.push(`      error -> error`);
    lines.push(`    end`);
    lines.push(`  end`);
  } else {
    lines.push(`  def delete_${singularVar}(id) do`);
    lines.push(`    case get_${singularVar}(id) do`);
    lines.push(`      {:ok, record} -> Repo.delete(record)`);
    lines.push(`      error -> error`);
    lines.push(`    end`);
    lines.push(`  end`);
  }

  lines.push(`end`);

  return lines.join("\n");
}

function generateController(
  moduleParts: string,
  singularModule: string,
  singularVar: string,
  domain: string,
  actions: string[],
  permissions: string[],
  sharded: boolean
): string {
  const lines: string[] = [];

  lines.push(
    `defmodule BuilderxApiWeb.V1.${singularModule}Controller do`
  );
  lines.push(`  use BuilderxApiWeb, :controller`);
  lines.push(``);
  lines.push(`  alias BuilderxApi.${moduleParts}`);
  lines.push(
    `  alias BuilderxApi.${moduleParts}.${singularModule}`
  );
  lines.push(``);

  // Permission plugs
  if (permissions.length > 0) {
    const viewPerms = permissions.filter((p) => p.startsWith("view_"));
    const writePerms = permissions;

    if (viewPerms.length > 0) {
      const readActions = actions
        .filter((a) => ["index", "show"].includes(a))
        .map((a) => `:${a}`)
        .join(", ");
      if (readActions) {
        lines.push(
          `  plug BuilderxApiWeb.Plug.SitePermissionPlug,`
        );
        lines.push(
          `    [site_permissions: [${viewPerms.map((p) => `"${p}"`).join(", ")}]] when action in [${readActions}]`
        );
        lines.push(``);
      }
    }

    const writeActions = actions
      .filter((a) => !["index", "show"].includes(a))
      .map((a) => `:${a}`)
      .join(", ");
    if (writeActions) {
      lines.push(
        `  plug BuilderxApiWeb.Plug.SitePermissionPlug,`
      );
      lines.push(
        `    [site_permissions: [${writePerms.map((p) => `"${p}"`).join(", ")}]] when action in [${writeActions}]`
      );
      lines.push(``);
    }
  }

  // Index
  if (actions.includes("index")) {
    lines.push(`  def index(conn, params) do`);
    if (sharded) {
      lines.push(`    site_id = conn.assigns.site.id`);
      lines.push(
        `    with {:ok, result} <- ${moduleParts}.list_${domain}(site_id, params) do`
      );
    } else {
      lines.push(
        `    with {:ok, result} <- ${moduleParts}.list_${domain}(params) do`
      );
    }
    lines.push(
      `      data = ${singularModule}.json(result.data)`
    );
    lines.push(
      `      {:success, :with_data, "${domain}", Map.put(result, :data, data)}`
    );
    lines.push(`    end`);
    lines.push(`  end`);
    lines.push(``);
  }

  // Show
  if (actions.includes("show")) {
    lines.push(`  def show(conn, %{"id" => id}) do`);
    if (sharded) {
      lines.push(`    site_id = conn.assigns.site.id`);
      lines.push(
        `    with {:ok, record} <- ${moduleParts}.get_${singularVar}(site_id, id) do`
      );
    } else {
      lines.push(
        `    with {:ok, record} <- ${moduleParts}.get_${singularVar}(id) do`
      );
    }
    lines.push(
      `      {:success, :with_data, "${singularVar}", ${singularModule}.json(record)}`
    );
    lines.push(`    else`);
    lines.push(
      `      {:error, :not_found} -> {:failed, :with_reason, "${singularModule} not found"}`
    );
    lines.push(`    end`);
    lines.push(`  end`);
    lines.push(``);
  }

  // Create
  if (actions.includes("create")) {
    lines.push(`  def create(conn, params) do`);
    if (sharded) {
      lines.push(`    site_id = conn.assigns.site.id`);
      lines.push(
        `    attrs = Map.put(params, "site_id", site_id)`
      );
    } else {
      lines.push(`    attrs = params`);
    }
    lines.push(``);
    lines.push(
      `    case ${moduleParts}.create_${singularVar}(attrs) do`
    );
    lines.push(
      `      {:ok, record} -> {:success, :with_data, "${singularVar}", ${singularModule}.json(record)}`
    );
    lines.push(
      `      {:error, changeset} -> {:error, changeset}`
    );
    lines.push(`    end`);
    lines.push(`  end`);
    lines.push(``);
  }

  // Update
  if (actions.includes("update")) {
    lines.push(
      `  def update(conn, %{"id" => id} = params) do`
    );
    if (sharded) {
      lines.push(`    site_id = conn.assigns.site.id`);
      lines.push(``);
      lines.push(
        `    with {:ok, record} <- ${moduleParts}.get_${singularVar}(site_id, id),`
      );
    } else {
      lines.push(
        `    with {:ok, record} <- ${moduleParts}.get_${singularVar}(id),`
      );
    }
    lines.push(
      `         {:ok, updated} <- ${moduleParts}.update_${singularVar}(record, params) do`
    );
    lines.push(
      `      {:success, :with_data, "${singularVar}", ${singularModule}.json(updated)}`
    );
    lines.push(`    else`);
    lines.push(
      `      {:error, :not_found} -> {:failed, :with_reason, "${singularModule} not found"}`
    );
    lines.push(
      `      {:error, changeset} -> {:error, changeset}`
    );
    lines.push(`    end`);
    lines.push(`  end`);
    lines.push(``);
  }

  // Delete
  if (actions.includes("delete")) {
    lines.push(
      `  def delete(conn, %{"id" => id}) do`
    );
    if (sharded) {
      lines.push(`    site_id = conn.assigns.site.id`);
      lines.push(``);
      lines.push(
        `    case ${moduleParts}.delete_${singularVar}(site_id, id) do`
      );
    } else {
      lines.push(
        `    case ${moduleParts}.delete_${singularVar}(id) do`
      );
    }
    lines.push(`      {:ok, _} -> {:success, :success_only}`);
    lines.push(
      `      {:error, :not_found} -> {:failed, :with_reason, "${singularModule} not found"}`
    );
    lines.push(`    end`);
    lines.push(`  end`);
  }

  lines.push(`end`);

  return lines.join("\n");
}

function generateMigration(
  tableName: string,
  fields: GenerateBackendCodeArgs["fields"],
  sharded: boolean
): string {
  const lines: string[] = [];
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .slice(0, 14);

  lines.push(
    `defmodule BuilderxApi.Repo.Migrations.Create${pascalCase(tableName)} do`
  );
  lines.push(`  use Ecto.Migration`);
  lines.push(``);
  lines.push(`  def change do`);
  lines.push(`    create table(:${tableName}, primary_key: false) do`);
  lines.push(
    `      add :id, :binary_id, primary_key: true`
  );

  if (sharded) {
    lines.push(
      `      add :site_id, references(:sites, type: :binary_id, on_delete: :delete_all), null: false`
    );
  }

  for (const field of fields) {
    const migType = elixirToMigrationType(field.type);
    let line = `      add :${field.name}, ${migType}`;
    if (field.default !== undefined) {
      line += `, default: ${field.default}`;
    }
    lines.push(line);
  }

  lines.push(``);
  lines.push(`      timestamps()`);
  lines.push(`    end`);
  lines.push(``);

  if (sharded) {
    lines.push(
      `    create index(:${tableName}, [:site_id])`
    );
  }

  lines.push(`  end`);
  lines.push(`end`);

  return lines.join("\n");
}

function generateRouteSnippet(
  routeScope: string,
  singularVar: string,
  singularModule: string,
  actions: string[]
): string {
  const lines: string[] = [];
  lines.push(`# Add to lib/builderx_api_web/router/router.ex`);
  lines.push(`# Inside the appropriate scope block:`);
  lines.push(``);
  lines.push(`scope "${routeScope}" do`);
  lines.push(`  scope "/${singularVar}" do`);

  if (actions.includes("index")) {
    lines.push(
      `    get "/all", ${singularModule}Controller, :index`
    );
  }
  if (actions.includes("show")) {
    lines.push(
      `    get "/edit", ${singularModule}Controller, :show`
    );
  }
  if (actions.includes("create")) {
    lines.push(
      `    post "/create", ${singularModule}Controller, :create`
    );
  }
  if (actions.includes("update")) {
    lines.push(
      `    post "/update", ${singularModule}Controller, :update`
    );
  }
  if (actions.includes("delete")) {
    lines.push(
      `    post "/delete", ${singularModule}Controller, :delete`
    );
  }

  lines.push(`  end`);
  lines.push(`end`);

  return lines.join("\n");
}

function elixirToMigrationType(type: string): string {
  const map: Record<string, string> = {
    ":string": ":string",
    ":integer": ":integer",
    ":float": ":float",
    ":boolean": ":boolean",
    ":map": ":map",
    ":text": ":text",
    ":date": ":date",
    ":utc_datetime": ":utc_datetime",
    ":naive_datetime": ":naive_datetime",
    ":binary_id": ":binary_id",
  };

  if (type.includes("{:array,")) {
    return `{:array, ${type.match(/\{:array,\s*(.+)\}/)?.[1] || ":string"}}`;
  }

  return map[type] || type;
}

function pascalCase(str: string): string {
  return str
    .split(/[-_]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
}

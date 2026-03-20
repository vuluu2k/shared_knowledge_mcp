// ── Backend (Phoenix) types ──

export interface PhoenixRoute {
  method: string;
  path: string;
  controller: string;
  action: string;
  pipelines: string[];
  scope: string;
}

export interface ControllerAction {
  controller: string;
  action: string;
  params: ParamInfo[];
  responseType: string;
  plugs: PlugInfo[];
  filePath: string;
  lineNumber: number;
}

export interface ParamInfo {
  name: string;
  source: "path" | "body" | "query" | "conn_assigns";
  required: boolean;
}

export interface PlugInfo {
  name: string;
  options: Record<string, unknown>;
  guardedActions: string[];
}

export interface SchemaField {
  name: string;
  type: string;
  default?: unknown;
  association?: string;
}

export interface EctoSchema {
  module: string;
  tableName: string;
  fields: SchemaField[];
  associations: AssociationInfo[];
  jsonFields: string[];
  privateFields: string[];
  filePath: string;
}

export interface AssociationInfo {
  type: "belongs_to" | "has_many" | "has_one" | "many_to_many";
  name: string;
  target: string;
  foreignKey?: string;
}

export interface ContextFunction {
  module: string;
  name: string;
  arity: number;
  hasSiteId: boolean;
  repo: string;
  filePath: string;
  lineNumber: number;
}

// ── Frontend (Vue) types ──

export interface ApiEndpointUsage {
  module: string;
  method: string;
  functionName: string;
  httpMethod: string;
  urlPattern: string;
  params: string[];
  responseFields: string[];
  filePath: string;
  lineNumber: number;
}

export interface StoreAction {
  store: string;
  action: string;
  apiCalls: ApiCallInfo[];
  stateUpdates: string[];
  filePath: string;
}

export interface ApiCallInfo {
  apiModule: string;
  method: string;
  url: string;
  httpMethod: string;
}

// ── Contract types ──

export interface ApiContract {
  endpoint: string;
  method: string;
  backendRoute?: PhoenixRoute;
  backendAction?: ControllerAction;
  frontendUsages: ApiEndpointUsage[];
  mismatches: ContractMismatch[];
}

export interface ContractMismatch {
  type: "missing_backend" | "missing_frontend" | "param_mismatch" | "response_mismatch" | "method_mismatch";
  detail: string;
  severity: "error" | "warning" | "info";
}

// ── Config ──

export interface RepoConfig {
  backendPath: string;
  frontendPath: string;
}

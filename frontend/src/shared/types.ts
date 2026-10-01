/** ブラウザと Worker が共有する作業・行・操作の型。 */
export type Layout = {
  width: "half" | "full";
  height: number;
  manual?: boolean;
  pinned?: boolean;
  placement?: "table" | "detail" | "full";
};
export type Source = {
  name: string;
  size: number;
  modified: number;
  hash: string;
  count: number;
  start: number;
  handle?: FileSystemFileHandle;
};
export type Workspace = {
  id: string;
  name: string;
  sources: Source[];
  baseCount: number;
  added: number;
  head: number;
  tip: number;
  ready: boolean;
  scanned: number;
  issues: number;
  oversized: number;
  layouts: Record<string, Layout>;
  created: number;
};
export type Patch = {
  workspace: string;
  revision: number;
  row: number;
  text: string | null;
};
export type Row = {
  id: number;
  text?: string;
  title?: string;
  preview: string;
  issue?: string;
  oversized?: boolean;
  deleted?: boolean;
  bytes: number;
  source: string;
  edited: boolean;
};
export type Condition = {
  key: string;
  op: "contains" | "equals" | "exists" | "type";
  value: string;
};
export type Filter = {
  text: string;
  conditions: Condition[];
  issuesOnly?: boolean;
};
export type KeyOperation = {
  mode: "add" | "delete" | "rename";
  key: string;
  target: string;
  value: string;
  scope: "all" | "filtered" | "current";
  row: number;
};
export type ExportOptions = {
  mode: "single" | "rows" | "files" | "bytes";
  value: number;
  filtered: boolean;
  invalid: "keep" | "skip" | "stop";
  prefix: string;
};
export type Progress = {
  label: string;
  done: number;
  total: number;
  count?: number;
};
export type RpcRequest = { id: number; command: string; args: any };
export type RpcResponse = {
  id?: number;
  result?: any;
  error?: string;
  progress?: Progress;
  workspace?: Workspace;
};

import type {
  Workspace,
  Source,
  Row,
  Filter,
  KeyOperation,
  ExportOptions,
  RpcRequest,
  Patch,
} from "../shared/types";
import {
  CHUNK,
  MAX_ROW,
  decodeLine,
  encoder,
  parseRecord,
  jsonText,
} from "../shared/json";
import { scanFile, readEntry, hashFile } from "../records/index";
import { matches, transformKey } from "../operations/transform";
import * as storage from "./storage";

let workspace: Workspace | null = null;
let files: File[] = [],
  indexes: FileSystemSyncAccessHandle[] = [];
let directory: FileSystemDirectoryHandle;
let busy = false,
  cancelled = false,
  lastProgress = 0;
let releaseLock: (() => void) | undefined;
let filter: Filter = { text: "", conditions: [] };
let resultIndex: FileSystemSyncAccessHandle | undefined,
  resultCount = 0,
  filtered = false;
let byteCache:
  { source: number; offset: number; bytes: Uint8Array } | undefined;
let patchPage = { page: -1, head: -1, exists: false };
const totalRows = () => workspace!.baseCount + workspace!.added;
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const check = () => {
  if (cancelled)
    throw new Error("処理を中止しました。確定済みの編集内容は保持されています");
};
const emitWorkspace = () => postMessage({ workspace });
const progress = async (
  label: string,
  done: number,
  total: number,
  count?: number,
) => {
  check();
  if (performance.now() - lastProgress > 100 || done === total) {
    lastProgress = performance.now();
    postMessage({ progress: { label, done, total, count } });
    await pause();
    check();
  }
};
const requireReady = () => {
  if (!workspace?.ready) throw new Error("索引の作成完了後に操作してください");
};
const resetFilter = () => {
  filtered = false;
  resultCount = 0;
  filter = { text: "", conditions: [] };
};
const close = () => {
  for (const index of indexes) index.close();
  indexes = [];
  files = [];
  resultIndex?.close();
  resultIndex = undefined;
  byteCache = undefined;
  patchPage = { page: -1, head: -1, exists: false };
  releaseLock?.();
  releaseLock = undefined;
  workspace = null;
  resetFilter();
};
const lock = async (id: string) => {
  await new Promise<void>((resolve, reject) => {
    navigator.locks
      .request(`data-loom-${id}`, { ifAvailable: true }, async (lock) => {
        if (!lock) {
          reject(
            new Error(
              "この作業は別のタブで開かれています。そちらを閉じてください",
            ),
          );
          return;
        }
        await new Promise<void>((release) => {
          releaseLock = release;
          resolve();
        });
      })
      .catch(reject);
  });
};
const indexHandle = async (name: string) =>
  await (
    await directory.getFileHandle(name, { create: true })
  ).createSyncAccessHandle();

async function create(args: {
  handles?: FileSystemFileHandle[];
  files?: File[];
  name?: string;
}) {
  close();
  const handles = args.handles ?? [];
  files =
    args.files ??
    (await Promise.all(handles.map((handle) => handle.getFile())));
  if (files.length > 100)
    throw new Error("一度に開くファイルは100個までにしてください");
  const id = crypto.randomUUID();
  await lock(id);
  directory = await (
    await navigator.storage.getDirectory()
  ).getDirectoryHandle(id, { create: true });
  workspace = {
    id,
    name:
      args.name ??
      (files.length
        ? files[0].name + (files.length > 1 ? ` + ${files.length - 1}` : "")
        : "無題のデータセット"),
    sources: [],
    baseCount: 0,
    added: 0,
    head: 0,
    tip: 0,
    ready: false,
    scanned: 0,
    issues: 0,
    oversized: 0,
    layouts: Object.create(null),
    created: Date.now(),
  };
  await storage.saveWorkspace(workspace);
  emitWorkspace();
  const total = files.reduce((n, f) => n + f.size, 0);
  let scanned = 0,
    lastWorkspaceUpdate = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i],
      index = await indexHandle(`source-${i}.idx`);
    indexes.push(index);
    const source: Source = {
      name: file.name,
      size: file.size,
      modified: file.lastModified,
      hash: "",
      count: 0,
      start: workspace.baseCount,
      handle: handles[i],
    };
    workspace.sources.push(source);
    const priorIssues = workspace.issues,
      priorOversized = workspace.oversized;
    const result = await scanFile(
      file,
      index,
      async (bytes, count, issues, oversized, layouts) => {
        source.count = count;
        workspace!.baseCount = source.start + count;
        workspace!.scanned = scanned + bytes;
        workspace!.issues = priorIssues + issues;
        workspace!.oversized = priorOversized + oversized;
        for (const [key, layout] of Object.entries(layouts)) {
          const previous = workspace!.layouts[key];
          Object.defineProperty(workspace!.layouts, key, {
            value: {
              width:
                previous?.width === "full" || layout.width === "full"
                  ? "full"
                  : "half",
              height: Math.max(previous?.height ?? 0, layout.height),
            },
            enumerable: true,
            configurable: true,
            writable: true,
          });
        }
        if (performance.now() - lastWorkspaceUpdate > 250) {
          lastWorkspaceUpdate = performance.now();
          emitWorkspace();
        }
        await progress("ファイルを読み込み中", scanned + bytes, total, count);
      },
    );
    source.hash = result.hash;
    scanned += file.size;
    await storage.saveWorkspace(workspace);
  }
  workspace.ready = true;
  await storage.saveWorkspace(workspace);
  emitWorkspace();
  return workspace;
}
async function restore(args: {
  id: string;
  files?: File[];
  handles?: FileSystemFileHandle[];
}) {
  close();
  const saved = await storage.getWorkspace(args.id);
  if (!saved) throw new Error("保存済みの作業が見つかりません");
  if (!saved.ready)
    throw new Error(
      "読み込みが完了していない作業です。元ファイルを新しい作業として開いてください",
    );
  await lock(saved.id);
  try {
    const restored: File[] = [];
    const total = saved.sources.reduce((n, s) => n + s.size, 0);
    let done = 0;
    for (let i = 0; i < saved.sources.length; i++) {
      const source = saved.sources[i],
        handle = args.handles?.[i] ?? source.handle;
      const file = args.files?.[i] ?? (await handle?.getFile());
      if (!file) throw new Error("元ファイルを選択し直してください");
      if (file.size !== source.size || file.lastModified !== source.modified)
        throw new Error(
          `「${source.name}」が変更されています。差分は適用せず、新しい作業として開いてください`,
        );
      const hash = await hashFile(file, async (bytes) =>
        progress("元ファイルを照合中", done + bytes, total),
      );
      if (hash !== source.hash)
        throw new Error(
          `「${source.name}」の内容が変わっています。保存済み差分は適用していません`,
        );
      restored.push(file);
      if (args.handles?.[i]) source.handle = args.handles[i];
      done += file.size;
    }
    directory = await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle(saved.id);
    for (let i = 0; i < saved.sources.length; i++) {
      const index = await (
        await directory.getFileHandle(`source-${i}.idx`)
      ).createSyncAccessHandle();
      if (index.getSize() !== saved.sources[i].count * 24) {
        index.close();
        throw new Error("行索引が不足しています。作業を開き直してください");
      }
      indexes.push(index);
    }
    files = restored;
    workspace = saved;
    await storage.saveWorkspace(saved);
    emitWorkspace();
    return workspace;
  } catch (error) {
    close();
    throw error;
  }
}

type RawRow = {
  bytes?: Uint8Array;
  blob?: Blob;
  size: number;
  flags: number;
  source: string;
  first: boolean;
  edited: boolean;
  deleted: boolean;
};
async function rawRow(row: number): Promise<RawRow> {
  if (!workspace || !Number.isInteger(row) || row < 0 || row >= totalRows())
    throw new Error("行が見つかりません");
  const page = Math.floor(row / 2048);
  if (patchPage.page !== page || patchPage.head !== workspace.head)
    patchPage = {
      page,
      head: workspace.head,
      exists: await storage.hasPatches(
        workspace,
        page * 2048,
        page * 2048 + 2047,
      ),
    };
  const patch = patchPage.exists
    ? await storage.patchFor(workspace, row)
    : undefined;
  if (patch) {
    const bytes = encoder.encode(patch.text ?? "");
    return {
      bytes,
      size: bytes.length,
      flags: 0,
      source: row >= workspace.baseCount ? "追加した行" : "編集済み",
      first: false,
      edited: true,
      deleted: patch.text === null,
    };
  }
  const sourceIndex = workspace.sources.findIndex(
    (source) => row >= source.start && row < source.start + source.count,
  );
  if (sourceIndex < 0) throw new Error("追加行の差分が見つかりません");
  const source = workspace.sources[sourceIndex],
    entry = readEntry(indexes[sourceIndex], row - source.start);
  let blob: Blob | undefined, bytes: Uint8Array | undefined;
  if (entry.length > MAX_ROW)
    blob = files[sourceIndex].slice(entry.offset, entry.offset + entry.length);
  else {
    if (
      !byteCache ||
      byteCache.source !== sourceIndex ||
      entry.offset < byteCache.offset ||
      entry.offset + entry.length > byteCache.offset + byteCache.bytes.length
    ) {
      byteCache = {
        source: sourceIndex,
        offset: entry.offset,
        bytes: new Uint8Array(
          await files[sourceIndex]
            .slice(entry.offset, entry.offset + Math.max(CHUNK, entry.length))
            .arrayBuffer(),
        ),
      };
    }
    bytes = byteCache.bytes.subarray(
      entry.offset - byteCache.offset,
      entry.offset - byteCache.offset + entry.length,
    );
  }
  return {
    blob,
    bytes,
    size: entry.length,
    flags: entry.flags,
    source: source.name,
    first: row === source.start,
    edited: false,
    deleted: false,
  };
}
async function rowData(id: number, detail = false): Promise<Row> {
  const raw = await rawRow(id);
  const base = { id, bytes: raw.size, source: raw.source, edited: raw.edited };
  if (raw.deleted) return { ...base, deleted: true, preview: "削除した行" };
  if (raw.flags === 2)
    return {
      ...base,
      oversized: true,
      issue: "16 MiB を超えるため編集・検索は対象外です。元データは保持します",
      preview: "大きなレコード",
    };
  let text: string, issue: string | undefined;
  try {
    text = decodeLine(raw.bytes!, raw.first);
  } catch {
    return {
      ...base,
      issue: "UTF-8 として読み取れません",
      preview: "文字コードエラー",
    };
  }
  if (raw.flags === 1) {
    try {
      parseRecord(text);
    } catch (e) {
      issue = (e as Error).message;
    }
  }
  return {
    ...base,
    preview: text.slice(0, 180).replace(/\s+/g, " "),
    text: detail ? text : undefined,
    issue,
  };
}
async function listRows(args: { start: number; limit: number }) {
  const total = filtered ? resultCount : workspace ? totalRows() : 0;
  const rows: Row[] = [];
  for (
    let n = Math.max(0, args.start);
    n < Math.min(total, args.start + Math.min(args.limit, 80));
    n++
  ) {
    let id = n;
    if (filtered) {
      const bytes = new Uint8Array(8);
      resultIndex!.read(bytes, { at: n * 8 });
      id = new DataView(bytes.buffer).getFloat64(0, true);
    }
    rows.push(await rowData(id));
  }
  return { rows, total, filtered };
}
async function search(next: Filter) {
  requireReady();
  resultIndex?.close();
  resultIndex = await indexHandle("results.idx");
  resultIndex.truncate(0);
  resetFilter();
  let count = 0,
    skipped = 0;
  const buffer = new Uint8Array(8 * 8192);
  let filled = 0;
  const view = new DataView(buffer.buffer);
  const flush = () => {
    if (filled) {
      resultIndex!.write(buffer.subarray(0, filled * 8), {
        at: (count - filled) * 8,
      });
      filled = 0;
    }
  };
  try {
    for (let id = 0; id < totalRows(); id++) {
      const row = await rowData(id, true);
      if (row.oversized && !next.issuesOnly) skipped++;
      if (
        !row.deleted &&
        ((row.oversized &&
          next.issuesOnly &&
          !next.text &&
          !next.conditions.length) ||
          (!row.oversized && matches(row.text ?? "", next, !!row.issue)))
      ) {
        view.setFloat64(filled * 8, id, true);
        filled++;
        count++;
        if (filled === 8192) flush();
      }
      if (id % 2048 === 0) await progress("行を検索中", id, totalRows(), count);
    }
    flush();
    resultIndex.flush();
    resultCount = count;
    filter = next;
    filtered = true;
    await progress("検索完了", totalRows(), totalRows(), count);
    return { count, skipped };
  } catch (e) {
    resetFilter();
    throw e;
  }
}
async function mutate(args: {
  row?: number;
  text?: string | null;
  append?: boolean;
}) {
  requireReady();
  if (args.text !== null) {
    if (encoder.encode(args.text ?? "").length + 1 > MAX_ROW)
      throw new Error("編集できる1行の上限は16 MiBです");
    parseRecord(args.text ?? "");
  }
  const row = args.append ? totalRows() : args.row!;
  if (!args.append && (row < 0 || row >= totalRows()))
    throw new Error("行が見つかりません");
  await storage.clearFuture(workspace!);
  await storage.stagePatches([
    {
      workspace: workspace!.id,
      revision: workspace!.head + 1,
      row,
      text: args.text ?? null,
    },
  ]);
  workspace = await storage.commit(
    workspace!,
    workspace!.added + (args.append ? 1 : 0),
  );
  resetFilter();
  emitWorkspace();
  return workspace;
}
async function keyOperation(operation: KeyOperation, apply = false) {
  requireReady();
  if (!operation.key || (operation.mode === "rename" && !operation.target))
    throw new Error("KEY 名を入力してください");
  if (operation.scope === "filtered" && !filtered)
    throw new Error("先に検索を実行してください");
  let count = 0,
    skipped = 0,
    bufferBytes = 0;
  let patches: Patch[] = [];
  const examples: { row: number; before: string; after: string }[] = [];
  if (apply) await storage.clearFuture(workspace!);
  for (let id = 0; id < totalRows(); id++) {
    if (operation.scope === "current" && id !== operation.row) continue;
    if (id % 1024 === 0)
      await progress(
        apply ? "KEY を変更中" : "変更内容を確認中",
        id,
        totalRows(),
        count,
      );
    const row = await rowData(id, true);
    if (row.deleted) continue;
    if (
      operation.scope === "filtered" &&
      !matches(row.text ?? "", filter, !!row.issue)
    )
      continue;
    if (row.issue || row.oversized) {
      skipped++;
      continue;
    }
    let text: string;
    try {
      text = transformKey(row.text!, operation);
    } catch (e) {
      throw new Error(
        `${id + 1}行目: ${(e as Error).message}。変更は確定していません`,
      );
    }
    if (encoder.encode(text).length + 1 > MAX_ROW)
      throw new Error(
        `${id + 1}行目が16 MiBを超えます。変更は確定していません`,
      );
    if (text === jsonText(parseRecord(row.text!))) continue;
    count++;
    if (examples.length < 3)
      examples.push({
        row: id + 1,
        before: row.text!.slice(0, 300),
        after: text.slice(0, 300),
      });
    if (apply) {
      patches.push({
        workspace: workspace!.id,
        revision: workspace!.head + 1,
        row: id,
        text,
      });
      bufferBytes += text.length * 2;
      if (bufferBytes > CHUNK || patches.length >= 256) {
        await storage.stagePatches(patches);
        patches = [];
        bufferBytes = 0;
      }
    }
    if (id % 1024 === 0)
      await progress(
        apply ? "KEY を変更中" : "変更内容を確認中",
        id,
        totalRows(),
        count,
      );
  }
  if (apply && count) {
    if (patches.length) await storage.stagePatches(patches);
    workspace = await storage.commit(workspace!, workspace!.added);
    resetFilter();
    emitWorkspace();
  }
  return { count, skipped, examples };
}

async function exportData(args: {
  options: ExportOptions;
  handle?: FileSystemFileHandle;
  directory?: FileSystemDirectoryHandle;
}) {
  requireReady();
  const { options } = args;
  if (options.filtered && !filtered)
    throw new Error("先に検索を実行してください");
  if (
    options.mode !== "single" &&
    (!Number.isSafeInteger(options.value) || options.value < 1)
  )
    throw new Error("分割数は1以上の整数で指定してください");
  let eligible = 0,
    skipped = 0;
  const completed: string[] = [];
  const included = async (id: number) => {
    const raw = await rawRow(id);
    if (raw.deleted) return undefined;
    if (options.filtered) {
      if (raw.flags === 2) {
        if (!(filter.issuesOnly && !filter.text && !filter.conditions.length))
          return undefined;
      } else if (
        !matches(
          (() => {
            try {
              return decodeLine(raw.bytes!, raw.first);
            } catch {
              return "";
            }
          })(),
          filter,
          raw.flags === 1,
        )
      )
        return undefined;
    }
    if (raw.flags === 1) {
      if (options.invalid === "stop")
        throw new Error(
          `${id + 1}行目に不正なデータがあります。修正するか保持・除外を選んでください`,
        );
      if (options.invalid === "skip") return undefined;
    }
    return raw;
  };
  // 事前走査で不正行の扱いと均等分割件数を確定する。出力先はまだ変更しない。
  for (let id = 0; id < totalRows(); id++) {
    if (await included(id)) eligible++;
    else skipped++;
    if (id % 2048 === 0)
      await progress("書き出し対象を確認中", id, totalRows());
  }
  if (!eligible) throw new Error("書き出す行がありません");
  const fileCount =
    options.mode === "files" ? Math.min(options.value, eligible) : 0;
  let part = 0,
    partRows = 0,
    partBytes = 0,
    rows = 0,
    oversizeParts = 0;
  let stream: FileSystemWritableFileStream | undefined;
  let targetName = "";
  let buffer = new Uint8Array(CHUNK),
    buffered = 0;
  const flush = async () => {
    if (buffered) {
      await stream!.write(buffer.subarray(0, buffered));
      buffered = 0;
    }
  };
  const write = async (bytes: Uint8Array) => {
    let offset = 0;
    while (offset < bytes.length) {
      const length = Math.min(CHUNK - buffered, bytes.length - offset);
      buffer.set(bytes.subarray(offset, offset + length), buffered);
      buffered += length;
      offset += length;
      if (buffered === CHUNK) await flush();
    }
    partBytes += bytes.length;
  };
  const finish = async () => {
    if (stream) {
      await flush();
      await stream.close();
      stream = undefined;
      completed.push(targetName);
    }
  };
  const open = async () => {
    part++;
    partRows = 0;
    partBytes = 0;
    let handle: FileSystemFileHandle;
    if (options.mode === "single") {
      handle = args.handle!;
      targetName = handle.name;
    } else {
      const safe =
        options.prefix
          .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
          .slice(0, 120) || "dataset";
      targetName = `${safe}-${String(part).padStart(4, "0")}.jsonl`;
      try {
        await args.directory!.getFileHandle(targetName);
        throw new Error(
          `「${targetName}」は既に存在します。別の名前またはフォルダを選んでください`,
        );
      } catch (error) {
        if ((error as DOMException).name !== "NotFoundError") throw error;
      }
      handle = await args.directory!.getFileHandle(targetName, {
        create: true,
      });
    }
    for (const source of workspace!.sources)
      if (
        (source.handle && (await source.handle.isSameEntry(handle))) ||
        (!source.handle && source.name === handle.name)
      )
        throw new Error(
          "元ファイルへの上書きはできません。別の名前を選んでください",
        );
    stream = await handle.createWritable();
  };
  try {
    await open();
    for (let id = 0; id < totalRows(); id++) {
      check();
      const raw = await included(id);
      if (!raw) continue;
      let blob = raw.blob,
        bytes = raw.bytes;
      // BOM は各出力の先頭に限り保持し、連結途中の BOM は取り除く。
      if (raw.first && partRows > 0) {
        const head =
          bytes?.subarray(0, 3) ??
          new Uint8Array(await blob!.slice(0, 3).arrayBuffer());
        if (head[0] === 239 && head[1] === 187 && head[2] === 191) {
          if (bytes) bytes = bytes.subarray(3);
          else blob = blob!.slice(3);
        }
      }
      const end =
        bytes?.subarray(-1) ??
        new Uint8Array(await blob!.slice(-1).arrayBuffer());
      const newline = end[0] !== 10;
      const size = (bytes?.length ?? blob!.size) + (newline ? 1 : 0);
      const limit =
        options.mode === "files"
          ? Math.floor(eligible / fileCount) +
            (part <= eligible % fileCount ? 1 : 0)
          : options.value;
      if (
        partRows > 0 &&
        (((options.mode === "rows" || options.mode === "files") &&
          partRows >= limit) ||
          (options.mode === "bytes" && partBytes + size > options.value))
      ) {
        await finish();
        await open();
      }
      if (options.mode === "bytes" && size > options.value) oversizeParts++;
      if (bytes) await write(bytes);
      else {
        const reader = blob!.stream().getReader();
        try {
          while (true) {
            check();
            const { value, done } = await reader.read();
            if (done) break;
            await write(value);
          }
        } finally {
          reader.releaseLock();
        }
      }
      if (newline) await write(new Uint8Array([10]));
      partRows++;
      rows++;
      if (rows % 1024 === 0)
        await progress("JSONL を書き出し中", rows, eligible);
    }
    await finish();
    await progress("書き出し完了", eligible, eligible);
    return { rows, skipped, files: completed, oversizeParts };
  } catch (error) {
    try {
      await stream?.abort();
    } catch {
      /* 元エラーを維持する。 */
    }
    throw new Error(
      `${(error as Error).message}${completed.length ? `。完了済み: ${completed.join(", ")}` : ""}。未完了の出力ファイルは確認して削除してください`,
    );
  }
}

const mutating = new Set([
  "create",
  "restore",
  "mutate",
  "history",
  "search",
  "keyPreview",
  "keyApply",
  "export",
  "layout",
  "clearFilter",
  "close",
  "delete",
]);
self.onmessage = async ({ data }: { data: RpcRequest }) => {
  const { id, command, args } = data;
  if (command === "cancel") {
    cancelled = true;
    postMessage({ id, result: true });
    return;
  }
  const exclusive = mutating.has(command);
  if (exclusive && busy) {
    postMessage({
      id,
      error: "処理中です。完了または中止後に操作してください",
    });
    return;
  }
  if (exclusive) {
    busy = true;
    cancelled = false;
  }
  try {
    let result: any;
    switch (command) {
      case "list":
        result = await storage.listWorkspaces();
        break;
      case "create":
        result = await create(args);
        break;
      case "restore":
        result = await restore(args);
        break;
      case "rows":
        result = await listRows(args);
        break;
      case "row":
        result = await rowData(args.row, true);
        break;
      case "mutate":
        result = await mutate(args);
        break;
      case "history":
        requireReady();
        workspace = await storage.moveHistory(workspace!, args.direction);
        resetFilter();
        emitWorkspace();
        result = workspace;
        break;
      case "search":
        result = await search(args);
        break;
      case "clearFilter":
        resetFilter();
        break;
      case "keyPreview":
        result = await keyOperation(args);
        break;
      case "keyApply":
        result = await keyOperation(args, true);
        break;
      case "export":
        result = await exportData(args);
        break;
      case "layout":
        if (workspace) {
          workspace.layouts = args.layouts;
          await storage.saveWorkspace(workspace);
          emitWorkspace();
        }
        break;
      case "close":
        close();
        break;
      case "delete":
        if (workspace?.id === args.id) close();
        await navigator.locks.request(
          `data-loom-${args.id}`,
          { ifAvailable: true },
          async (lock) => {
            if (!lock) throw new Error("この作業は別のタブで開かれています");
            await storage.deleteWorkspace(args.id);
          },
        );
        break;
      default:
        throw new Error("未対応の操作です");
    }
    postMessage({ id, result });
  } catch (error) {
    postMessage({
      id,
      error:
        (error as Error).name === "QuotaExceededError"
          ? "端末内の空き容量が不足しています。不要な作業を削除して再試行してください"
          : (error as Error).message,
    });
  } finally {
    if (exclusive) {
      busy = false;
      if (workspace) emitWorkspace();
    }
  }
};

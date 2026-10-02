import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowUp,
  ArrowDown,
  Plus,
  Search,
  SlidersHorizontal,
  Undo2,
  Redo2,
  Copy,
  Trash2,
  ShieldCheck,
  FileJson2,
  FolderOpen,
  X,
  Columns2,
  ChevronLeft,
  ChevronRight,
  List,
  HardDrive,
  Check,
  Braces,
  AArrowDown,
  AArrowUp,
} from "lucide-react";
import { call, onUpdate } from "./client";
import { Editor } from "../records/Editor";
import { LAYOUT_SEPARATOR } from "../records/nested";
import { RowList } from "../records/RowList";
import { Dialog } from "../shared/Dialog";
import { formatBytes, parseRecord } from "../shared/json";
import type {
  Workspace,
  Row,
  Progress,
  Filter,
  KeyOperation,
  ExportOptions,
  Layout,
} from "../shared/types";

const FONT_KEY = "data-loom:font-size",
  FONT_DEFAULT = 14,
  FONT_MIN = 11,
  FONT_MAX = 20;

/** JSONL 作業の選択・編集・加工・出力を統合する画面。 */
export function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null),
    [saved, setSaved] = useState<Workspace[]>([]);
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState<Progress | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [version, setVersion] = useState(0),
    [selected, setSelected] = useState(0),
    [row, setRow] = useState<Row | null>(null),
    [dirty, setDirty] = useState(false);
  const [modal, setModal] = useState<
      "open" | "search" | "keys" | "export" | "workspaces" | null
    >(null),
    [mobileList, setMobileList] = useState(false);
  const [incoming, setIncoming] = useState<
      { file: File; handle?: FileSystemFileHandle }[]
    >([]),
    [restoreId, setRestoreId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>({ text: "", conditions: [] }),
    [filterActive, setFilterActive] = useState(false);
  const [keyOperation, setKeyOperation] = useState<KeyOperation>({
      mode: "add",
      key: "",
      target: "",
      value: '""',
      scope: "current",
      row: 0,
    }),
    [preview, setPreview] = useState<any>(null);
  const [output, setOutput] = useState<ExportOptions>({
    mode: "single",
    value: 10000,
    filtered: false,
    invalid: "stop",
    prefix: "dataset",
  });
  const [storage, setStorage] = useState<StorageEstimate>({});
  const keyCandidates = useMemo(() => {
    const keys = new Set(
      Object.keys(workspace?.layouts ?? {}).filter(
        (key) => !key.includes(LAYOUT_SEPARATOR),
      ),
    );
    if (modal === "search" && row?.text && !row.issue) {
      try {
        for (const key of Object.keys(parseRecord(row.text))) keys.add(key);
      } catch {
        // 診断対象の行は候補に加えない。
      }
    }
    return [...keys].sort((left, right) => left.localeCompare(right, "ja"));
  }, [workspace?.layouts, row?.text, row?.issue, modal]);
  const input = useRef<HTMLInputElement>(null),
    workspaceRef = useRef<Workspace | null>(null);
  const layoutSync = useRef<{
    busy: boolean;
    pending: boolean;
    refresh: boolean;
    local: Record<string, Layout> | null;
  }>({ busy: false, pending: false, refresh: false, local: null });
  const [pathSlot, setPathSlot] = useState<HTMLElement | null>(null),
    [actionSlot, setActionSlot] = useState<HTMLElement | null>(null);
  const [fontSize, setFontSize] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(FONT_KEY));
      return stored >= FONT_MIN && stored <= FONT_MAX ? stored : FONT_DEFAULT;
    } catch {
      return FONT_DEFAULT;
    }
  });
  const changeFont = (size: number) => {
    const next = Math.max(FONT_MIN, Math.min(FONT_MAX, size));
    setFontSize(next);
    try {
      localStorage.setItem(FONT_KEY, String(next));
    } catch {
      // 保存できない環境では、この画面を開いている間だけ反映する。
    }
  };
  const supported =
    !!window.showSaveFilePicker &&
    !!navigator.storage?.getDirectory &&
    !!navigator.locks;
  const refresh = () => setVersion((v) => v + 1);
  const loadSaved = () =>
    call<Workspace[]>("list")
      .then(setSaved)
      .catch((e) => setError(e.message));
  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);
  useEffect(() => {
    loadSaved();
    navigator.storage?.estimate().then(setStorage);
    onUpdate((update) => {
      if (update.progress) setProgress(update.progress);
      if (update.workspace) {
        const previous = workspaceRef.current;
        // 保存待ちの表示設定がある間は、画面側の最新の設定を優先する。
        const sync = layoutSync.current;
        const next =
          sync.busy && sync.local
            ? { ...update.workspace, layouts: sync.local }
            : update.workspace;
        workspaceRef.current = next;
        setWorkspace(next);
        if (!previous || previous.baseCount !== next.baseCount) refresh();
      }
    });
    const leave = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
  useEffect(() => {
    let active = true;
    if (workspace && workspace.baseCount + workspace.added > selected)
      call<Row>("row", { row: selected })
        .then((row) => {
          if (active) setRow(row);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    else setRow(null);
    return () => {
      active = false;
    };
  }, [selected, version, workspace?.id]);
  const task = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      return await fn();
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setBusy(false);
      setProgress(null);
      navigator.storage
        .estimate()
        .then(setStorage)
        .catch(() => {});
    }
  };
  const discard = () =>
    !dirty || window.confirm("確定していない入力を取り消して移動しますか？");
  const choose = (id: number) => {
    if (discard()) {
      setDirty(false);
      setSelected(id);
      setMobileList(false);
    }
  };
  const pick = async () => {
    setRestoreId(null);
    setModal("open");
    setError("");
    try {
      const handles = await window.showOpenFilePicker({
        multiple: true,
        types: [
          {
            description: "JSON Lines",
            accept: { "application/json": [".jsonl", ".ndjson", ".json"] },
          },
        ],
      });
      setIncoming(
        await Promise.all(
          handles.map(async (handle) => ({
            file: await handle.getFile(),
            handle,
          })),
        ),
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    }
  };
  const begin = () =>
    task(async () => {
      setModal(null);
      setSelected(0);
      setRow(null);
      if (restoreId) {
        const result = await call<Workspace>("restore", {
          id: restoreId,
          files: incoming.map((x) => x.file),
        });
        setWorkspace(result);
      } else {
        const result = await call<Workspace>("create", {
          files: incoming.map((x) => x.file),
          handles: incoming.every((x) => x.handle)
            ? incoming.map((x) => x.handle)
            : undefined,
        });
        setWorkspace(result);
      }
      setModal(null);
      setIncoming([]);
      setSelected(0);
      setDirty(false);
      setFilterActive(false);
      setRow(null);
      refresh();
      loadSaved();
    });
  const restore = (saved: Workspace) =>
    task(async () => {
      if (!discard()) return;
      for (const source of saved.sources) {
        if (
          !source.handle ||
          (await source.handle.requestPermission({ mode: "read" })) !==
            "granted"
        ) {
          setRestoreId(saved.id);
          setIncoming([]);
          setModal("open");
          setNotice(
            "元ファイルを表示順に選択し直してください。照合後に作業を復元します。",
          );
          return;
        }
      }
      const result = await call<Workspace>("restore", { id: saved.id });
      setWorkspace(result);
      setSelected(0);
      setModal(null);
      setDirty(false);
      setFilterActive(false);
      refresh();
    });
  const mutate = (args: any) =>
    task(async () => {
      const result = await call<Workspace>("mutate", args);
      setWorkspace(result);
      setFilterActive(false);
      refresh();
      loadSaved();
      return true;
    });
  const history = (direction: number) =>
    task(async () => {
      if (!discard()) return;
      const result = await call<Workspace>("history", { direction });
      setWorkspace(result);
      setSelected(
        Math.min(selected, Math.max(0, result.baseCount + result.added - 1)),
      );
      setDirty(false);
      setFilterActive(false);
      refresh();
    });
  const changeLayout = (key: string, layout: Layout) => {
    if (!workspace || busy) return;
    const sync = layoutSync.current;
    const base = (sync.busy && sync.local) || workspace.layouts;
    const layouts = { ...base, [key]: layout };
    // 行一覧はピン留めした KEY の値を表示するため、ピンの変更時に取り直す。
    if (!!base[key]?.pinned !== !!layout.pinned) sync.refresh = true;
    sync.local = layouts;
    sync.pending = true;
    setWorkspace({ ...workspace, layouts });
    if (sync.busy) return;
    sync.busy = true;
    // スライダーやドラッグの連続した変更は、保存中の分をまとめて最新だけを送る。
    (async () => {
      try {
        while (sync.pending) {
          sync.pending = false;
          await call("layout", { layouts: sync.local });
          if (sync.refresh) {
            sync.refresh = false;
            refresh();
          }
        }
      } catch (e) {
        sync.pending = false;
        setError((e as Error).message);
      } finally {
        sync.busy = false;
        sync.local = null;
      }
    })();
  };
  const search = (next: Filter = filter) =>
    task(async () => {
      if (!discard()) return;
      const result = await call("search", next);
      setFilter(next);
      setFilterActive(true);
      setDirty(false);
      setModal(null);
      setNotice(
        `${result.count.toLocaleString()} 行を抽出しました${result.skipped ? `。${result.skipped} 行は容量上限により検索対象外です` : ""}`,
      );
      refresh();
    });
  const exportNow = () =>
    task(async () => {
      const args: any = { options: output };
      if (output.mode === "single")
        args.handle = await window.showSaveFilePicker({
          suggestedName: `${output.prefix || "dataset"}.jsonl`,
          types: [
            {
              description: "JSON Lines",
              accept: { "application/json": [".jsonl"] },
            },
          ],
        });
      else
        args.directory = await window.showDirectoryPicker({
          mode: "readwrite",
        });
      const result = await call("export", args);
      setModal(null);
      setNotice(
        `${result.rows.toLocaleString()} 行を ${result.files.length} ファイルに書き出しました${result.oversizeParts ? `。容量指定を超える単独行: ${result.oversizeParts}` : ""}`,
      );
    });
  const ready = !!workspace?.ready && !busy;
  const locked = !ready || dirty;
  const total = workspace ? workspace.baseCount + workspace.added : 0;
  return (
    <div className="app-shell">
      <header className="app-header">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            if (discard()) setModal("workspaces");
          }}
        >
          <span className="brand-icon">
            <Columns2 size={20} />
          </span>
          data loom<span className="brand-tag">JSONL WORKSPACE</span>
        </a>
        <div className="header-right">
          <span className="privacy">
            <ShieldCheck size={14} />
            この端末で処理
          </span>
          <button
            onClick={() => {
              loadSaved();
              setModal("workspaces");
            }}
            disabled={busy}
          >
            <HardDrive size={15} />
            <span>保存した作業</span>
          </button>
        </div>
      </header>
      <input
        ref={input}
        type="file"
        accept=".jsonl,.ndjson,.json"
        multiple
        hidden
        aria-label="JSONL ファイル"
        onChange={(event) => {
          setIncoming(
            Array.from(event.target.files ?? []).map((file) => ({ file })),
          );
          setModal("open");
          event.target.value = "";
        }}
      />
      {!supported && (
        <div className="banner error" role="alert">
          PC 版 Chrome または Edge で、localhost または HTTPS
          から開いてください。ファイルへの逐次保存機能が必要です。
        </div>
      )}
      {error && (
        <div className="banner error" role="alert">
          <span>⚠ {error}</span>
          <button aria-label="エラーを閉じる" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div className="banner" role="status">
          <span>
            <Check size={14} /> {notice}
          </span>
          <button aria-label="通知を閉じる" onClick={() => setNotice("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {!workspace ? (
        <main className="welcome">
          <div className="welcome-mark">
            <Braces size={44} strokeWidth={1} />
          </div>
          <h1>
            データを読み、
            <br />
            一行ずつ整える。
          </h1>
          <p className="welcome-description">
            長いテキストも、複雑なレコードも。
            <br />
            JSONL を開いて、見やすい枠で編集できます。
          </p>
          <div className="welcome-actions">
            <button
              className="primary"
              disabled={busy || !supported}
              onClick={pick}
            >
              <FolderOpen size={17} />
              JSONL を開く
            </button>
            <button
              disabled={busy || !supported}
              onClick={() =>
                task(async () => {
                  const result = await call<Workspace>("create", {});
                  setWorkspace(result);
                  setSelected(0);
                  refresh();
                })
              }
            >
              <Plus size={17} />
              空のデータセット
            </button>
          </div>
          <p className="welcome-note">ファイルはサーバーに送信されません</p>
          {saved.length > 0 && (
            <section className="recent">
              <h2>前回の作業から</h2>
              {saved.slice(0, 3).map((item) => (
                <button
                  key={item.id}
                  disabled={busy || !item.ready}
                  onClick={() => restore(item)}
                >
                  <FileJson2 size={18} />
                  <span>
                    {item.name}
                    <small>
                      {item.baseCount.toLocaleString()} 行 ·{" "}
                      {new Date(item.created).toLocaleDateString("ja-JP")}
                    </small>
                  </span>
                  <ChevronRight size={16} />
                </button>
              ))}
            </section>
          )}
        </main>
      ) : (
        <>
          <section className="workspace-heading">
            <div className="workspace-title">
              <span className="file-badge">
                <FileJson2 size={22} />
              </span>
              <div>
                <h1>{workspace.name}</h1>
                <p>
                  {formatBytes(
                    workspace.sources.reduce((n, s) => n + s.size, 0),
                  )}
                  <span>·</span>
                  {total.toLocaleString()} 行<span>·</span>
                  {workspace.sources.length || "新規"} ファイル
                </p>
              </div>
            </div>
            <div className="button-row">
              <button disabled={busy || dirty} onClick={pick}>
                <ArrowUpFromLine size={15} />
                開く・結合
              </button>
              <button
                className="primary"
                disabled={locked}
                onClick={() => {
                  setOutput({ ...output, filtered: filterActive });
                  setModal("export");
                }}
              >
                <ArrowDownToLine size={15} />
                書き出す
              </button>
            </div>
          </section>
          <nav className="toolbar" aria-label="データ操作">
            <form
              className="quick-search"
              onSubmit={(event) => {
                event.preventDefault();
                if (!locked) search({ text: filter.text, conditions: [] });
              }}
            >
              <Search size={16} aria-hidden="true" />
              <input
                aria-label="全文に含まれる文字列"
                placeholder="全文検索…"
                value={filter.text}
                disabled={locked}
                onChange={(event) =>
                  setFilter({ ...filter, text: event.target.value })
                }
              />
              <button type="submit" disabled={locked}>
                検索
              </button>
            </form>
            <div className="button-row">
              <button
                disabled={locked}
                onClick={() => {
                  if (!filter.conditions.length)
                    setFilter({
                      ...filter,
                      conditions: [{ key: "", op: "contains", value: "" }],
                    });
                  setModal("search");
                }}
                className={filterActive ? "active" : ""}
              >
                <Search size={15} />
                条件で抽出
              </button>
              {filterActive && (
                <button
                  disabled={busy}
                  aria-label="抽出を解除"
                  onClick={() =>
                    task(async () => {
                      await call("clearFilter");
                      setFilterActive(false);
                      refresh();
                    })
                  }
                >
                  <X size={14} />
                </button>
              )}
              <button
                disabled={locked}
                onClick={() => {
                  setKeyOperation({ ...keyOperation, row: selected });
                  setPreview(null);
                  setModal("keys");
                }}
              >
                <SlidersHorizontal size={15} />
                KEY 操作
              </button>
              <button
                disabled={locked}
                onClick={() =>
                  task(async () => {
                    await call("search", {
                      text: "",
                      conditions: [],
                      issuesOnly: true,
                    });
                    setFilterActive(true);
                    refresh();
                  })
                }
              >
                検証{" "}
                <span className="count-badge">
                  {workspace.issues + workspace.oversized}
                </span>
              </button>
            </div>
            <div className="button-row">
              <button
                aria-label="元に戻す"
                disabled={!ready || workspace.head === 0}
                onClick={() => history(-1)}
              >
                <Undo2 size={16} />
              </button>
              <button
                aria-label="やり直す"
                disabled={!ready || workspace.head === workspace.tip}
                onClick={() => history(1)}
              >
                <Redo2 size={16} />
              </button>
              <span className="toolbar-separator" />
              <button
                disabled={locked}
                onClick={async () => {
                  const id = total;
                  const result = await mutate({ append: true, text: "{}" });
                  if (result) setSelected(id);
                }}
              >
                <Plus size={15} />
                行を追加
              </button>
            </div>
          </nav>
          <div className={`workspace-body ${mobileList ? "show-list" : ""}`}>
            <RowList
              key={`${workspace.id}-${filterActive}`}
              onClose={() => setMobileList(false)}
              version={version}
              selected={selected}
              onSelect={choose}
              onError={setError}
            />
            <main
              className="detail"
              style={
                { "--record-font-size": `${fontSize}px` } as React.CSSProperties
              }
            >
              <header className="detail-header">
                <div className="detail-title">
                  <button
                    className="mobile-list-toggle"
                    aria-label="行一覧を表示"
                    onClick={() => setMobileList(!mobileList)}
                  >
                    <List size={17} />
                  </button>
                  {!row && <span className="mono">RECORD</span>}
                  <span className="path-slot" ref={setPathSlot} />
                  <span className="subtle">{row?.source}</span>
                </div>
                <div className="record-actions" ref={setActionSlot} />
                <div className="button-row">
                  <button
                    aria-label="文字を小さく"
                    title={`文字を小さく（現在 ${fontSize}px）`}
                    disabled={fontSize <= FONT_MIN}
                    onClick={() => changeFont(fontSize - 1)}
                  >
                    <AArrowDown size={16} />
                  </button>
                  <button
                    aria-label="文字を大きく"
                    title={`文字を大きく（現在 ${fontSize}px）`}
                    disabled={fontSize >= FONT_MAX}
                    onClick={() => changeFont(fontSize + 1)}
                  >
                    <AArrowUp size={16} />
                  </button>
                  <button
                    aria-label="前の行"
                    disabled={selected <= 0}
                    onClick={() => choose(selected - 1)}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    aria-label="次の行"
                    disabled={selected >= total - 1}
                    onClick={() => choose(selected + 1)}
                  >
                    <ChevronRight size={16} />
                  </button>
                  <button
                    aria-label="行を複製"
                    disabled={
                      locked || !row?.text || !!row.issue || row.deleted
                    }
                    onClick={async () => {
                      const id = total;
                      const result = await mutate({
                        append: true,
                        text: row!.text,
                      });
                      if (result) setSelected(id);
                    }}
                  >
                    <Copy size={15} />
                  </button>
                  <button
                    aria-label="行を削除"
                    disabled={locked || !row || row.deleted}
                    onClick={() => mutate({ row: selected, text: null })}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </header>
              <div className="detail-scroll">
                {row ? (
                  <Editor
                    row={row}
                    label={`ROW ${String(row.id + 1).padStart(3, "0")}`}
                    layouts={workspace.layouts}
                    scale={fontSize / FONT_DEFAULT}
                    pathSlot={pathSlot}
                    actionSlot={actionSlot}
                    disabled={!ready}
                    onSave={async (text) =>
                      !!(await mutate({ row: selected, text }))
                    }
                    onLayout={changeLayout}
                    onDirty={setDirty}
                  />
                ) : (
                  <div className="record-notice">
                    <Braces size={32} />
                    <h2>
                      {workspace.ready
                        ? "最初のレコードを追加"
                        : "読み込み中です"}
                    </h2>
                    <p>
                      {workspace.ready
                        ? "「行を追加」で空のオブジェクトから作成できます。"
                        : "処理済みのレコードから順に表示します。"}
                    </p>
                  </div>
                )}
              </div>
            </main>
          </div>
        </>
      )}
      <footer className="statusbar">
        <span className="status-indicator" />
        <span>
          {busy
            ? (progress?.label ?? "処理中…")
            : workspace
              ? "端末内に保存"
              : "LOCAL WORKSPACE"}
        </span>
        {busy && (
          <>
            <progress value={progress?.done ?? 0} max={progress?.total || 1} />
            <span>
              {progress?.total
                ? `${Math.floor((progress.done / progress.total) * 100)}%`
                : ""}
            </span>
            <button onClick={() => call("cancel")}>中止</button>
          </>
        )}
        <span className="status-spacer" />
        <span className="storage-stat">
          使用量 {formatBytes(storage.usage ?? 0)} /{" "}
          {formatBytes(storage.quota ?? 0)}
        </span>
        <span className="status-version">Data Loom 0.1</span>
      </footer>
      {modal === "open" && (
        <Dialog
          error={error}
          busy={busy}
          progress={progress}
          onCancel={() => call("cancel")}
          title={restoreId ? "作業を復元" : "ファイルを開く・結合"}
          onClose={() => {
            if (!busy) setModal(null);
          }}
        >
          <p>複数のファイルは、この順番でひとつの作業として開きます。</p>
          <div className="button-row">
            <button disabled={busy} onClick={pick}>
              <FolderOpen size={16} />
              ファイルを選択
            </button>
            <button disabled={busy} onClick={() => input.current?.click()}>
              通常のファイル選択
            </button>
          </div>
          <p className="help">
            通常のファイル選択を使った作業は、再開時に元ファイルを選び直します。
          </p>
          <div className="import-list">
            {incoming.map((item, i) => (
              <div key={`${item.file.name}-${i}`}>
                <FileJson2 size={17} />
                <span>
                  {item.file.name}
                  <small>{formatBytes(item.file.size)}</small>
                </span>
                <button
                  aria-label={`${item.file.name} を上へ`}
                  disabled={busy || i === 0}
                  onClick={() => {
                    const next = [...incoming];
                    [next[i - 1], next[i]] = [next[i], next[i - 1]];
                    setIncoming(next);
                  }}
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  aria-label={`${item.file.name} を下へ`}
                  disabled={busy || i === incoming.length - 1}
                  onClick={() => {
                    const next = [...incoming];
                    [next[i + 1], next[i]] = [next[i], next[i + 1]];
                    setIncoming(next);
                  }}
                >
                  <ArrowDown size={15} />
                </button>
              </div>
            ))}
          </div>
          <div className="dialog-actions">
            <button
              className="primary"
              disabled={busy || !incoming.length}
              onClick={() => {
                if (discard()) begin();
              }}
            >
              {restoreId ? "照合して復元" : "この順序で開く"}
            </button>
          </div>
        </Dialog>
      )}
      {modal === "workspaces" && (
        <Dialog
          error={error}
          busy={busy}
          progress={progress}
          onCancel={() => call("cancel")}
          title="保存した作業"
          onClose={() => setModal(null)}
        >
          <p>
            編集差分と表示設定をこのブラウザに保持しています。元ファイルも保管してください。
          </p>
          <div className="saved-list">
            {saved.map((item) => (
              <div key={item.id}>
                <span>
                  <strong>{item.name}</strong>
                  <small>
                    {item.baseCount.toLocaleString()} 行 ·{" "}
                    {item.ready ? "保存済み" : "読み込み未完了"}
                  </small>
                </span>
                <button
                  disabled={busy || !item.ready}
                  onClick={() => restore(item)}
                >
                  再開
                </button>
                <button
                  aria-label={`${item.name} の作業を削除`}
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        "この作業の編集差分と履歴を削除します。元ファイルは残ります。削除しますか？",
                      )
                    )
                      task(async () => {
                        await call("delete", { id: item.id });
                        if (workspace?.id === item.id) {
                          setWorkspace(null);
                          setRow(null);
                        }
                        loadSaved();
                      });
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
          {!saved.length && <p>保存した作業はありません。</p>}
        </Dialog>
      )}
      {modal === "search" && (
        <Dialog
          error={error}
          busy={busy}
          progress={progress}
          onCancel={() => call("cancel")}
          title="条件で抽出"
          onClose={() => {
            if (!busy) setModal(null);
          }}
        >
          <p className="help">
            KEY・条件・値を指定してください。複数条件はすべて一致する行を抽出します。
          </p>
          {filter.text && (
            <p className="search-context">
              全文検索「{filter.text}」と組み合わせます。
            </p>
          )}
          <datalist id="search-key-candidates">
            {keyCandidates.filter(Boolean).map((key) => (
              <option key={key} value={key} />
            ))}
          </datalist>
          {filter.conditions.map((condition, i) => (
            <div className="condition" key={i}>
              <div className="condition-key">
                <label>
                  KEY
                  <input
                    aria-label={`条件 ${i + 1} の KEY`}
                    list="search-key-candidates"
                    placeholder="選択または入力"
                    autoComplete="off"
                    value={condition.key}
                    onChange={(e) =>
                      setFilter({
                        ...filter,
                        conditions: filter.conditions.map((c, n) =>
                          n === i ? { ...c, key: e.target.value } : c,
                        ),
                      })
                    }
                  />
                </label>
              </div>
              <label>
                条件
                <select
                  aria-label="条件"
                  value={condition.op}
                  onChange={(e) =>
                    setFilter({
                      ...filter,
                      conditions: filter.conditions.map((c, n) =>
                        n === i ? { ...c, op: e.target.value as any } : c,
                      ),
                    })
                  }
                >
                  <option value="contains">部分一致</option>
                  <option value="equals">等しい</option>
                  <option value="exists">存在する</option>
                  <option value="type">型が一致</option>
                </select>
              </label>
              <label>
                値
                <input
                  placeholder={
                    condition.op === "exists"
                      ? "true / false"
                      : condition.op === "type"
                        ? "string / number / array"
                        : "比較する値"
                  }
                  value={condition.value}
                  onChange={(e) =>
                    setFilter({
                      ...filter,
                      conditions: filter.conditions.map((c, n) =>
                        n === i ? { ...c, value: e.target.value } : c,
                      ),
                    })
                  }
                />
              </label>
              <button
                aria-label={`条件 ${i + 1} を削除`}
                onClick={() =>
                  setFilter({
                    ...filter,
                    conditions: filter.conditions.filter((_, n) => n !== i),
                  })
                }
              >
                <X size={16} />
              </button>
            </div>
          ))}
          <button
            onClick={() =>
              setFilter({
                ...filter,
                conditions: [
                  ...filter.conditions,
                  { key: "", op: "contains", value: "" },
                ],
              })
            }
          >
            <Plus size={15} />
            条件を追加
          </button>
          <div className="dialog-actions">
            <button
              className="primary"
              disabled={busy}
              onClick={() => search()}
            >
              <Search size={15} />
              抽出する
            </button>
          </div>
        </Dialog>
      )}
      {modal === "keys" && (
        <Dialog
          error={error}
          busy={busy}
          progress={progress}
          onCancel={() => call("cancel")}
          title="KEY 操作"
          onClose={() => {
            if (!busy) setModal(null);
          }}
        >
          <div className="form-grid">
            <label>
              操作
              <select
                aria-label="操作"
                value={keyOperation.mode}
                onChange={(e) => {
                  setKeyOperation({
                    ...keyOperation,
                    mode: e.target.value as any,
                  });
                  setPreview(null);
                }}
              >
                <option value="add">KEY を追加</option>
                <option value="delete">KEY を削除</option>
                <option value="rename">KEY を改名</option>
              </select>
            </label>
            <label>
              対象
              <select
                aria-label="対象"
                value={keyOperation.scope}
                onChange={(e) => {
                  setKeyOperation({
                    ...keyOperation,
                    scope: e.target.value as any,
                  });
                  setPreview(null);
                }}
              >
                <option value="current">現在の行</option>
                <option value="all">すべての行</option>
                <option value="filtered" disabled={!filterActive}>
                  抽出した行
                </option>
              </select>
            </label>
            <label>
              KEY 名
              <input
                value={keyOperation.key}
                onChange={(e) => {
                  setKeyOperation({ ...keyOperation, key: e.target.value });
                  setPreview(null);
                }}
              />
            </label>
            {keyOperation.mode === "rename" && (
              <label>
                新しい KEY 名
                <input
                  value={keyOperation.target}
                  onChange={(e) => {
                    setKeyOperation({
                      ...keyOperation,
                      target: e.target.value,
                    });
                    setPreview(null);
                  }}
                />
              </label>
            )}
            {keyOperation.mode === "add" && (
              <label>
                値（JSON）
                <input
                  value={keyOperation.value}
                  onChange={(e) => {
                    setKeyOperation({ ...keyOperation, value: e.target.value });
                    setPreview(null);
                  }}
                />
              </label>
            )}
          </div>
          <p className="help">
            既存の KEY
            と衝突する場合は変更を中止します。不正行・容量上限を超える行は保持してスキップします。
          </p>
          {preview && (
            <section className="operation-preview">
              <p>
                {preview.count} 行を変更 · {preview.skipped} 行をスキップ
              </p>
              {preview.examples.map((item: any) => (
                <div key={item.row}>
                  <strong>行 {item.row}</strong>
                  <pre>{item.before}</pre>
                  <span>↓</span>
                  <pre>{item.after}</pre>
                </div>
              ))}
            </section>
          )}
          <div className="dialog-actions">
            <button
              disabled={busy}
              onClick={() =>
                task(async () =>
                  setPreview(await call("keyPreview", keyOperation)),
                )
              }
            >
              変更を確認
            </button>
            <button
              className="primary"
              disabled={busy || !preview?.count}
              onClick={() =>
                task(async () => {
                  await call("keyApply", keyOperation);
                  setModal(null);
                  setFilterActive(false);
                  refresh();
                  loadSaved();
                })
              }
            >
              変更を適用
            </button>
          </div>
        </Dialog>
      )}
      {modal === "export" && (
        <Dialog
          error={error}
          busy={busy}
          progress={progress}
          onCancel={() => call("cancel")}
          title="書き出し・分割"
          onClose={() => {
            if (!busy) setModal(null);
          }}
        >
          <div className="form-grid">
            <label>
              書き出す行
              <select
                aria-label="書き出す行"
                value={output.filtered ? "filtered" : "all"}
                onChange={(e) =>
                  setOutput({
                    ...output,
                    filtered: e.target.value === "filtered",
                  })
                }
              >
                <option value="all">すべての行</option>
                <option value="filtered" disabled={!filterActive}>
                  抽出した行
                </option>
              </select>
            </label>
            <label>
              分割方法
              <select
                aria-label="分割方法"
                value={output.mode}
                onChange={(e) =>
                  setOutput({
                    ...output,
                    mode: e.target.value as any,
                    value:
                      e.target.value === "bytes"
                        ? 104857600
                        : e.target.value === "files"
                          ? 3
                          : 10000,
                  })
                }
              >
                <option value="single">分割しない</option>
                <option value="rows">行数で分割</option>
                <option value="files">ファイル数で分割</option>
                <option value="bytes">容量で分割</option>
              </select>
            </label>
            {output.mode !== "single" && (
              <label>
                {output.mode === "rows"
                  ? "1ファイルの行数"
                  : output.mode === "files"
                    ? "ファイル数"
                    : "目標容量（バイト）"}
                <input
                  type="number"
                  min="1"
                  value={output.value}
                  onChange={(e) =>
                    setOutput({ ...output, value: Number(e.target.value) })
                  }
                />
              </label>
            )}
            <label>
              ファイル名の先頭
              <input
                value={output.prefix}
                onChange={(e) =>
                  setOutput({ ...output, prefix: e.target.value })
                }
              />
            </label>
            <label>
              不正な行の扱い
              <select
                aria-label="不正な行の扱い"
                value={output.invalid}
                onChange={(e) =>
                  setOutput({ ...output, invalid: e.target.value as any })
                }
              >
                <option value="stop">見つかったら中止</option>
                <option value="keep">そのまま保持</option>
                <option value="skip">除外する</option>
              </select>
            </label>
          </div>
          <p className="help">
            元ファイルとは別の名前に保存します。行を途中で分割しません。16 MiB
            を超える行は未検証のまま保持し、改行がない行の末尾には LF
            を補います。
          </p>
          <div className="dialog-actions">
            <button className="primary" disabled={busy} onClick={exportNow}>
              <ArrowDownToLine size={16} />
              保存先を選んで書き出す
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

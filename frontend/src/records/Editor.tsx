import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  RotateCcw,
  Maximize2,
  Pin,
  Type,
  Hash,
  ToggleLeft,
  CircleSlash,
  Brackets,
  Braces,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { parseRecord, jsonText } from "../shared/json";
import { automaticLayout } from "./layout";
import {
  buildContainer,
  containerAt,
  fieldsOf,
  isCompound,
  layoutKey,
  replaceAt,
  resolvePath,
  summarize,
} from "./nested";
import type { FieldDraft, Fields, Segment } from "./nested";
import type { Layout, Row } from "../shared/types";

/** KEY の型・文量に合わせた編集欄を、ネストの階層ごとに表示する。 */
export function Editor({
  row,
  label,
  layouts,
  scale,
  pathSlot,
  actionSlot,
  disabled,
  onSave,
  onLayout,
  onDirty,
}: {
  row: Row;
  label: string;
  layouts: Record<string, Layout>;
  scale: number;
  pathSlot: HTMLElement | null;
  actionSlot: HTMLElement | null;
  disabled: boolean;
  onSave: (text: string) => Promise<boolean>;
  onLayout: (key: string, layout: Layout) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [root, setRoot] = useState<any>(null);
  const [path, setPath] = useState<Segment[]>([]);
  const [draft, setDraft] = useState<Fields>({});
  // 入力の直後に階層を移っても古い内容で検証しないよう、最新の入力を ref にも持つ。
  const draftNow = useRef<Fields>(draft);
  const originalFields = useRef<Fields>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  // 行の再読み込みと入力が前後しても判定できるよう、最新の状態を ref にも持つ。
  const dirtyNow = useRef(false);
  const markDirty = (next: boolean) => {
    dirtyNow.current = next;
    setDirty(next);
    onDirty(next);
  };
  const show = (value: any, next: Segment[]) => {
    const target = resolvePath(value, next);
    const fields = fieldsOf(containerAt(value, target) ?? {});
    originalFields.current = fields;
    setRoot(value);
    setPath(target);
    draftNow.current = fields;
    setDraft(fields);
    setErrors({});
  };
  const reset = () => {
    show(row.text && !row.issue ? parseRecord(row.text) : null, path);
    markDirty(false);
  };
  const saved = useRef<{ id: number; text: string } | null>(null);
  useEffect(() => {
    // 確定した内容が行に反映されただけなら、その後に始めた入力を消さない。
    if (
      dirtyNow.current &&
      saved.current?.id === row.id &&
      saved.current.text === row.text
    )
      return;
    reset();
  }, [row.id, row.text]);
  const goUp = useRef(() => {});
  goUp.current = () => {};
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !document.querySelector("dialog[open], .field-settings[open]")
      )
        goUp.current();
    };
    document.addEventListener("keydown", escape, true);
    return () => document.removeEventListener("keydown", escape, true);
  }, []);
  const rowLabel = <span className="mono">{label}</span>;
  if (row.deleted)
    return (
      <>
        {pathSlot && createPortal(rowLabel, pathSlot)}
        <div className="record-notice">
          <h2>この行は削除されています</h2>
          <p>「元に戻す」で復元できます。書き出しには含まれません。</p>
        </div>
      </>
    );
  if (row.issue)
    return (
      <>
        {pathSlot && createPortal(rowLabel, pathSlot)}
        <div className="record-notice">
          <h2>この行を確認してください</h2>
          <p role="alert">{row.issue}</p>
          {row.text && <pre>{row.text.slice(0, 12000)}</pre>}
          <p>元データは保持されます。書き出し時に不正行の扱いを選べます。</p>
        </div>
      </>
    );
  const array = Array.isArray(containerAt(root, path));
  const commit = () => {
    const { value, issues } = buildContainer(draftNow.current, array);
    setErrors(issues);
    return Object.keys(issues).length
      ? undefined
      : replaceAt(root, path, value);
  };
  const open = (next: Segment[]) => {
    const committed = commit();
    if (committed !== undefined) show(committed, next);
  };
  if (path.length) goUp.current = () => open(path.slice(0, -1));
  const save = async () => {
    const committed = commit();
    if (committed === undefined) return;
    setRoot(committed);
    const text = jsonText(committed);
    if (await onSave(text)) {
      saved.current = { id: row.id, text };
      markDirty(false);
    }
  };
  const groups: Record<
    "table" | "detail" | "full" | "pinnedFull",
    React.ReactNode[]
  > = {
    pinnedFull: [],
    table: [],
    detail: [],
    full: [],
  };
  const savedLayout = (key: string) => {
    const slot = layoutKey(path, key, array);
    return Object.hasOwn(layouts, slot) ? layouts[slot] : undefined;
  };
  const ordered = Object.entries(draft).sort(
    ([a], [b]) =>
      Number(savedLayout(b)?.pinned === true) -
      Number(savedLayout(a)?.pinned === true),
  );
  for (const [key, field] of ordered) {
    const saved = savedLayout(key);
    const baseline = originalFields.current[key] ?? field;
    const automatic = automaticLayout(baseline.text, baseline.type);
    const layout = saved?.manual
      ? saved
      : { ...automatic, placement: saved?.placement, pinned: saved?.pinned };
    const placement =
      layout.placement ??
      (isCompound(baseline.type) ||
      (automatic.width === "half" &&
        !baseline.text.includes("\n") &&
        baseline.text.length <= 80)
        ? "table"
        : "detail");
    groups[
      placement === "full" && layout.pinned ? "pinnedFull" : placement
    ].push(
      <Field
        key={key}
        name={array ? `[${key}]` : key}
        dataKey={key}
        field={field}
        layout={layout}
        compact={placement === "table"}
        placement={placement}
        scale={scale}
        disabled={disabled}
        error={errors[key]}
        onChange={(value) => {
          draftNow.current = { ...draftNow.current, [key]: value };
          setDraft(draftNow.current);
          markDirty(true);
        }}
        onLayout={(next) => onLayout(layoutKey(path, key, array), next)}
        onOpen={() => open([...path, array ? Number(key) : key])}
      />,
    );
  }
  return (
    <>
      {pathSlot &&
        createPortal(
          path.length ? (
            <nav className="record-path" aria-label="階層">
              <button type="button" className="mono" onClick={() => open([])}>
                {label}
              </button>
              {path.map((segment, index) => {
                const name =
                  typeof segment === "number" ? `[${segment}]` : segment;
                return (
                  <Fragment key={index}>
                    <ChevronRight size={12} aria-hidden="true" />
                    {index === path.length - 1 ? (
                      <span aria-current="location">{name}</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => open(path.slice(0, index + 1))}
                      >
                        {name}
                      </button>
                    )}
                  </Fragment>
                );
              })}
            </nav>
          ) : (
            rowLabel
          ),
          pathSlot,
        )}
      {actionSlot &&
        createPortal(
          <>
            <span className="record-status" data-dirty={dirty}>
              {Object.keys(draft).length} {array ? "件" : "KEY"} ·{" "}
              {dirty ? "未確定の変更あり" : "変更なし"}
            </span>
            <button disabled={!dirty || disabled} onClick={reset}>
              <RotateCcw size={14} />
              取り消す
            </button>
            <button
              className="primary"
              disabled={!dirty || disabled}
              onClick={save}
            >
              <Check size={15} />
              変更を確定
            </button>
          </>,
          actionSlot,
        )}
      <div
        className={`record-layout ${!groups.table.length ? "without-table" : ""}`}
      >
        {!!groups.pinnedFull.length && (
          <div
            className="full-fields pinned-full-fields"
            aria-label="ピン留めした全幅フィールド"
          >
            {groups.pinnedFull}
          </div>
        )}
        {!!groups.table.length && (
          <div className="metadata-table" aria-label="短い値の表">
            <div className="metadata-heading">
              <span>KEY</span>
              <span>値</span>
              <span>型</span>
            </div>
            {groups.table}
          </div>
        )}
        {!!groups.detail.length && (
          <div className="detail-fields" aria-label="詳細フィールド">
            {groups.detail}
          </div>
        )}
        {!!groups.full.length && (
          <div className="full-fields">{groups.full}</div>
        )}
      </div>
      {!Object.keys(draft).length && (
        <div className="record-notice">
          <p>
            {path.length
              ? `空の${array ? "配列" : "オブジェクト"}です。上の階層で配置を「右の詳細」にすると、JSON を直接編集できます。`
              : "空のオブジェクトです。「KEY 操作」から項目を追加できます。"}
          </p>
        </div>
      )}
    </>
  );
}

function Field({
  name,
  dataKey,
  field,
  layout,
  compact,
  placement,
  scale,
  disabled,
  error,
  onChange,
  onLayout,
  onOpen,
}: {
  name: string;
  dataKey: string;
  field: FieldDraft;
  layout: Layout;
  compact: boolean;
  placement: "table" | "detail" | "full";
  scale: number;
  disabled: boolean;
  error?: string;
  onChange: (field: FieldDraft) => void;
  onLayout: (layout: Layout) => void;
  onOpen: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const settings = useRef<HTMLDetailsElement>(null);
  const closeSettings = () => {
    if (settings.current) settings.current.open = false;
  };
  const [heightText, setHeightText] = useState(String(layout.height));
  useEffect(() => setHeightText(String(layout.height)), [layout.height]);
  const limit = (height: number) =>
    Math.round(Math.max(44, Math.min(1200, height)));
  const resize = (height: number) => {
    if (height !== layout.height) onLayout({ ...layout, manual: true, height });
  };
  const commitHeight = () => {
    const height = limit(Number(heightText) || layout.height);
    setHeightText(String(height));
    resize(height);
  };
  const [dragged, setDragged] = useState<number | null>(null);
  const dragStart = useRef<{ y: number; height: number } | null>(null);
  const endDrag = (save: boolean) => {
    if (!dragStart.current) return;
    dragStart.current = null;
    if (save && dragged !== null) resize(dragged);
    setDragged(null);
  };
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!settings.current?.contains(event.target as Node)) closeSettings();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && settings.current?.open) {
        closeSettings();
        settings.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  const TypeIcon =
    {
      string: Type,
      number: Hash,
      boolean: ToggleLeft,
      null: CircleSlash,
      array: Brackets,
      object: Braces,
    }[field.type] ?? Type;
  const id = `field-${encodeURIComponent(name)}`;
  return (
    <section
      className={`field ${compact ? "compact-field" : ""} ${placement === "full" ? "wide" : ""}`}
      data-key={dataKey}
      data-pinned={!!layout.pinned}
    >
      <header className="field-header">
        <label htmlFor={id}>{name}</label>
        {!compact && isCompound(field.type) && (
          <button
            type="button"
            className="field-open"
            aria-label={`${name} を開く`}
            onClick={onOpen}
          >
            開く
            <ChevronRight size={14} />
          </button>
        )}
        <button
          type="button"
          className="field-pin"
          aria-label={`${name} を${layout.pinned ? "ピン留め解除" : "ピン留め"}`}
          aria-pressed={!!layout.pinned}
          title={layout.pinned ? "ピン留め解除" : "ピン留め"}
          onClick={() => onLayout({ ...layout, pinned: !layout.pinned })}
        >
          <Pin size={14} />
        </button>
        <details ref={settings} className="field-settings">
          <summary aria-label={`${name} の枠サイズ`}>
            <Maximize2 size={14} />
          </summary>
          <div className="field-settings-panel">
            <div
              className="placement-picker"
              role="group"
              aria-label={`${name} の配置`}
            >
              <span>配置</span>
              {(
                [
                  ["table", "左の表"],
                  ["detail", "右の詳細"],
                  ["full", "全幅"],
                ] as const
              ).map(([value, text]) => (
                <button
                  key={value}
                  type="button"
                  className={placement === value ? "active" : ""}
                  aria-pressed={placement === value}
                  onClick={() => {
                    if (placement !== value)
                      onLayout({ ...layout, manual: true, placement: value });
                    closeSettings();
                  }}
                >
                  {text}
                </button>
              ))}
            </div>
            <label>
              高さ（px）
              <input
                aria-label={`${name} の高さ`}
                type="number"
                min="44"
                max="1200"
                step="4"
                value={heightText}
                onBlur={(event) => {
                  commitHeight();
                  if (!settings.current?.contains(event.relatedTarget as Node))
                    closeSettings();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitHeight();
                    closeSettings();
                    settings.current?.querySelector("summary")?.focus();
                  }
                }}
                onChange={(event) => {
                  // 入力途中の値（3500 など）は丸めず、範囲内のときだけ反映する。
                  setHeightText(event.target.value);
                  const height = Number(event.target.value);
                  if (height >= 44 && height <= 1200) resize(limit(height));
                }}
              />
              <input
                aria-label={`${name} の高さ（スライダー）`}
                type="range"
                min="44"
                max="1200"
                step="4"
                value={layout.height}
                onChange={(event) => resize(Number(event.target.value))}
              />
            </label>
            <button
              onClick={() => {
                onLayout({
                  ...automaticLayout(field.text, field.type),
                  manual: false,
                  pinned: layout.pinned,
                });
                closeSettings();
              }}
            >
              自動サイズに戻す
            </button>
          </div>
        </details>
      </header>
      {field.type === "boolean" ? (
        <select
          id={id}
          value={field.text}
          disabled={disabled}
          onChange={(e) => onChange({ ...field, text: e.target.value })}
        >
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : field.type === "null" ? (
        <div className="null-value">null</div>
      ) : compact && isCompound(field.type) ? (
        <button
          type="button"
          id={id}
          className="field-jump"
          aria-label={`${name} を開く`}
          onClick={onOpen}
        >
          <span>{summarize(field.text, field.type) ?? "JSON を確認"}</span>
          <ChevronRight size={14} />
        </button>
      ) : (
        <textarea
          ref={ref}
          id={id}
          spellCheck={false}
          value={field.text}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          style={{ height: Math.round((dragged ?? layout.height) * scale) }}
          onChange={(event) => onChange({ ...field, text: event.target.value })}
        />
      )}
      {field.type !== "boolean" &&
        field.type !== "null" &&
        !(compact && isCompound(field.type)) && (
          <div
            className="field-resize"
            role="separator"
            aria-orientation="horizontal"
            aria-label={`${name} の高さをドラッグで変更`}
            title="ドラッグで高さを変更（ダブルクリックで自動サイズ）"
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              dragStart.current = {
                y: event.clientY,
                height:
                  (ref.current?.offsetHeight ?? layout.height * scale) / scale,
              };
            }}
            onPointerMove={(event) => {
              const start = dragStart.current;
              if (start)
                setDragged(
                  limit(start.height + (event.clientY - start.y) / scale),
                );
            }}
            onPointerUp={() => endDrag(true)}
            onPointerCancel={() => endDrag(false)}
            onDoubleClick={() =>
              onLayout({
                ...automaticLayout(field.text, field.type),
                manual: false,
                placement: layout.placement,
                pinned: layout.pinned,
              })
            }
          />
        )}
      <footer className="field-footer">
        {error ? (
          <span id={`${id}-error`} className="error-text">
            ⚠ {error}
          </span>
        ) : (
          <span>{field.text.length.toLocaleString()} 文字</span>
        )}
        <div className="type-picker">
          <span className="type-picker-icon" aria-hidden="true">
            <TypeIcon size={16} />
            <ChevronDown size={10} />
          </span>
          <select
            aria-label={`${name} の型`}
            disabled={disabled}
            value={field.type}
            onChange={(event) => {
              const type = event.target.value;
              onChange({
                type,
                text:
                  type === "null"
                    ? "null"
                    : type === "boolean"
                      ? "false"
                      : isCompound(type) && !summarize(field.text, type)
                        ? type === "array"
                          ? "[]"
                          : "{}"
                        : field.text,
              });
            }}
          >
            {["string", "number", "boolean", "null", "array", "object"].map(
              (type) => (
                <option key={type}>{type}</option>
              ),
            )}
          </select>
        </div>
      </footer>
    </section>
  );
}

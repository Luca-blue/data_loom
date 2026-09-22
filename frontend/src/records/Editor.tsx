import { useEffect, useRef, useState } from "react";
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
} from "lucide-react";
import { parseRecord, jsonText, valueType, fieldValue } from "../shared/json";
import { automaticLayout } from "./layout";
import type { Layout, Row } from "../shared/types";

/** KEY の型・文量に合わせた編集欄を表示する。 */
export function Editor({
  row,
  layouts,
  disabled,
  onSave,
  onLayout,
  onDirty,
}: {
  row: Row;
  layouts: Record<string, Layout>;
  disabled: boolean;
  onSave: (text: string) => Promise<boolean>;
  onLayout: (key: string, layout: Layout) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState<
    Record<string, { type: string; text: string }>
  >({});
  const originalFields = useRef<Record<string, { type: string; text: string }>>(
    {},
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    const next: Record<string, { type: string; text: string }> =
      Object.create(null);
    if (row.text && !row.issue)
      for (const [key, value] of Object.entries(parseRecord(row.text)))
        next[key] = {
          type: valueType(value),
          text: typeof value === "string" ? value : jsonText(value, true),
        };
    originalFields.current = next;
    setDraft(next);
    setErrors({});
    setDirty(false);
    onDirty(false);
  }, [row.id, row.text]);
  if (row.deleted)
    return (
      <div className="record-notice">
        <h2>この行は削除されています</h2>
        <p>「元に戻す」で復元できます。書き出しには含まれません。</p>
      </div>
    );
  if (row.issue)
    return (
      <div className="record-notice">
        <h2>この行を確認してください</h2>
        <p role="alert">{row.issue}</p>
        {row.text && <pre>{row.text.slice(0, 12000)}</pre>}
        <p>元データは保持されます。書き出し時に不正行の扱いを選べます。</p>
      </div>
    );
  const save = async () => {
    const next = Object.create(null),
      issues: Record<string, string> = Object.create(null);
    for (const [key, field] of Object.entries(draft)) {
      try {
        next[key] = fieldValue(field.text, field.type);
      } catch (error) {
        issues[key] = (error as Error).message;
      }
    }
    setErrors(issues);
    if (Object.keys(issues).length) return;
    if (await onSave(jsonText(next))) {
      setDirty(false);
      onDirty(false);
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
  const ordered = Object.entries(draft).sort(
    ([a], [b]) =>
      Number(Object.hasOwn(layouts, b) && layouts[b].pinned === true) -
      Number(Object.hasOwn(layouts, a) && layouts[a].pinned === true),
  );
  for (const [key, field] of ordered) {
    const saved = Object.hasOwn(layouts, key) ? layouts[key] : undefined;
    const baseline = originalFields.current[key] ?? field;
    const automatic = automaticLayout(baseline.text, baseline.type);
    const layout = saved?.manual
      ? saved
      : { ...automatic, placement: saved?.placement, pinned: saved?.pinned };
    const placement =
      layout.placement ??
      (automatic.width === "half" &&
      !baseline.text.includes("\n") &&
      baseline.text.length <= 80
        ? "table"
        : "detail");
    groups[
      placement === "full" && layout.pinned ? "pinnedFull" : placement
    ].push(
      <Field
        key={key}
        name={key}
        field={field}
        layout={layout}
        compact={placement === "table"}
        placement={placement}
        disabled={disabled}
        error={errors[key]}
        onChange={(value) => {
          setDraft({ ...draft, [key]: value });
          setDirty(true);
          onDirty(true);
        }}
        onLayout={(next) => onLayout(key, next)}
      />,
    );
  }
  return (
    <>
      <div className="record-actions">
        <span>
          {Object.keys(draft).length} keys{" "}
          <span className="subtle">
            / {dirty ? "未確定の変更" : "端末内に保持"}
          </span>
        </span>
        <div className="button-row">
          <button
            disabled={!dirty || disabled}
            onClick={() => {
              const original = parseRecord(row.text!);
              const next: typeof draft = Object.create(null);
              for (const [key, value] of Object.entries(original))
                next[key] = {
                  type: valueType(value),
                  text:
                    typeof value === "string" ? value : jsonText(value, true),
                };
              setDraft(next);
              setDirty(false);
              onDirty(false);
              setErrors({});
            }}
          >
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
        </div>
      </div>
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
          <p>空のオブジェクトです。「KEY 操作」から項目を追加できます。</p>
        </div>
      )}
    </>
  );
}

function Field({
  name,
  field,
  layout,
  compact,
  placement,
  disabled,
  error,
  onChange,
  onLayout,
}: {
  name: string;
  field: { type: string; text: string };
  layout: Layout;
  compact: boolean;
  placement: "table" | "detail" | "full";
  disabled: boolean;
  error?: string;
  onChange: (field: { type: string; text: string }) => void;
  onLayout: (layout: Layout) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const settings = useRef<HTMLDetailsElement>(null);
  const closeSettings = () => {
    if (settings.current) settings.current.open = false;
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
      data-key={name}
      data-pinned={!!layout.pinned}
    >
      <header className="field-header">
        <label htmlFor={id}>{name}</label>
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
            <label>
              配置
              <select
                aria-label={`${name} の配置`}
                value={placement}
                onChange={(event) => {
                  onLayout({
                    ...layout,
                    manual: true,
                    placement: event.target.value as Layout["placement"],
                  });
                  closeSettings();
                }}
              >
                <option value="table">左の表</option>
                <option value="detail">右の詳細</option>
                <option value="full">全幅</option>
              </select>
            </label>
            <label>
              高さ（px）
              <input
                aria-label={`${name} の高さ`}
                type="number"
                min="44"
                max="1200"
                step="4"
                value={layout.height}
                onBlur={(event) => {
                  if (!settings.current?.contains(event.relatedTarget as Node))
                    closeSettings();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    closeSettings();
                    settings.current?.querySelector("summary")?.focus();
                  }
                }}
                onChange={(event) =>
                  onLayout({
                    ...layout,
                    manual: true,
                    height: Math.max(
                      44,
                      Math.min(1200, Number(event.target.value) || 44),
                    ),
                  })
                }
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
      ) : (
        <textarea
          ref={ref}
          id={id}
          spellCheck={false}
          value={field.text}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          style={{ height: layout.height }}
          onPointerUp={() => {
            const height = ref.current?.offsetHeight;
            if (height && Math.abs(height - layout.height) > 3)
              onLayout({
                ...layout,
                manual: true,
                height: Math.min(1200, Math.max(44, height)),
              });
          }}
          onChange={(event) => onChange({ ...field, text: event.target.value })}
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
            onChange={(event) =>
              onChange({
                type: event.target.value,
                text:
                  event.target.value === "null"
                    ? "null"
                    : event.target.value === "boolean"
                      ? "false"
                      : field.text,
              })
            }
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

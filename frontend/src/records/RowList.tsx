import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileJson2 } from "lucide-react";
import { call } from "../workspace/client";
import type { Row } from "../shared/types";
const WINDOW = 5000,
  HEIGHT = 68;
/** 表示範囲のみを取得し、巨大な DOM を作らず行一覧を表示する。 */
export function RowList({
  version,
  selected,
  onSelect,
  onError,
  onClose,
}: {
  version: number;
  selected: number;
  onSelect: (row: number) => void;
  onError: (text: string) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([]),
    [total, setTotal] = useState(0),
    [offset, setOffset] = useState(0),
    [page, setPage] = useState(0),
    [isFiltered, setFiltered] = useState(false);
  const [jump, setJump] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    call<{ rows: Row[]; total: number; filtered: boolean }>("rows", {
      start: page * WINDOW + offset,
      limit: 40,
    })
      .then((result) => {
        if (active) {
          setRows(result.rows);
          setTotal(result.total);
          setFiltered(result.filtered);
          if (page * WINDOW + offset >= result.total && (page || offset)) {
            setPage(0);
            setOffset(0);
            if (scroller.current) scroller.current.scrollTop = 0;
          }
        }
      })
      .catch((error) => {
        if (active) onError(error.message);
      });
    return () => {
      active = false;
    };
  }, [version, page, offset]);
  const localTotal = Math.max(0, Math.min(WINDOW, total - page * WINDOW));
  return (
    <aside className="row-list">
      <div className="list-heading">
        <button className="mobile-list-toggle" onClick={onClose}>
          詳細に戻る
        </button>
        <span>{isFiltered ? "抽出した行" : "レコード"}</span>
        <span className="mono">{total.toLocaleString()}</span>
      </div>
      <div className="list-jump">
        <label htmlFor="row-jump">表示位置</label>
        <input
          id="row-jump"
          inputMode="numeric"
          placeholder="行番号"
          value={jump}
          onChange={(e) => setJump(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const index = Math.max(0, Math.min(total - 1, Number(jump) - 1));
              const next = Math.floor(index / WINDOW);
              setPage(next);
              setOffset(Math.max(0, (index % WINDOW) - 2));
              if (scroller.current)
                scroller.current.scrollTop =
                  Math.max(0, (index % WINDOW) - 2) * HEIGHT;
            }
          }}
        />
      </div>
      <div
        className="row-scroller"
        ref={scroller}
        onScroll={(event) => {
          const next = Math.max(
            0,
            Math.floor(event.currentTarget.scrollTop / HEIGHT) - 3,
          );
          if (next !== offset) setOffset(next);
        }}
      >
        <div style={{ height: localTotal * HEIGHT, position: "relative" }}>
          {rows.slice(0, Math.max(0, localTotal - offset)).map((row, i) => (
            <button
              key={row.id}
              className={`record-row ${selected === row.id ? "selected" : ""} ${row.deleted ? "deleted" : ""}`}
              style={{ top: (offset + i) * HEIGHT, height: HEIGHT }}
              onClick={() => onSelect(row.id)}
              aria-label={`行 ${row.id + 1}`}
              aria-current={selected === row.id ? "true" : undefined}
            >
              <span className="row-index">
                {String(row.id + 1).padStart(3, "0")}
              </span>
              <span className="row-copy">
                <span className="row-title">
                  {row.deleted
                    ? "削除済み"
                    : row.oversized
                      ? "大きなレコード"
                      : row.issue
                        ? "⚠ 要確認"
                        : `レコード ${row.id + 1}`}
                  {row.edited && !row.deleted && <i aria-label="編集済み" />}
                </span>
                <span className="row-preview">{row.preview}</span>
              </span>
              <FileJson2 size={14} />
            </button>
          ))}
        </div>
        {!total && <p className="list-empty">表示する行がありません</p>}
      </div>
      <div className="list-pagination">
        <button
          aria-label="前の一覧"
          disabled={page === 0}
          onClick={() => {
            setPage(page - 1);
            setOffset(0);
            if (scroller.current) scroller.current.scrollTop = 0;
          }}
        >
          <ChevronLeft size={15} />
        </button>
        <span>
          {page + 1} / {Math.max(1, Math.ceil(total / WINDOW))}
        </span>
        <button
          aria-label="次の一覧"
          disabled={(page + 1) * WINDOW >= total}
          onClick={() => {
            setPage(page + 1);
            setOffset(0);
            if (scroller.current) scroller.current.scrollTop = 0;
          }}
        >
          <ChevronRight size={15} />
        </button>
      </div>
    </aside>
  );
}

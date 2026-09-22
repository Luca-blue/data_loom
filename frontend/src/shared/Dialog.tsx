import { useEffect, useRef, type ReactNode } from "react";
import type { Progress } from "./types";
import { X } from "lucide-react";
/** フォーカス制御をブラウザに委ねたモーダルを表示する。 */
export function Dialog({
  title,
  children,
  onClose,
  error,
  busy,
  progress,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  error?: string;
  busy?: boolean;
  progress?: Progress | null;
  onCancel?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <header className="dialog-header">
        <h2>{title}</h2>
        <button aria-label="閉じる" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="dialog-body">
        {error && (
          <p className="error-text" role="alert">
            ⚠ {error}
          </p>
        )}
        {busy && (
          <div className="dialog-progress" role="status">
            <span>{progress?.label ?? "処理中…"}</span>
            <progress value={progress?.done ?? 0} max={progress?.total || 1} />
            <button onClick={onCancel}>中止</button>
          </div>
        )}
        {children}
      </div>
    </dialog>
  );
}

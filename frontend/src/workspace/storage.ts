import { openDB } from "idb";
import type { Workspace, Patch } from "../shared/types";
const dbPromise = openDB("data-loom-v1", 1, {
  upgrade(db) {
    db.createObjectStore("workspaces", { keyPath: "id" });
    const patches = db.createObjectStore("patches", {
      keyPath: ["workspace", "revision", "row"],
    });
    patches.createIndex("row", ["workspace", "row", "revision"]);
    db.createObjectStore("commits", { keyPath: ["workspace", "revision"] });
  },
});
/** 端末内に保存した作業一覧を返す。
 * Returns:
 *   作成日時の新しい順の作業一覧。
 */
export async function listWorkspaces(): Promise<Workspace[]> {
  return (await (await dbPromise).getAll("workspaces")).sort(
    (a, b) => b.created - a.created,
  );
}
/** 作業メタデータを読み込む。
 * Args:
 *   id: 作業 ID。
 * Returns:
 *   保存した作業情報。
 */
export async function getWorkspace(id: string): Promise<Workspace> {
  return (await dbPromise).get("workspaces", id);
}
/** 作業メタデータを永続化する。
 * Args:
 *   workspace: 保存する作業。
 * Raises:
 *   DOMException: 容量またはアクセスの制限で書き込めない場合。
 */
export async function saveWorkspace(workspace: Workspace): Promise<void> {
  await (await dbPromise).put("workspaces", workspace);
}
/** 新しい履歴の前に破棄された redo と未確定差分を除去する。
 * Args:
 *   workspace: 現在の作業。tip を現在の head に更新する。
 */
export async function clearFuture(workspace: Workspace): Promise<void> {
  const tx = (await dbPromise).transaction(
    ["patches", "commits", "workspaces"],
    "readwrite",
  );
  workspace.tip = workspace.head;
  tx.objectStore("workspaces").put(workspace);
  tx.objectStore("patches").delete(
    IDBKeyRange.bound(
      [workspace.id, workspace.head + 1, 0],
      [workspace.id, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    ),
  );
  tx.objectStore("commits").delete(
    IDBKeyRange.bound(
      [workspace.id, workspace.head + 1],
      [workspace.id, Number.MAX_SAFE_INTEGER],
    ),
  );
  await tx.done;
}
/** 一定量の編集差分を未確定の履歴として書き込む。
 * Args:
 *   patches: 一度に保存する差分。呼び出し元でバイト数を制限する。
 * Raises:
 *   DOMException: 保存できない場合。
 */
export async function stagePatches(patches: Patch[]): Promise<void> {
  const tx = (await dbPromise).transaction("patches", "readwrite");
  for (const patch of patches) tx.store.put(patch);
  await tx.done;
}
/** メタデータと履歴を同一トランザクションで確定する。
 * Args:
 *   workspace: 編集前の作業。
 *   added: 確定後の追加行数。
 * Returns:
 *   更新した履歴位置を持つ作業。
 */
export async function commit(
  workspace: Workspace,
  added: number,
): Promise<Workspace> {
  const next = {
    ...workspace,
    head: workspace.head + 1,
    tip: workspace.head + 1,
    added,
  };
  const tx = (await dbPromise).transaction(
    ["workspaces", "commits"],
    "readwrite",
  );
  tx.objectStore("commits").put({
    workspace: workspace.id,
    revision: next.head,
    added,
  });
  tx.objectStore("workspaces").put(next);
  await tx.done;
  return next;
}
/** 対象行の確定済み最新差分だけを返す。
 * Args:
 *   workspace: 現在の作業。
 *   row: 行 ID。
 * Returns:
 *   最新差分。変更がなければ undefined。
 */
export async function patchFor(
  workspace: Workspace,
  row: number,
): Promise<Patch | undefined> {
  const cursor = await (
    await dbPromise
  )
    .transaction("patches")
    .store.index("row")
    .openCursor(
      IDBKeyRange.bound(
        [workspace.id, row, 0],
        [workspace.id, row, workspace.head],
      ),
      "prev",
    );
  return cursor?.value;
}
/** Undo または Redo で参照履歴を切り替える。
 * Args:
 *   workspace: 現在の作業。
 *   direction: Undo は -1、Redo は 1。
 * Returns:
 *   履歴位置と追加行数を更新した作業。
 */
export async function moveHistory(
  workspace: Workspace,
  direction: number,
): Promise<Workspace> {
  const head = Math.max(0, Math.min(workspace.tip, workspace.head + direction));
  const entry = head
    ? await (await dbPromise).get("commits", [workspace.id, head])
    : { added: 0 };
  const next = { ...workspace, head, added: entry.added };
  await saveWorkspace(next);
  return next;
}
/** 作業のメタデータ・差分・履歴を端末内から削除する。
 * Args:
 *   id: 削除する作業 ID。
 * Raises:
 *   DOMException: 保存領域にアクセスできない場合。
 */
export async function deleteWorkspace(id: string): Promise<void> {
  const tx = (await dbPromise).transaction(
    ["workspaces", "patches", "commits"],
    "readwrite",
  );
  tx.objectStore("workspaces").delete(id);
  tx.objectStore("patches").delete(
    IDBKeyRange.bound(
      [id, 0, 0],
      [id, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    ),
  );
  tx.objectStore("commits").delete(
    IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]),
  );
  await tx.done;
  const root = await navigator.storage.getDirectory();
  try {
    await root.removeEntry(id, { recursive: true });
  } catch (e) {
    if ((e as DOMException).name !== "NotFoundError") throw e;
  }
}
/** 指定範囲に編集履歴があるかだけを調べる。
 * Args:
 *   workspace: 現在の作業。
 *   start: 範囲の先頭行 ID。
 *   end: 範囲の最終行 ID。
 * Returns:
 *   履歴が存在する場合は true。
 */
export async function hasPatches(
  workspace: Workspace,
  start: number,
  end: number,
): Promise<boolean> {
  if (!workspace.head) return false;
  return (
    (await (
      await dbPromise
    ).countFromIndex(
      "patches",
      "row",
      IDBKeyRange.bound(
        [workspace.id, start, 0],
        [workspace.id, end, Number.MAX_SAFE_INTEGER],
      ),
    )) > 0
  );
}

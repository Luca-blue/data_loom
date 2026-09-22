import type { RpcResponse, Progress, Workspace } from "../shared/types";
const worker = new Worker(new URL("./worker.ts", import.meta.url), {
  type: "module",
});
let sequence = 0;
const waiting = new Map<
  number,
  { resolve: (value: any) => void; reject: (error: Error) => void }
>();
let listener: (message: RpcResponse) => void = () => {};
worker.onmessage = ({ data }: { data: RpcResponse }) => {
  if (data.id !== undefined) {
    const pending = waiting.get(data.id);
    if (pending) {
      waiting.delete(data.id);
      data.error
        ? pending.reject(new Error(data.error))
        : pending.resolve(data.result);
    }
  } else listener(data);
};
worker.onerror = (event) => {
  for (const pending of waiting.values())
    pending.reject(new Error(event.message));
  waiting.clear();
};
/** Worker の進捗と作業状態の通知先を登録する。
 * Args:
 *   callback: 通知を受信する関数。
 */
export function onUpdate(
  callback: (message: { progress?: Progress; workspace?: Workspace }) => void,
): void {
  listener = callback;
}
/** データ本体をネットワークへ送信せず Worker に処理を依頼する。
 * Args:
 *   command: 操作名。
 *   args: 操作固有のパラメーター。
 * Returns:
 *   対応する Worker の応答。
 * Raises:
 *   Error: Worker 側で処理が失敗した場合。
 */
export function call<T = any>(command: string, args: any = {}): Promise<T> {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    worker.postMessage({ id, command, args });
  });
}

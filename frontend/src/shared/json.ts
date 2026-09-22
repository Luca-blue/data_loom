import { parse, stringify, isLosslessNumber } from "lossless-json";
export const MAX_ROW = 16 * 1024 * 1024;
export const CHUNK = 1024 * 1024;
export const encoder = new TextEncoder();
/** 数値の字句を保ち、重複 KEY を拒否して JSON を解析する。
 * Args:
 *   text: 解析する JSON 文字列。
 * Returns:
 *   精度を維持した値。
 * Raises:
 *   Error: 文法不正または KEY 重複の場合。
 */
export function parseJson(text: string): any {
  return parse(text, undefined, {
    onDuplicateKey: ({ key }: { key: string }) => {
      throw new Error(`KEY「${key}」が重複しています`);
    },
  });
}
/** オブジェクトであることを検査して JSONL の1行を解析する。
 * Args:
 *   text: JSONL の1行。
 * Returns:
 *   KEY と値のオブジェクト。
 * Raises:
 *   Error: 不正な JSON またはオブジェクト以外の場合。
 */
export function parseRecord(text: string): Record<string, any> {
  const value = parseJson(text);
  if (
    value === null ||
    Array.isArray(value) ||
    typeof value !== "object" ||
    isLosslessNumber(value)
  )
    throw new Error("1行は JSON オブジェクトにしてください");
  return value;
}
/** 精度を維持して JSON 文字列に変換する。
 * Args:
 *   value: 直列化する値。
 *   pretty: 読みやすく改行するかどうか。
 * Returns:
 *   JSON 文字列。
 */
export function jsonText(value: any, pretty = false): string {
  return stringify(value, undefined, pretty ? 2 : undefined) ?? "null";
}
/** エディターに表示する JSON の型名を返す。
 * Args:
 *   value: 型を調べる値。
 * Returns:
 *   string、number、boolean、null、array、object のいずれか。
 */
export function valueType(value: any): string {
  if (value === null) return "null";
  if (isLosslessNumber(value)) return "number";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
/** 型付き編集欄の文字列を JSON 値へ変換する。
 * Args:
 *   text: 編集した文字列。
 *   type: 入力欄の型。
 * Returns:
 *   指定した型の JSON 値。
 * Raises:
 *   Error: 入力が不正または指定した型と異なる場合。
 */
export function fieldValue(text: string, type: string): any {
  if (type === "string") return text;
  const value = parseJson(text);
  if (valueType(value) !== type)
    throw new Error(`${type} 型の値を入力してください`);
  return value;
}
/** UTF-8 を厳密に復号し、先頭行に限り BOM を許容する。
 * Args:
 *   bytes: 元のバイト列。
 *   first: ファイルの先頭行かどうか。
 * Returns:
 *   復号した文字列。
 * Raises:
 *   TypeError: 不正な UTF-8 の場合。
 */
export function decodeLine(bytes: Uint8Array, first = false): string {
  const text = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: true,
  }).decode(bytes);
  return first && text.startsWith("\uFEFF") ? text.slice(1) : text;
}
/** 容量を読みやすい単位で表示する。
 * Args:
 *   bytes: バイト数。
 * Returns:
 *   B、KiB、MiB、GiB の容量表記。
 */
export function formatBytes(bytes: number): string {
  const unit =
    bytes >= 1024 ** 3 ? 3 : bytes >= 1024 ** 2 ? 2 : bytes >= 1024 ? 1 : 0;
  return `${(bytes / 1024 ** unit).toLocaleString("ja-JP", { maximumFractionDigits: unit ? 1 : 0 })} ${["B", "KiB", "MiB", "GiB"][unit]}`;
}

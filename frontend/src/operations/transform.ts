import type { Filter, KeyOperation } from "../shared/types";
import { jsonText, parseJson, parseRecord, valueType } from "../shared/json";

/** 行に対する文字列検索と AND 条件を評価する。
 * Args:
 *   text: 行の本文。
 *   filter: 検索条件。
 *   issue: 診断対象の行かどうか。
 * Returns:
 *   すべての条件に一致する場合は true。
 */
export function matches(text: string, filter: Filter, issue = false): boolean {
  if (filter.issuesOnly && !issue) return false;
  if (filter.text && !text.includes(filter.text)) return false;
  if (!filter.conditions.length) return true;
  let record: Record<string, any>;
  try {
    record = parseRecord(text);
  } catch {
    return false;
  }
  return filter.conditions.every((c) => {
    const exists = Object.hasOwn(record, c.key),
      value = record[c.key];
    if (c.op === "exists") return c.value === "false" ? !exists : exists;
    if (!exists) return false;
    if (c.op === "type") return valueType(value) === c.value;
    if (c.op === "equals") {
      try {
        return jsonText(value) === jsonText(parseJson(c.value));
      } catch {
        return typeof value === "string" && value === c.value;
      }
    }
    return (typeof value === "string" ? value : jsonText(value)).includes(
      c.value,
    );
  });
}

/** KEY の追加・削除・改名を精度を維持して適用する。
 * Args:
 *   text: 対象の JSONL 行。
 *   operation: KEY 操作の設定。
 * Returns:
 *   変換後の JSONL 行。
 * Raises:
 *   Error: JSON が不正、または変更先 KEY が衝突する場合。
 */
export function transformKey(text: string, operation: KeyOperation): string {
  const record = parseRecord(text),
    { key, target, mode } = operation;
  if (mode === "add") {
    if (Object.hasOwn(record, key))
      throw new Error(`KEY「${key}」が既に存在します`);
    Object.defineProperty(record, key, {
      value: parseJson(operation.value),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  } else if (mode === "delete") delete record[key];
  else if (Object.hasOwn(record, key)) {
    if (key === target || Object.hasOwn(record, target))
      throw new Error(`改名先「${target}」が既に存在します`);
    Object.defineProperty(record, target, {
      value: record[key],
      enumerable: true,
      writable: true,
      configurable: true,
    });
    delete record[key];
  }
  return jsonText(record);
}

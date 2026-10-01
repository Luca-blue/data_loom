import { isLosslessNumber } from "lossless-json";
import { jsonText, parseRecord } from "../shared/json";

const MAX_TEXT = 262144,
  PREVIEW_ITEMS = 4;

const squash = (text: string, limit: number) =>
  text.replace(/\s+/g, " ").slice(0, limit);

/** 行の最上位のスカラー値から、一覧用のタイトルとプレビューを作る。
 * Args:
 *   text: 行の JSON 文字列。
 *   pinned: 先頭に表示する KEY。
 * Returns:
 *   title は先頭のスカラー値、preview は続く最大4件の `KEY: 値`。
 *   解析できない場合やスカラー値がない場合は title なしで先頭180文字を返す。
 */
export function summarizeRow(
  text: string,
  pinned: string[],
): { title?: string; preview: string } {
  const fallback = { preview: squash(text, 180) };
  if (text.length > MAX_TEXT) return fallback;
  let record: Record<string, any>;
  try {
    record = parseRecord(text);
  } catch {
    return fallback;
  }
  const keys = Object.keys(record).filter((key) => {
    const value = record[key];
    return (
      (typeof value === "string" && value !== "") ||
      typeof value === "boolean" ||
      isLosslessNumber(value)
    );
  });
  const first = new Set(pinned);
  const ordered = [
    ...keys.filter((key) => first.has(key)),
    ...keys.filter((key) => !first.has(key)),
  ];
  if (!ordered.length) return fallback;
  const show = (key: string) => {
    const value = record[key];
    return typeof value === "string" ? value : jsonText(value);
  };
  return {
    title: squash(show(ordered[0]), 80),
    preview: ordered
      .slice(1, 1 + PREVIEW_ITEMS)
      .map((key) => `${key}: ${squash(show(key), 60)}`)
      .join(" · "),
  };
}

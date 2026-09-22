import type { Layout } from "../shared/types";

/** 表示中の値に合わせた編集枠の自動サイズを返す。
 * Args:
 *   text: 編集欄の文字列。
 *   type: JSON の値の型。
 * Returns:
 *   短い値は半幅、長文や複合値は全幅にしたサイズ。
 */
export function automaticLayout(text: string, type: string): Layout {
  const compound = type === "array" || type === "object";
  const lines = text
    .split("\n")
    .reduce(
      (total, line) => total + Math.max(1, Math.ceil(line.length / 70)),
      0,
    );
  return {
    width: text.length > 180 || compound ? "full" : "half",
    height: Math.min(480, Math.max(44, lines * 27 + 16)),
  };
}

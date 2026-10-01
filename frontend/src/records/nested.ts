import { jsonText, parseJson, valueType, fieldValue } from "../shared/json";

/** 編集欄1つ分の型と入力中の文字列。 */
export type FieldDraft = { type: string; text: string };
/** KEY（配列では添字）ごとの編集欄。 */
export type Fields = Record<string, FieldDraft>;
/** ネストをたどる1段分。オブジェクトは KEY、配列は添字。 */
export type Segment = string | number;

/** 入れ子の階層を区切る、表示設定の KEY 用の文字。 */
export const LAYOUT_SEPARATOR = "\u0000";

const isContainer = (value: any) =>
  ["object", "array"].includes(valueType(value));

/** 値が開ける型（object または array）かどうかを返す。
 * Args:
 *   type: JSON の値の型。
 * Returns:
 *   開ける型の場合は true。
 */
export function isCompound(type: string): boolean {
  return type === "object" || type === "array";
}

/** オブジェクトまたは配列を、1階層分の編集欄へ変換する。
 * Args:
 *   container: 表示するオブジェクトまたは配列。
 * Returns:
 *   KEY（配列では添字）ごとの型と文字列。
 */
export function fieldsOf(container: any): Fields {
  const fields: Fields = Object.create(null);
  for (const [key, value] of Object.entries(container))
    fields[key] = {
      type: valueType(value),
      text: typeof value === "string" ? value : jsonText(value, true),
    };
  return fields;
}

/** 経路の先にあるオブジェクトまたは配列を返す。
 * Args:
 *   root: 行全体の値。
 *   path: 最上位からの経路。
 * Returns:
 *   経路の先の値。開ける型でない、または存在しない場合は undefined。
 */
export function containerAt(root: any, path: Segment[]): any {
  let value = root;
  for (const segment of path) {
    if (!isContainer(value) || !Object.hasOwn(value, segment)) return undefined;
    value = value[segment];
  }
  return isContainer(value) ? value : undefined;
}

/** 経路のうち、実際に開ける階層までを返す。
 * Args:
 *   root: 行全体の値。
 *   path: 最上位からの経路。
 * Returns:
 *   開ける最も深い階層までの経路。
 */
export function resolvePath(root: any, path: Segment[]): Segment[] {
  let length = path.length;
  while (length && containerAt(root, path.slice(0, length)) === undefined)
    length--;
  return path.slice(0, length);
}

/** 1階層分の編集欄を検証し、オブジェクトまたは配列に戻す。
 * Args:
 *   fields: KEY（配列では添字）ごとの編集欄。
 *   array: 配列として組み立てるかどうか。
 * Returns:
 *   組み立てた値と、KEY ごとの入力エラー。
 */
export function buildContainer(
  fields: Fields,
  array: boolean,
): { value: any; issues: Record<string, string> } {
  const value = array ? [] : Object.create(null),
    issues: Record<string, string> = Object.create(null);
  for (const [key, field] of Object.entries(fields)) {
    try {
      const item = fieldValue(field.text, field.type);
      if (array) value.push(item);
      else value[key] = item;
    } catch (error) {
      issues[key] = (error as Error).message;
    }
  }
  return { value, issues };
}

/** 経路の先の値を置き換えた、新しい行全体の値を返す。
 * Args:
 *   root: 行全体の値。
 *   path: 置き換える位置までの経路。
 *   value: 新しい値。
 * Returns:
 *   経路上だけを複製して置き換えた値。
 */
export function replaceAt(root: any, path: Segment[], value: any): any {
  if (!path.length) return value;
  const [head, ...rest] = path;
  const copy = Array.isArray(root)
    ? root.slice()
    : Object.assign(Object.create(null), root);
  copy[head] = replaceAt(root[head], rest, value);
  return copy;
}

/** 表示設定を保存する KEY を返す。配列の要素は添字によらず共有する。
 * Args:
 *   path: 表示中の階層までの経路。
 *   key: 階層内の KEY（配列では添字）。
 *   array: 表示中の階層が配列かどうか。
 * Returns:
 *   最上位は KEY そのもの、入れ子は区切り文字でつないだ文字列。
 */
export function layoutKey(
  path: Segment[],
  key: string,
  array: boolean,
): string {
  if (!path.length) return key;
  const parent = path.map((segment) =>
    typeof segment === "number" ? "#" : segment,
  );
  return [...parent, array ? "#" : key].join(LAYOUT_SEPARATOR);
}

/** 開ける値の中身の件数を、表に表示する文字列にする。
 * Args:
 *   text: 編集欄の JSON 文字列。
 *   type: JSON の値の型。
 * Returns:
 *   「3 KEY」「5 件」などの文字列。解析できない場合は null。
 */
export function summarize(text: string, type: string): string | null {
  try {
    const value = parseJson(text);
    if (valueType(value) !== type) return null;
    return type === "array"
      ? `${value.length.toLocaleString()} 件`
      : `${Object.keys(value).length.toLocaleString()} KEY`;
  } catch {
    return null;
  }
}

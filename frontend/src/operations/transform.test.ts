import { describe, expect, it } from "vitest";
import { parseRecord, jsonText } from "../shared/json";
import { matches, transformKey } from "./transform";
import type { KeyOperation } from "../shared/types";
const operation: KeyOperation = {
  mode: "add",
  key: "split",
  target: "",
  value: '"train"',
  scope: "all",
  row: 0,
};
describe("データ保全と変換", () => {
  it("大きな整数・小数・指数の字句を保存する", () => {
    const text =
      '{"id":900719925474099312345,"score":1.23000000000000000001,"n":1e400}';
    expect(jsonText(parseRecord(text))).toBe(text);
    expect(transformKey(text, operation)).toContain("900719925474099312345");
  });
  it("重複 KEY とオブジェクト以外を拒否する", () => {
    expect(() => parseRecord('{"a":1,"a":2}')).toThrow(/重複/);
    expect(() => parseRecord("[]")).toThrow();
    expect(() => parseRecord("null")).toThrow();
  });
  it("衝突する改名と追加を拒否する", () => {
    expect(() => transformKey('{"split":1}', operation)).toThrow(/既に/);
    expect(() =>
      transformKey('{"a":1,"b":2}', {
        ...operation,
        mode: "rename",
        key: "a",
        target: "b",
      }),
    ).toThrow(/既に/);
  });
  it("特殊な KEY をデータとして扱う", () => {
    const text = transformKey("{}", {
      ...operation,
      key: "__proto__",
      value: '{"polluted":true}',
    });
    expect(text).toBe('{"__proto__":{"polluted":true}}');
    expect(({} as any).polluted).toBeUndefined();
  });
  it("KEY の削除と改名で他の値を維持する", () => {
    expect(
      transformKey('{"a":1,"b":2}', { ...operation, mode: "delete", key: "a" }),
    ).toBe('{"b":2}');
    expect(
      transformKey('{"a":1}', {
        ...operation,
        mode: "rename",
        key: "a",
        target: "c",
      }),
    ).toBe('{"c":1}');
  });
  it("条件を AND で評価し、存在しない KEY と null を区別する", () => {
    const text = '{"a":null,"b":"日本語","id":900719925474099312345}';
    expect(
      matches(text, {
        text: "日本語",
        conditions: [
          { key: "a", op: "exists", value: "true" },
          { key: "a", op: "type", value: "null" },
        ],
      }),
    ).toBe(true);
    expect(
      matches(text, {
        text: "",
        conditions: [{ key: "absent", op: "exists", value: "true" }],
      }),
    ).toBe(false);
    expect(
      matches(text, {
        text: "",
        conditions: [
          { key: "id", op: "equals", value: "900719925474099312345" },
        ],
      }),
    ).toBe(true);
  });
});

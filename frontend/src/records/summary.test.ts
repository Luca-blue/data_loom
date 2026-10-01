import { describe, expect, it } from "vitest";
import { summarizeRow } from "./summary";

describe("summarizeRow", () => {
  it("ピンした KEY を先頭にし、続く最大4件を連結する", () => {
    const text = JSON.stringify({
      a: "A",
      b: "B",
      c: 3,
      d: true,
      e: "E",
      f: "F",
    });
    expect(summarizeRow(text, ["c"])).toEqual({
      title: "3",
      preview: "a: A · b: B · d: true · e: E",
    });
  });
  it("スカラー値がなければ従来のプレビューにする", () => {
    const text = '{"a": null,\n "b": {"x": 1}, "c": [1], "d": ""}';
    expect(summarizeRow(text, [])).toEqual({
      preview: text.replace(/\s+/g, " "),
    });
  });
  it("不正な JSON は先頭180文字を返す", () => {
    const text = "x".repeat(300);
    expect(summarizeRow(text, [])).toEqual({ preview: "x".repeat(180) });
  });
  it("長い値を切り詰める", () => {
    const text = JSON.stringify({ a: "あ ".repeat(100), b: "b".repeat(100) });
    const result = summarizeRow(text, []);
    expect(result.title).toHaveLength(80);
    expect(result.title).not.toMatch(/\s{2}/);
    expect(result.preview).toBe(`b: ${"b".repeat(60)}`);
  });
  it("20桁の整数の精度を保つ", () => {
    const text = '{"id": 12345678901234567890, "n": 0.10}';
    expect(summarizeRow(text, [])).toEqual({
      title: "12345678901234567890",
      preview: "n: 0.10",
    });
  });
  it("上限を超える行は解析しない", () => {
    const text = JSON.stringify({ a: "x".repeat(262144) });
    const result = summarizeRow(text, []);
    expect(result.title).toBeUndefined();
    expect(result.preview).toHaveLength(180);
  });
});

import { describe, expect, it } from "vitest";
import { jsonText, parseRecord } from "../shared/json";
import {
  buildContainer,
  containerAt,
  fieldsOf,
  layoutKey,
  LAYOUT_SEPARATOR,
  replaceAt,
  resolvePath,
  summarize,
} from "./nested";

const text =
  '{"name":"x","aaa":{"bbb":{"ccc":12345678901234567890,"ddd":"hello"}},"items":[{"id":1},"two"]}';

describe("ネストした値の階層移動", () => {
  it("経路の先のオブジェクトと配列を1階層分の編集欄にする", () => {
    const root = parseRecord(text);
    expect(fieldsOf(containerAt(root, ["aaa", "bbb"]))).toEqual({
      ccc: { type: "number", text: "12345678901234567890" },
      ddd: { type: "string", text: "hello" },
    });
    expect(fieldsOf(containerAt(root, ["items"]))).toEqual({
      0: { type: "object", text: '{\n  "id": 1\n}' },
      1: { type: "string", text: "two" },
    });
  });

  it("開けない経路は開ける階層まで戻す", () => {
    const root = parseRecord(text);
    expect(containerAt(root, ["name"])).toBeUndefined();
    expect(containerAt(root, ["aaa", "missing"])).toBeUndefined();
    expect(resolvePath(root, ["aaa", "bbb", "ddd"])).toEqual(["aaa", "bbb"]);
    expect(resolvePath(root, ["items", 5, "id"])).toEqual(["items"]);
    expect(resolvePath(root, ["name"])).toEqual([]);
  });

  it("入れ子の値だけを置き換え、数値の精度と KEY の順序を保つ", () => {
    const root = parseRecord(text);
    const fields = fieldsOf(containerAt(root, ["aaa", "bbb"]));
    fields.ddd = { type: "string", text: "world" };
    const { value, issues } = buildContainer(fields, false);
    expect(issues).toEqual({});
    expect(jsonText(replaceAt(root, ["aaa", "bbb"], value))).toBe(
      text.replace("hello", "world"),
    );
    expect(jsonText(root)).toBe(text);
  });

  it("配列の要素を順序どおりに組み立てる", () => {
    const root = parseRecord(text);
    const fields = fieldsOf(containerAt(root, ["items"]));
    fields[1] = { type: "number", text: "2" };
    const { value } = buildContainer(fields, true);
    expect(jsonText(replaceAt(root, ["items"], value))).toBe(
      text.replace('"two"', "2"),
    );
  });

  it("型に合わない入力を KEY ごとのエラーにする", () => {
    const { issues } = buildContainer(
      {
        ccc: { type: "number", text: "12a" },
        ddd: { type: "string", text: "" },
      },
      false,
    );
    expect(Object.keys(issues)).toEqual(["ccc"]);
  });

  it("表示設定の KEY を最上位と入れ子で分け、配列の要素は共有する", () => {
    expect(layoutKey([], "aaa", false)).toBe("aaa");
    expect(layoutKey(["aaa"], "bbb", false)).toBe(
      ["aaa", "bbb"].join(LAYOUT_SEPARATOR),
    );
    expect(layoutKey(["items"], "0", true)).toBe(
      layoutKey(["items"], "1", true),
    );
    expect(layoutKey(["items", 0], "id", false)).toBe(
      layoutKey(["items", 1], "id", false),
    );
  });

  it("中身の件数を要約する", () => {
    expect(summarize('{"a":1,"b":2}', "object")).toBe("2 KEY");
    expect(summarize("[1,2,3]", "array")).toBe("3 件");
    expect(summarize("{", "object")).toBeNull();
    expect(summarize("[]", "object")).toBeNull();
  });
});

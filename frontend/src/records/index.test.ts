import { describe, expect, it } from "vitest";
import { scanFile, readEntry } from "./index";
import { CHUNK, MAX_ROW } from "../shared/json";
function memoryIndex(): FileSystemSyncAccessHandle {
  let bytes = new Uint8Array(65536),
    size = 0;
  return {
    write(buffer, { at = 0 } = {}) {
      const input = ArrayBuffer.isView(buffer)
        ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
        : new Uint8Array(buffer);
      bytes.set(input, at);
      size = Math.max(size, at + input.length);
      return input.length;
    },
    read(buffer, { at = 0 } = {}) {
      const output = ArrayBuffer.isView(buffer)
        ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
        : new Uint8Array(buffer);
      const count = Math.min(output.length, size - at);
      output.set(bytes.subarray(at, at + count));
      return count;
    },
    truncate(length) {
      size = length;
    },
    getSize() {
      return size;
    },
    close() {},
    flush() {},
  };
}
describe("ストリーム行索引", () => {
  it("BOM・CRLF・空行・末尾改行なしを正しく索引化する", async () => {
    const file = new File(['\uFEFF{"id":1}\r\n\n{"id":2}'], "test.jsonl"),
      index = memoryIndex();
    const result = await scanFile(file, index, async () => {});
    expect(result.count).toBe(3);
    expect(result.issues).toBe(1);
    expect(readEntry(index, 0).offset).toBe(0);
    expect(readEntry(index, 1).flags).toBe(1);
    expect(readEntry(index, 2).offset + readEntry(index, 2).length).toBe(
      file.size,
    );
  });
  it("UTF-8 がチャンク境界をまたいでも保持する", async () => {
    const text = '{"text":"' + "a".repeat(CHUNK - 10) + '日本語"}\n{"x":true}';
    const index = memoryIndex(),
      result = await scanFile(
        new File([text], "boundary.jsonl"),
        index,
        async () => {},
      );
    expect(result.count).toBe(2);
    expect(result.issues).toBe(0);
    expect(readEntry(index, 1).offset).toBe(
      new TextEncoder().encode(text.split("\n")[0] + "\n").length,
    );
  });
  it("巨大な行を解析せず、後続の有効行を読み込む", async () => {
    const index = memoryIndex(),
      result = await scanFile(
        new File(
          ['{"text":"', "a".repeat(MAX_ROW + 1), '"}\n{"ok":true}\n'],
          "huge.jsonl",
        ),
        index,
        async () => {},
      );
    expect(result.count).toBe(2);
    expect(result.oversized).toBe(1);
    expect(readEntry(index, 0).flags).toBe(2);
    expect(readEntry(index, 1).flags).toBe(0);
  });
  it("不正 UTF-8・重複 KEY を診断する", async () => {
    const index = memoryIndex(),
      result = await scanFile(
        new File([new Uint8Array([255, 10]), '{"x":1,"x":2}\n'], "bad.jsonl"),
        index,
        async () => {},
      );
    expect(result.issues).toBe(2);
  });
});

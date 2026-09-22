import { createSHA256 } from "hash-wasm";
import {
  CHUNK,
  MAX_ROW,
  decodeLine,
  parseRecord,
  jsonText,
} from "../shared/json";
import type { Layout } from "../shared/types";

export const ENTRY_SIZE = 24;
export type Entry = { offset: number; length: number; flags: number };

const indexCache = new WeakMap<
  FileSystemSyncAccessHandle,
  { start: number; bytes: Uint8Array }
>();

/** ディスク索引から指定行のバイト範囲と診断フラグを読む。 */
export function readEntry(
  index: FileSystemSyncAccessHandle,
  row: number,
): Entry {
  let cached = indexCache.get(index);
  if (
    !cached ||
    row < cached.start ||
    (row - cached.start + 1) * ENTRY_SIZE > cached.bytes.length
  ) {
    const start = Math.floor(row / 8192) * 8192;
    const buffer = new Uint8Array(ENTRY_SIZE * 8192);
    const size = index.read(buffer, { at: start * ENTRY_SIZE });
    cached = { start, bytes: buffer.subarray(0, size) };
    indexCache.set(index, cached);
  }
  const offset = (row - cached.start) * ENTRY_SIZE;
  if (offset + ENTRY_SIZE > cached.bytes.length)
    throw new Error("行索引が不足しています。ファイルを開き直してください");
  const view = new DataView(
    cached.bytes.buffer,
    cached.bytes.byteOffset + offset,
    ENTRY_SIZE,
  );
  return {
    offset: view.getFloat64(0, true),
    length: view.getFloat64(8, true),
    flags: view.getUint32(16, true),
  };
}

/** メモリ使用量を制限しながら、ハッシュ・行索引・診断を作成する。
 * Args:
 *   file: 読み取り専用の元ファイル。
 *   index: OPFS の固定長索引。
 *   update: 各チャンク処理後の進捗通知。
 * Returns:
 *   ハッシュ、行数、診断件数、初期レイアウト。
 * Raises:
 *   Error: 読み込み失敗または中止時。
 */
export async function scanFile(
  file: File,
  index: FileSystemSyncAccessHandle,
  update: (
    bytes: number,
    count: number,
    issues: number,
    oversized: number,
    layouts: Record<string, Layout>,
  ) => Promise<void>,
) {
  const hash = await createSHA256();
  hash.init();
  let count = 0,
    start = 0,
    issues = 0,
    oversized = 0,
    pending = 0,
    sampled = 0;
  let parts: Uint8Array[] = [];
  const layouts: Record<string, Layout> = Object.create(null);
  const output = new Uint8Array(ENTRY_SIZE * 8192),
    view = new DataView(output.buffer);
  let entries = 0,
    written = 0;
  const flush = () => {
    if (entries) {
      index.write(output.subarray(0, entries * ENTRY_SIZE), { at: written });
      written += entries * ENTRY_SIZE;
      entries = 0;
    }
  };
  const finish = (end: number) => {
    const length = end - start;
    let flags = 0;
    if (length > MAX_ROW) {
      flags = 2;
      oversized++;
    } else {
      let bytes: Uint8Array;
      if (parts.length === 1) bytes = parts[0];
      else {
        bytes = new Uint8Array(pending);
        let p = 0;
        for (const part of parts) {
          bytes.set(part, p);
          p += part.length;
        }
      }
      try {
        const object = parseRecord(decodeLine(bytes, count === 0));
        if (sampled < 200) {
          sampled++;
          for (const [key, value] of Object.entries(object)) {
            if (!(key in layouts) && Object.keys(layouts).length >= 512)
              continue;
            const text = typeof value === "string" ? value : jsonText(value);
            const height = Math.min(
              480,
              Math.max(44, Math.ceil(text.length / 70) * 24 + 16),
            );
            const prev = layouts[key];
            layouts[key] = {
              width:
                text.length > 180 ||
                (value !== null && typeof value === "object") ||
                prev?.width === "full"
                  ? "full"
                  : "half",
              height: Math.max(height, prev?.height ?? 0),
            };
          }
        }
      } catch {
        flags = 1;
        issues++;
      }
    }
    const pos = entries * ENTRY_SIZE;
    view.setFloat64(pos, start, true);
    view.setFloat64(pos + 8, length, true);
    view.setUint32(pos + 16, flags, true);
    entries++;
    count++;
    if (entries === 8192) flush();
    start = end;
    pending = 0;
    parts = [];
  };
  for (let offset = 0; offset < file.size; offset += CHUNK) {
    const bytes = new Uint8Array(
      await file.slice(offset, offset + CHUNK).arrayBuffer(),
    );
    hash.update(bytes);
    let from = 0;
    for (let i = 0; i < bytes.length; i++)
      if (bytes[i] === 10) {
        const part = bytes.subarray(from, i + 1);
        pending += part.length;
        if (pending <= MAX_ROW) parts.push(part);
        else parts = [];
        finish(offset + i + 1);
        from = i + 1;
      }
    if (from < bytes.length) {
      const part = bytes.subarray(from);
      pending += part.length;
      if (pending <= MAX_ROW) parts.push(part);
      else parts = [];
    }
    flush();
    await update(
      Math.min(offset + bytes.length, file.size),
      count,
      issues,
      oversized,
      layouts,
    );
  }
  if (start < file.size) finish(file.size);
  flush();
  index.flush();
  await update(file.size, count, issues, oversized, layouts);
  return { hash: hash.digest(), count, issues, oversized, layouts };
}

/** 元ファイルのハッシュを固定サイズの読み取りで確認する。 */
export async function hashFile(
  file: File,
  update: (bytes: number) => Promise<void>,
): Promise<string> {
  const hash = await createSHA256();
  hash.init();
  for (let offset = 0; offset < file.size; offset += CHUNK) {
    hash.update(
      new Uint8Array(await file.slice(offset, offset + CHUNK).arrayBuffer()),
    );
    await update(Math.min(file.size, offset + CHUNK));
  }
  return hash.digest();
}

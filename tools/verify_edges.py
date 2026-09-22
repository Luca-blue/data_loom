"""実画面で分割・境界データ・失敗時の編集保全を検証する。"""
import json
import os
import re
import time
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

from generate_fixtures import generate

ROOT = Path(__file__).resolve().parents[1]


def verify(url: str = "http://127.0.0.1:8765") -> None:
    """表示中のブラウザと実 OPFS 出力で境界条件を確認する。

    Args:
        url: 起動済み Data Loom の URL。
    """
    output = ROOT / "artifacts" / f"edges-{time.time_ns()}"
    output.mkdir(parents=True)
    fixtures = output / "fixtures"
    generate(fixtures)
    report = {"headless": False, "output_pickers": "replaced with real OPFS handles; native dialogs tested separately", "scenarios": [], "fault_injection": ["IndexedDB patches.put の QuotaExceededError"]}
    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(str(output / "profile"), headless=False, viewport={"width": 1440, "height": 1000}, args=["--ozone-platform=x11"], env={**os.environ, "GDK_BACKEND": "x11", "GTK_USE_PORTAL": "0"})
        # OS フォルダ選択だけを置換し、実際の OPFS ハンドルとストリームを使う。
        context.add_init_script("""window.showDirectoryPicker = async () => {
            const root = await navigator.storage.getDirectory();
            return root.getDirectoryHandle('verification-' + Date.now(), {create:true})
                .then(handle => {window.verificationDirectory = handle; return handle;});
        };
        window.showSaveFilePicker = async () => {
            const root = await navigator.storage.getDirectory();
            const handle = await root.getFileHandle('verification-' + Date.now() + '.jsonl', {create:true});
            window.verificationFile = handle;
            return handle;
        };""")
        page = context.pages[0]
        page.set_default_timeout(15000)
        context.tracing.start(screenshots=True, snapshots=True)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))

        def open_files(*paths: Path) -> None:
            page.get_by_label("JSONL ファイル", exact=True).set_input_files([str(path) for path in paths])
            page.get_by_role("button", name="この順序で開く", exact=True).click()
            expect(page.get_by_role("button", name="書き出す", exact=True)).to_be_enabled(timeout=60000)

        def export(mode: str, value: int, name: str, invalid: str = "stop") -> Path:
            destination = output / name
            if mode != "single":
                destination.mkdir()
            page.get_by_role("button", name="書き出す", exact=True).click()
            page.get_by_label("分割方法", exact=True).select_option(mode)
            if mode != "single":
                page.get_by_label({"rows": "1ファイルの行数", "files": "ファイル数", "bytes": "目標容量（バイト）"}[mode], exact=True).fill(str(value))
            page.get_by_label("不正な行の扱い", exact=True).select_option(invalid)
            page.get_by_role("button", name="保存先を選んで書き出す", exact=True).click()
            expect(page.get_by_role("dialog")).to_have_count(0, timeout=20000)
            if mode != "single":
                exported = page.evaluate("""async () => {
                    const result = [];
                    for await (const [name, handle] of window.verificationDirectory.entries()) {
                        result.push([name, Array.from(new Uint8Array(await (await handle.getFile()).arrayBuffer()))]);
                    }
                    return result;
                }""")
                for filename, contents in exported:
                    (destination / filename).write_bytes(bytes(contents))
            else:
                contents = page.evaluate("async () => Array.from(new Uint8Array(await (await window.verificationFile.getFile()).arrayBuffer()))")
                destination.write_bytes(bytes(contents))
            return destination

        try:
            page.goto(url)
            expect(page).to_have_title("Data Loom — JSONL workspace")
            page.wait_for_timeout(700)
            open_files(fixtures / "sample.jsonl", fixtures / "extra.jsonl")
            for mode, value in [("rows", 2), ("files", 3), ("bytes", 600)]:
                folder = export(mode, value, mode)
                files = sorted(folder.glob("*.jsonl"))
                records = [json.loads(line) for path in files for line in path.read_text(encoding="utf-8-sig").splitlines()]
                assert [row["id"] for row in records] == [900719925474099312345, 2, 3, 4]
                counts = [len(path.read_text(encoding="utf-8-sig").splitlines()) for path in files]
                if mode == "rows":
                    assert counts == [2, 2], counts
                if mode == "files":
                    assert counts == [2, 1, 1], counts
                if mode == "bytes":
                    assert all(path.stat().st_size <= value or count == 1 for path, count in zip(files, counts))
                report["scenarios"].append(f"opfs-split-{mode}")
            page.get_by_role("button", name="行を複製", exact=True).click()
            expect(page.get_by_role("button", name="行 5", exact=True)).to_be_visible()
            page.get_by_role("button", name="行を削除", exact=True).click()
            expect(page.get_by_text("この行は削除されています", exact=True)).to_be_visible()
            page.get_by_role("button", name="元に戻す", exact=True).click()
            expect(page.get_by_label("id", exact=True)).to_have_value("900719925474099312345")
            report["scenarios"].append("duplicate-delete-undo")
            page.get_by_label("score", exact=True).fill("invalid number")
            page.get_by_role("button", name="変更を確定", exact=True).click()
            expect(page.get_by_label("score", exact=True)).to_have_attribute("aria-invalid", "true")
            page.get_by_role("button", name="取り消す", exact=True).click()
            page.get_by_role("button", name="KEY 操作", exact=True).click()
            page.get_by_label("KEY 名", exact=True).fill("id")
            page.get_by_role("button", name="変更を確認", exact=True).click()
            expect(page.get_by_role("dialog").get_by_role("alert")).to_contain_text("既に存在")
            page.get_by_role("button", name="閉じる", exact=True).click()
            report["scenarios"].append("invalid-edit-and-key-conflict")
            worker = page.workers[0]
            worker.evaluate("""() => {globalThis.originalPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function(...args) {if(this.name === 'patches') throw new DOMException('injected quota', 'QuotaExceededError'); return globalThis.originalPut.apply(this,args);};}""")
            page.get_by_label("response", exact=True).fill("容量不足でも未確定の入力は保持")
            page.get_by_role("button", name="変更を確定", exact=True).click()
            expect(page.get_by_role("alert")).to_contain_text("空き容量")
            expect(page.get_by_label("response", exact=True)).to_have_value("容量不足でも未確定の入力は保持")
            expect(page.get_by_role("button", name="変更を確定", exact=True)).to_be_enabled()
            worker.evaluate("() => {IDBObjectStore.prototype.put = globalThis.originalPut;}")
            page.get_by_role("button", name="変更を確定", exact=True).click()
            expect(page.get_by_role("button", name="変更を確定", exact=True)).to_be_disabled()
            report["scenarios"].append("injected-quota-keeps-edit-and-retry")
            second = context.new_page()
            second.goto(url)
            second.get_by_role("button", name="保存した作業", exact=True).click()
            second.get_by_role("button", name="再開", exact=True).first.click()
            second.get_by_label("JSONL ファイル", exact=True).set_input_files([str(fixtures / "sample.jsonl"), str(fixtures / "extra.jsonl")])
            second.get_by_role("button", name="照合して復元", exact=True).click()
            expect(second.get_by_role("alert").first).to_contain_text("別のタブ")
            second.close()
            page.bring_to_front()
            report["scenarios"].append("cross-tab-lock")
            open_files(fixtures / "invalid.jsonl")
            page.get_by_role("button", name=re.compile("^検証")).click()
            expect(page.get_by_role("button", name="行 6", exact=True)).to_be_visible()
            expect(page.get_by_role("button", name="行 1", exact=True)).to_have_count(0)
            page.get_by_role("button", name="抽出を解除", exact=True).click()
            kept = export("single", 1, "invalid-kept.jsonl", "keep")
            assert kept.read_bytes() == (fixtures / "invalid.jsonl").read_bytes()
            skipped = export("single", 1, "invalid-skipped.jsonl", "skip")
            assert skipped.read_bytes() == b'{"id":1}\n'
            report["scenarios"].append("invalid-json-utf8-duplicate-diagnostics-and-export")
            open_files(fixtures / "oversized.jsonl")
            expect(page.get_by_text("16 MiB を超えるため編集・検索は対象外です。元データは保持します", exact=True)).to_be_visible()
            oversized = export("single", 1, "oversized-copy.jsonl")
            assert oversized.read_bytes() == (fixtures / "oversized.jsonl").read_bytes()
            report["scenarios"].append("oversized-preserved-without-parsing")
            # 最新作業の元ファイルを変更し、再開時の照合で拒否されることを確認。
            with (fixtures / "oversized.jsonl").open("ab") as stream:
                stream.write(b'{"changed":true}\n')
            page.reload()
            page.get_by_role("button", name="保存した作業", exact=True).click()
            page.get_by_role("button", name="再開", exact=True).first.click()
            page.get_by_label("JSONL ファイル", exact=True).set_input_files(str(fixtures / "oversized.jsonl"))
            page.get_by_role("button", name="照合して復元", exact=True).click()
            expect(page.get_by_role("alert").first).to_contain_text("変更されています")
            report["scenarios"].append("changed-source-rejected")
            assert not errors, errors
            report["status"] = "passed"
            page.screenshot(path=str(output / "final.png"))
        except Exception as error:
            report["status"] = "failed"
            report["error"] = str(error)
            page.screenshot(path=str(output / "failure.png"))
            raise
        finally:
            report["page_errors"] = errors
            (output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
            context.tracing.stop(path=str(output / "trace.zip"))
            context.close()


if __name__ == "__main__":
    verify()

"""Playwright の実画面で JSONL の編集・保存・復元を検証する。"""
import argparse
import json
import os
import time
from pathlib import Path

from playwright.sync_api import Page, expect, sync_playwright

from generate_fixtures import generate
from native_dialog import NativeDialog
from browser_metrics import BrowserMetrics


ROOT = Path(__file__).resolve().parents[1]


def verify(url: str, output: Path, native: bool = False, large: Path | None = None) -> None:
    """表示中の Chromium を操作し、結果と画面を保存する。

    Args:
        url: 起動済みアプリケーションの URL。
        output: スクリーンショット等の保存先。
        native: X11 で実際のファイル保存ダイアログも操作するかどうか。
        large: 大容量検証に使用する JSONL。未指定時は通常シナリオ。
    """
    output.mkdir(parents=True, exist_ok=True)
    fixtures = ROOT / "artifacts" / "fixtures"
    generate(fixtures)
    errors: list[str] = []
    requests: list[dict] = []
    report: dict = {"headless": False, "native_dialogs": native, "scenarios": []}
    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            str(output / "browser-profile"), headless=False,
            viewport={"width": 1440, "height": 1000},
            args=["--window-size=1440,1000", "--ozone-platform=x11"],
            env={**os.environ, "GDK_BACKEND": "x11", "GTK_USE_PORTAL": "0"},
        )
        page = context.pages[0]
        page.set_default_timeout(15000)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("request", lambda request: requests.append({"url": request.url, "method": request.method, "has_body": bool(request.post_data)}))
        context.tracing.start(screenshots=True, snapshots=True, sources=True)
        native_dialog = NativeDialog() if native else None
        try:
            page.goto(url)
            expect(page).to_have_title("Data Loom — JSONL workspace")
            page.bring_to_front()
            page.wait_for_timeout(700)
            page.screenshot(path=str(output / "welcome.png"), full_page=True)
            if large:
                started = time.monotonic()
                page.get_by_label("JSONL ファイル", exact=True).set_input_files(str(large.resolve()))
                page.get_by_role("button", name="この順序で開く", exact=True).click()
                metrics = BrowserMetrics(context, page)
                samples = []
                deadline = time.monotonic() + 1800
                while not page.get_by_role("button", name="書き出す", exact=True).is_enabled():
                    if time.monotonic() > deadline:
                        raise TimeoutError("索引作成が30分以内に完了しませんでした")
                    if page.get_by_role("alert").count():
                        raise AssertionError(page.get_by_role("alert").first.inner_text())
                    samples.append(metrics.sample())
                    page.wait_for_timeout(500)
                samples.append(metrics.sample())
                report["memory_samples"] = samples
                report["peak_combined_used_bytes"] = max(item["combined_used_bytes"] for item in samples)
                report["index_seconds"] = time.monotonic() - started
                report["bytes"] = large.stat().st_size
                report["main_heap"] = page.evaluate("performance.memory ? performance.memory.usedJSHeapSize : null")
                page.screenshot(path=str(output / "large.png"), full_page=True)
                report["scenarios"].append("large-file-index-and-display")
                started = time.monotonic()
                page.get_by_label("表示位置", exact=True).fill("100000")
                page.get_by_label("表示位置", exact=True).press("Enter")
                page.get_by_role("button", name="行 100000", exact=True).click()
                expect(page.get_by_label("id", exact=True)).to_have_value("900719925474099312345")
                report["random_access_seconds"] = time.monotonic() - started
                page.get_by_label("全文に含まれる文字列", exact=True).fill("不存在の検索語")
                started = time.monotonic()
                page.get_by_role("button", name="検索", exact=True).click()
                while not page.get_by_role("button", name="書き出す", exact=True).is_enabled():
                    if time.monotonic() - started > 1800:
                        raise TimeoutError("検索が30分以内に完了しませんでした")
                    samples.append(metrics.sample())
                    page.wait_for_timeout(500)
                report["search_seconds"] = time.monotonic() - started
                report["peak_combined_used_bytes"] = max(item["combined_used_bytes"] for item in samples)
                expect(page.get_by_text("表示する行がありません", exact=True)).to_be_visible()
                report["scenarios"].append("large-file-random-access-and-full-scan")
            else:
                page.get_by_label("JSONL ファイル", exact=True).set_input_files([str(fixtures / "sample.jsonl"), str(fixtures / "extra.jsonl")])
                page.get_by_role("button", name="この順序で開く", exact=True).click()
                expect(page.get_by_role("button", name="書き出す", exact=True)).to_be_enabled()
                expect(page.get_by_label("id", exact=True)).to_have_value("900719925474099312345")
                expect(page.get_by_role("button", name="行 4", exact=True)).to_be_visible()
                page.get_by_label("response", exact=True).fill("編集した日本語のテキスト\n2行目も保持します。")
                page.get_by_role("button", name="変更を確定", exact=True).click()
                expect(page.get_by_role("button", name="変更を確定", exact=True)).to_be_disabled()
                page.get_by_role("button", name="元に戻す", exact=True).click()
                expect(page.get_by_label("response", exact=True)).to_have_value(__import__("re").compile("一行ずつ確認"))
                page.get_by_role("button", name="やり直す", exact=True).click()
                expect(page.get_by_label("response", exact=True)).to_have_value("編集した日本語のテキスト\n2行目も保持します。")
                page.get_by_label("response の枠サイズ", exact=True).click()
                page.get_by_label("response の高さ", exact=True).fill("360")
                page.get_by_label("response の高さ", exact=True).press("Tab")
                page.get_by_label("response の枠サイズ", exact=True).click()
                page.screenshot(path=str(output / "editor.png"), full_page=True)
                report["scenarios"].append("merge-edit-precision-undo-redo-resize")
                page.get_by_label("全文に含まれる文字列", exact=True).fill("検索対象")
                page.get_by_label("全文に含まれる文字列", exact=True).press("Enter")
                expect(page.get_by_role("button", name="行 2", exact=True)).to_be_visible()
                expect(page.get_by_role("button", name="行 1", exact=True)).to_have_count(0)
                page.get_by_role("button", name="抽出を解除", exact=True).click()
                page.get_by_label("全文に含まれる文字列", exact=True).fill("")
                page.get_by_role("button", name="条件で抽出", exact=True).click()
                candidates = page.locator("#search-key-candidates option")
                options = candidates.evaluate_all("options => options.map(option => option.value)")
                assert "title" in options and "quality" in options
                page.get_by_label("条件 1 の KEY", exact=True).fill("title")
                expect(page.get_by_label("条件 1 の KEY", exact=True)).to_have_attribute("list", "search-key-candidates")
                page.get_by_label("値", exact=True).fill("検索対象")
                page.screenshot(path=str(output / "search-key-options.png"))
                page.get_by_role("button", name="抽出する", exact=True).click()
                expect(page.get_by_role("button", name="行 2", exact=True)).to_be_visible()
                expect(page.get_by_role("button", name="行 1", exact=True)).to_have_count(0)
                page.get_by_role("button", name="抽出を解除", exact=True).click()
                page.get_by_role("button", name="条件で抽出", exact=True).click()
                page.get_by_label("条件 1 の KEY", exact=True).fill("未登録のKEY")
                expect(page.get_by_label("条件 1 の KEY", exact=True)).to_have_value("未登録のKEY")
                page.get_by_role("button", name="閉じる", exact=True).click()
                report["scenarios"].append("search-key-dropdown-and-manual-input")
                page.get_by_role("button", name="KEY 操作", exact=True).click()
                page.get_by_label("対象", exact=True).select_option("all")
                page.get_by_label("KEY 名", exact=True).fill("split")
                page.get_by_label("値（JSON）", exact=True).fill('"train"')
                page.get_by_role("button", name="変更を確認", exact=True).click()
                expect(page.get_by_role("button", name="変更を適用", exact=True)).to_be_enabled()
                page.get_by_role("button", name="変更を適用", exact=True).click()
                expect(page.get_by_label("split", exact=True)).to_have_value("train")
                page.get_by_role("button", name="条件で抽出", exact=True).click()
                assert "split" in page.locator("#search-key-candidates option").evaluate_all("options => options.map(option => option.value)")
                page.get_by_role("button", name="閉じる", exact=True).click()
                report["scenarios"].append("search-and-bulk-key-add")
                if native_dialog:
                    export_path = (output / f"export-{time.time_ns()}.jsonl").resolve()
                    page.get_by_role("button", name="書き出す", exact=True).click()
                    page.get_by_role("button", name="保存先を選んで書き出す", exact=True).click()
                    page.wait_for_timeout(1200)
                    native_dialog.focus_dialog()
                    native_dialog.screenshot(str(output / "native-before.png"))
                    native_dialog.choose(str(export_path))
                    page.wait_for_timeout(1000)
                    native_dialog.focus_dialog()
                    native_dialog.screenshot(str(output / "native-after.png"))
                    native_dialog.save()
                    expect(page.get_by_role("dialog")).to_have_count(0, timeout=30000)
                    actual = [json.loads(line) for line in export_path.read_text(encoding="utf-8-sig").splitlines()]
                    assert len(actual) == 4 and actual[0]["id"] == 900719925474099312345
                    assert actual[0]["response"] == "編集した日本語のテキスト\n2行目も保持します。"
                    assert all(row["split"] == "train" for row in actual)
                    report["scenarios"].append("native-save-and-export-content")
                for width in [320, 375, 414, 768, 1440]:
                    page.set_viewport_size({"width": width, "height": 1000})
                    page.screenshot(path=str(output / f"editor-{width}.png"), full_page=True)
                    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"horizontal overflow at {width}"
                    if width in [320, 768]:
                        page.get_by_role("button", name="条件で抽出", exact=True).click()
                        assert page.get_by_role("dialog").evaluate("el => el.scrollWidth <= el.clientWidth"), f"search dialog overflow at {width}"
                        page.screenshot(path=str(output / f"search-keys-{width}.png"))
                        page.get_by_role("button", name="閉じる", exact=True).click()
                page.set_viewport_size({"width": 1440, "height": 1000})
                page.reload()
                page.get_by_role("button", name="保存した作業", exact=True).click()
                page.get_by_role("button", name="再開", exact=True).first.click()
                page.get_by_label("JSONL ファイル", exact=True).set_input_files([str(fixtures / "sample.jsonl"), str(fixtures / "extra.jsonl")])
                page.get_by_role("button", name="照合して復元", exact=True).click()
                expect(page.get_by_label("response", exact=True)).to_have_value("編集した日本語のテキスト\n2行目も保持します。")
                expect(page.get_by_label("split", exact=True)).to_have_value("train")
                assert page.get_by_label("response", exact=True).evaluate("el => el.offsetHeight") == 360
                report["scenarios"].append("responsive-and-session-restore")
            assert not errors, errors
            assert all(request["method"] == "GET" and not request["has_body"] for request in requests), requests
            assert all(request["url"].startswith(url) or request["url"].startswith("blob:") for request in requests), requests
            report["status"] = "passed"
        except Exception as error:
            report["status"] = "failed"
            report["error"] = str(error)
            page.screenshot(path=str(output / "failure.png"), full_page=True)
            raise
        finally:
            report["page_errors"] = errors
            report["requests"] = requests
            (output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
            context.tracing.stop(path=str(output / "trace.zip"))
            if native_dialog:
                native_dialog.close()
            context.close()


def main() -> None:
    """引数に従って必ず実画面で検証する。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8765")
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts" / f"ui-{time.time_ns()}")
    parser.add_argument("--native-dialogs", action="store_true")
    parser.add_argument("--large", type=Path)
    args = parser.parse_args()
    verify(args.url, args.output, args.native_dialogs, args.large)


if __name__ == "__main__":
    main()

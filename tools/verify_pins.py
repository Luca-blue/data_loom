"""実画面で表・詳細・全幅のピン留めと復元を確認する。"""
import json
import time
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def verify() -> None:
    """1255px の画面でピン留め順序と永続化、狭い画面を検証する。"""
    output = ROOT / "artifacts" / f"pins-{time.time_ns()}"
    output.mkdir(parents=True)
    fixture = output / "pins.jsonl"
    fixture.write_text(json.dumps({"id": 1, "category": "train", "enabled": True, "missing": None, "tags": ["train"], "metadata": {"source": "sample"}, "score": 0.9, "base_actual_tokens_with_long_key": 4123, "prompt": "質問です。" * 80, "response": "長い回答です。" * 80, "context": "参考資料です。" * 80}, ensure_ascii=False) + "\n", encoding="utf-8")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, args=["--ozone-platform=x11"])
        page = browser.new_page(viewport={"width": 1255, "height": 900})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto("http://127.0.0.1:8765/")
        page.get_by_label("JSONL ファイル", exact=True).set_input_files(str(fixture))
        page.get_by_role("button", name="この順序で開く", exact=True).click()
        expect(page.get_by_role("button", name="書き出す", exact=True)).to_be_enabled()
        page.get_by_role("button", name="score をピン留め", exact=True).click()
        expect(page.locator(".metadata-table .field").first).to_have_attribute("data-key", "score")
        page.get_by_role("button", name="response をピン留め", exact=True).click()
        expect(page.locator(".detail-fields .field").first).to_have_attribute("data-key", "response")
        page.get_by_label("context の枠サイズ", exact=True).click()
        page.get_by_label("context の配置", exact=True).select_option("full")
        expect(page.locator(".record-layout > .full-fields").last.locator(".field")).to_have_attribute("data-key", "context")
        page.get_by_role("button", name="context をピン留め", exact=True).click()
        expect(page.locator(".record-layout > div").first).to_have_class("full-fields pinned-full-fields")
        expect(page.locator(".pinned-full-fields .field")).to_have_attribute("data-key", "context")
        page.get_by_label("context の枠サイズ", exact=True).click()
        page.get_by_label("context の高さ", exact=True).fill("96")
        page.get_by_label("context の高さ", exact=True).press("Enter")
        page.locator(".detail-scroll").evaluate("el => el.scrollTop = 0")
        page.screenshot(path=str(output / "pinned.png"))
        type_select = page.get_by_label("id の型", exact=True)
        assert type_select.evaluate("el => getComputedStyle(el).color") == "rgba(0, 0, 0, 0)"
        assert page.locator(".type-label").count() == 0
        expect(page.locator('[data-key="id"] .type-picker-icon svg').first).to_have_class(__import__("re").compile("lucide-hash"))
        type_select.select_option("string")
        expect(page.locator('[data-key="id"] .type-picker-icon svg').first).to_have_class(__import__("re").compile("lucide-type"))
        type_select.select_option("number")
        page.get_by_role("button", name="変更を確定", exact=True).click()
        expect(page.get_by_role("button", name="変更を確定", exact=True)).to_be_disabled()
        type_select.focus()
        type_select.press("ArrowDown")
        type_select.press("Escape")
        page.reload()
        page.get_by_role("button", name="保存した作業", exact=True).click()
        page.get_by_role("button", name="再開", exact=True).first.click()
        page.get_by_label("JSONL ファイル", exact=True).set_input_files(str(fixture))
        page.get_by_role("button", name="照合して復元", exact=True).click()
        expect(page.locator(".pinned-full-fields .field")).to_have_attribute("data-key", "context")
        expect(page.locator(".metadata-table .field").first).to_have_attribute("data-key", "score")
        expect(page.locator(".detail-fields .field").first).to_have_attribute("data-key", "response")
        page.get_by_role("button", name="context をピン留め解除", exact=True).click()
        expect(page.locator(".pinned-full-fields")).to_have_count(0)
        expect(page.locator(".record-layout > div").last.locator(".field")).to_have_attribute("data-key", "context")
        page.get_by_role("button", name="score をピン留め解除", exact=True).click()
        expect(page.locator(".metadata-table .field").first).to_have_attribute("data-key", "id")
        assert page.locator(".metadata-table").evaluate("el => getComputedStyle(el).borderRadius") == "0px"
        page.locator(".detail-scroll").evaluate("el => el.scrollTop = 0")
        page.screenshot(path=str(output / "table.png"))
        for width in [375, 768, 1255, 1600, 1920]:
            page.set_viewport_size({"width": width, "height": 900})
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            offsets = page.locator(".compact-field").evaluate_all("""rows => rows.map(row => {
                const r = row.getBoundingClientRect();
                const label = row.querySelector('.field-header > label').getBoundingClientRect();
                return Math.abs((label.top + label.bottom) / 2 - (r.top + r.bottom) / 2);
            })""")
            assert all(offset < 1 for offset in offsets), (width, offsets)
            page.screenshot(path=str(output / f"table-{width}.png"))
        assert not errors, errors
        (output / "report.json").write_text(json.dumps({"status": "passed", "headless": False, "scenarios": ["table-pin", "detail-pin", "full-pin-above-columns", "restore-pins", "unpin-original-order", "square-frames", "type-icons-and-type-change", "responsive", "key-vertical-center-375-to-1920"], "page_errors": errors}, indent=2), encoding="utf-8")
        browser.close()


if __name__ == "__main__":
    verify()

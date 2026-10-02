"""表示中の Chromium で短い値のサイズと設定パネルを検証する。"""
import json
import re
import time
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def verify() -> None:
    """実画面で自動サイズ・手動サイズ・設定終了を確認する。"""
    output = ROOT / "artifacts" / f"field-layout-{time.time_ns()}"
    output.mkdir(parents=True)
    fixture = output / "fields.jsonl"
    fixture.write_text(
        json.dumps({"base_actual_tokens": None, "base_id": "short", "category": "train", "enabled": True, "score": 0.9, "body": "長文" * 400}) + "\n"
        + json.dumps({"base_actual_tokens": 4123, "base_id": "short", "body": "短文"}) + "\n",
        encoding="utf-8",
    )
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, args=["--ozone-platform=x11"])
        page = browser.new_page(viewport={"width": 1255, "height": 742})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto("http://127.0.0.1:8765/")
        page.get_by_label("JSONL ファイル", exact=True).set_input_files(str(fixture))
        page.get_by_role("button", name="この順序で開く", exact=True).click()
        expect(page.get_by_role("button", name="書き出す", exact=True)).to_be_enabled()
        expect(page.locator('[data-key="base_actual_tokens"]')).not_to_have_class(re.compile(r"\bwide\b"))
        page.screenshot(path=str(output / "split.png"))
        assert page.locator(".metadata-table").bounding_box()["x"] < page.locator(".detail-fields").bounding_box()["x"]
        page.get_by_role("button", name="行 2", exact=True).click()
        field = page.locator('[data-key="base_actual_tokens"]')
        expect(page.get_by_label("base_actual_tokens", exact=True)).to_have_value("4123")
        assert page.get_by_label("base_actual_tokens", exact=True).evaluate("el => el.offsetHeight") == 44
        assert "compact-field" in field.get_attribute("class")
        panel = field.locator("details")
        toggle = page.get_by_label("base_actual_tokens の枠サイズ", exact=True)
        toggle.click()
        page.get_by_role("group", name="base_actual_tokens の配置", exact=True).get_by_role("button", name="全幅", exact=True).click()
        expect(panel).not_to_have_attribute("open", "")
        expect(field).to_have_class(re.compile(r"\bwide\b"))
        toggle.click()
        page.get_by_label("base_actual_tokens の高さ", exact=True).fill("160")
        page.get_by_label("base_actual_tokens の高さ", exact=True).press("Enter")
        expect(panel).not_to_have_attribute("open", "")
        assert page.get_by_label("base_actual_tokens", exact=True).evaluate("el => el.offsetHeight") == 160
        page.get_by_role("button", name="行 1", exact=True).click()
        page.get_by_role("button", name="行 2", exact=True).click()
        expect(field).to_have_class(re.compile(r"\bwide\b"))
        toggle.click()
        page.keyboard.press("Escape")
        expect(panel).not_to_have_attribute("open", "")
        toggle.click()
        page.get_by_role("heading").first.click()
        expect(panel).not_to_have_attribute("open", "")
        toggle.click()
        field.get_by_role("button", name="自動サイズに戻す").click()
        expect(panel).not_to_have_attribute("open", "")
        expect(field).not_to_have_class(re.compile(r"\bwide\b"))
        assert page.get_by_label("base_actual_tokens", exact=True).evaluate("el => el.offsetHeight") == 44
        page.screenshot(path=str(output / "compact.png"))
        page.get_by_role("button", name="行 1", exact=True).click()
        for width in [375, 768, 1255]:
            page.set_viewport_size({"width": width, "height": 742})
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            page.screenshot(path=str(output / f"layout-{width}.png"))

        assert not errors, errors
        (output / "report.json").write_text(json.dumps({"status": "passed", "headless": False, "viewport": [1255,742], "scenarios": ["null-then-number-compact", "manual-size-persists-across-rows", "width-height-confirm-close", "escape-outside-close", "reset-auto-size"], "page_errors": errors}, indent=2), encoding="utf-8")
        browser.close()


if __name__ == "__main__":
    verify()

"""表示中の Chromium で表の密度・行ヘッダー・枠サイズ操作・行一覧の表示を検証する。"""
import json
import time
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def verify() -> None:
    """実画面で使用感に関わる表示と、キーボード・マウスによるサイズ変更を確認する。"""
    output = ROOT / "artifacts" / f"usability-{time.time_ns()}"
    output.mkdir(parents=True)
    fixture = output / "usability.jsonl"
    rows = [
        {"id": f"ja-S-06-direct-{n:04d}", "lang": "ja", "score": n, "luna": {"model": "openai/gpt-6-luna", "label": "positive", "reason": "長い説明。" * 10}, "body": "本文" * 200}
        for n in range(1, 4)
    ]
    fixture.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, args=["--ozone-platform=x11"])
        page = browser.new_page(viewport={"width": 1600, "height": 900})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto("http://127.0.0.1:8765/")
        page.evaluate("localStorage.removeItem('data-loom:font-size')")
        page.get_by_label("JSONL ファイル", exact=True).set_input_files(str(fixture))
        page.get_by_role("button", name="この順序で開く", exact=True).click()
        expect(page.get_by_role("button", name="書き出す", exact=True)).to_be_enabled()

        # 行一覧：値をタイトルにし、ピン留めした KEY を先頭に出す。
        first = page.get_by_role("button", name="行 1", exact=True)
        expect(first.locator(".row-title-text")).to_have_text("ja-S-06-direct-0001")
        expect(first.locator(".row-preview")).to_contain_text("lang: ja · score: 1")
        page.locator('[data-key="score"]').hover()
        page.get_by_label("score をピン留め", exact=True).click()
        expect(first.locator(".row-title-text")).to_have_text("1")
        expect(first.locator(".row-preview")).to_contain_text("id: ja-S-06-direct-0001")
        page.get_by_label("score をピン留め解除", exact=True).click()
        expect(first.locator(".row-title-text")).to_have_text("ja-S-06-direct-0001")

        # 行ヘッダー：経路・状態・確定操作を1段にまとめ、未編集の確定ボタンは目立たせない。
        header = page.locator(".detail-header")
        status = header.locator(".record-status")
        save = header.get_by_role("button", name="変更を確定", exact=True)
        expect(status).to_have_text("5 KEY · 変更なし")
        expect(save).to_be_disabled()
        accent = page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--color-accent')")
        assert save.evaluate("el => getComputedStyle(el).backgroundColor") != page.evaluate(
            "color => { const el = document.createElement('i'); el.style.backgroundColor = color; document.body.append(el); const value = getComputedStyle(el).backgroundColor; el.remove(); return value; }",
            accent,
        )
        assert page.locator(".record-layout").bounding_box()["y"] - header.bounding_box()["y"] - header.bounding_box()["height"] <= 24
        page.get_by_label("lang", exact=True).fill("en")
        expect(status).to_have_text("5 KEY · 未確定の変更あり")
        header.get_by_role("button", name="取り消す", exact=True).click()
        expect(status).to_have_text("5 KEY · 変更なし")

        # 表：全幅でも KEY の列は320px以下で、1行は50px台。
        page.get_by_role("button", name="luna を開く", exact=True).click()
        path = page.get_by_role("navigation", name="階層")
        expect(path).to_have_text("ROW 001luna")
        assert header.locator(".record-path").count() == 1
        model = page.locator('[data-key="model"]')
        value = page.get_by_label("model", exact=True)
        assert model.bounding_box()["width"] > 900
        assert value.bounding_box()["x"] - model.bounding_box()["x"] <= 345
        assert 50 <= model.bounding_box()["height"] < 60, model.bounding_box()
        assert value.evaluate("el => el.scrollHeight <= el.clientHeight")
        page.screenshot(path=str(output / "table-1600.png"))

        # ピンと枠サイズの操作は、行に触れたときだけ表示する。
        pin = page.get_by_label("label をピン留め", exact=True)
        page.locator(".detail-header").hover()
        assert pin.evaluate("el => getComputedStyle(el).opacity") == "0"
        page.locator('[data-key="label"]').hover()
        assert pin.evaluate("el => getComputedStyle(el).opacity") == "1"

        # Esc で上の階層へ戻る。
        page.keyboard.press("Escape")
        expect(path).to_have_count(0)

        # 高さの入力：300 → 500 の途中で 3500 になっても 1200 に丸めない。
        body = page.get_by_label("body", exact=True)
        toggle = page.get_by_label("body の枠サイズ", exact=True)
        height = page.get_by_label("body の高さ", exact=True)
        page.locator('[data-key="body"]').hover()
        toggle.click()
        height.fill("300")
        assert body.evaluate("el => el.offsetHeight") == 300
        height.press("Home")
        height.press("ArrowRight")
        page.keyboard.type("5")
        expect(height).to_have_value("3500")
        assert body.evaluate("el => el.offsetHeight") == 300
        height.press("Home")
        page.keyboard.press("Delete")
        expect(height).to_have_value("500")
        assert body.evaluate("el => el.offsetHeight") == 500
        height.fill("3500")
        height.press("Enter")
        assert body.evaluate("el => el.offsetHeight") == 1200

        # 配置は3つのボタンで、押すだけで切り替わる。
        toggle.click()
        placement = page.get_by_role("group", name="body の配置", exact=True)
        expect(placement.get_by_role("button", name="右の詳細", exact=True)).to_have_attribute("aria-pressed", "true")
        page.screenshot(path=str(output / "placement.png"))
        placement.get_by_role("button", name="全幅", exact=True).click()
        expect(page.locator('.full-fields [data-key="body"]')).to_have_count(1)
        page.locator('[data-key="body"]').hover()
        toggle.click()
        expect(placement.get_by_role("button", name="全幅", exact=True)).to_have_attribute("aria-pressed", "true")
        placement.get_by_role("button", name="右の詳細", exact=True).click()
        expect(page.locator('.detail-fields [data-key="body"]')).to_have_count(1)
        page.locator('[data-key="body"]').hover()

        # スライダーで高さを変える。
        toggle.click()
        slider = page.get_by_label("body の高さ（スライダー）", exact=True)
        slider.fill("200")
        assert body.evaluate("el => el.offsetHeight") == 200
        expect(height).to_have_value("200")
        page.keyboard.press("Escape")

        # 枠の下端をマウスでドラッグして高さを変え、ダブルクリックで自動サイズへ戻す。
        handle = page.get_by_label("body の高さをドラッグで変更", exact=True)
        box = handle.bounding_box()
        x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x, y + 60, steps=6)
        assert body.evaluate("el => el.offsetHeight") == 260
        page.mouse.up()
        assert body.evaluate("el => el.offsetHeight") == 260
        page.get_by_role("button", name="行 2", exact=True).click()
        assert body.evaluate("el => el.offsetHeight") == 260
        page.get_by_role("button", name="行 1", exact=True).click()
        row_handle = page.get_by_label("lang の高さをドラッグで変更", exact=True)
        box = row_handle.bounding_box()
        x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x, y + 40, steps=4)
        page.mouse.up()
        assert page.get_by_label("lang", exact=True).evaluate("el => el.offsetHeight") == 84
        row_handle.dblclick()
        assert page.get_by_label("lang", exact=True).evaluate("el => el.offsetHeight") == 44
        handle.dblclick()
        automatic = body.evaluate("el => el.offsetHeight")
        assert automatic not in (260, 1200), automatic
        page.screenshot(path=str(output / "resize.png"))

        # 文字の大きさ：行ヘッダーで変え、再読み込み後も保つ。
        lang = page.get_by_label("lang", exact=True)
        assert lang.evaluate("el => getComputedStyle(el).fontSize") == "14px"
        larger = page.get_by_role("button", name="文字を大きく", exact=True)
        for _ in range(4):
            larger.click()
        assert lang.evaluate("el => getComputedStyle(el).fontSize") == "18px"
        assert lang.evaluate("el => el.scrollHeight <= el.clientHeight")
        expect(page.get_by_text("処理中です")).to_have_count(0)
        page.screenshot(path=str(output / "font-18.png"))
        page.reload()
        page.get_by_role("button", name="保存した作業", exact=True).click()
        assert page.evaluate("localStorage.getItem('data-loom:font-size')") == "18"
        page.keyboard.press("Escape")
        page.evaluate("localStorage.removeItem('data-loom:font-size')")

        expect(page.get_by_text("処理中です")).to_have_count(0)
        assert not errors, errors
        (output / "report.json").write_text(
            json.dumps(
                {
                    "status": "passed",
                    "headless": False,
                    "viewport": [1600, 900],
                    "scenarios": [
                        "row-list-title-and-pinned-preview",
                        "header-path-status-actions",
                        "key-column-width-and-row-height",
                        "hover-only-field-controls",
                        "escape-goes-up",
                        "height-input-keeps-intermediate-value",
                        "height-slider",
                        "drag-and-double-click-resize",
                        "font-size-persisted",
                    ],
                    "page_errors": errors,
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        browser.close()


if __name__ == "__main__":
    verify()

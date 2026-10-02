"""表示中の Chromium でネストした値の階層移動と編集を検証する。"""
import json
import time
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def verify() -> None:
    """実画面で表からの移動・経路での復帰・入れ子の編集と保存を確認する。"""
    output = ROOT / "artifacts" / f"nested-{time.time_ns()}"
    output.mkdir(parents=True)
    fixture = output / "nested.jsonl"
    fixture.write_text(
        '{"name":"x","aaa":{"bbb":{"ccc":12345678901234567890,"ddd":"hello","eee":{}}},"items":[{"id":1},"two"]}\n'
        '{"name":"y","aaa":{"bbb":{"ccc":2,"ddd":"second"}},"items":[]}\n'
        '{"name":"z","aaa":"flat"}\n',
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

        # 最上位：ネストした値は表の行になり、件数と開くボタンを表示する。
        path = page.get_by_role("navigation", name="階層")
        expect(path).to_have_count(0)
        expect(page.locator('.metadata-table [data-key="aaa"]')).to_have_count(1)
        expect(page.get_by_role("button", name="aaa を開く", exact=True)).to_contain_text("1 KEY")
        expect(page.get_by_role("button", name="items を開く", exact=True)).to_contain_text("2 件")
        page.screenshot(path=str(output / "top.png"))

        # 表から2階層下へ移動し、末端の値を個別の欄で編集する。
        page.get_by_role("button", name="aaa を開く", exact=True).click()
        expect(path).to_have_text("ROW 001aaa")
        page.get_by_role("button", name="bbb を開く", exact=True).click()
        expect(path).to_have_text("ROW 001aaabbb")
        expect(page.get_by_label("ccc", exact=True)).to_have_value("12345678901234567890")
        expect(page.get_by_role("button", name="eee を開く", exact=True)).to_contain_text("0 KEY")
        page.screenshot(path=str(output / "nested.png"))

        # 型に合わない入力は、階層の移動と確定を止める。
        page.get_by_label("ccc", exact=True).fill("12a")
        path.get_by_role("button", name="aaa", exact=True).click()
        expect(path).to_have_text("ROW 001aaabbb")
        expect(page.locator('[data-key="ccc"] .error-text')).to_be_visible()
        page.get_by_label("ccc", exact=True).fill("12345678901234567891")
        page.get_by_label("ddd", exact=True).fill("world")

        # 未確定のまま上の階層へ戻っても入力を保持し、確定で行全体へ反映する。
        path.get_by_role("button", name="ROW 001", exact=True).click()
        expect(path).to_have_count(0)
        page.get_by_role("button", name="aaa を開く", exact=True).click()
        page.get_by_role("button", name="bbb を開く", exact=True).click()
        expect(page.get_by_label("ddd", exact=True)).to_have_value("world")
        page.get_by_role("button", name="変更を確定", exact=True).click()
        expect(page.get_by_role("button", name="変更を確定", exact=True)).to_be_disabled()
        expect(path).to_have_text("ROW 001aaabbb")
        expect(page.get_by_label("ccc", exact=True)).to_have_value("12345678901234567891")

        # 取り消すと確定済みの値へ戻り、表示中の階層は保つ。
        page.get_by_label("ddd", exact=True).fill("discard")
        page.get_by_role("button", name="取り消す", exact=True).click()
        expect(page.get_by_label("ddd", exact=True)).to_have_value("world")
        expect(path).to_have_text("ROW 001aaabbb")

        # 別の行でも同じ階層を保ち、開けない行では開ける階層まで戻る。
        page.get_by_role("button", name="行 2", exact=True).click()
        expect(path).to_have_text("ROW 002aaabbb")
        expect(page.get_by_label("ddd", exact=True)).to_have_value("second")
        page.get_by_role("button", name="行 3", exact=True).click()
        expect(path).to_have_count(0)
        expect(page.get_by_label("aaa", exact=True)).to_have_value("flat")

        # 配列は添字を KEY として表示し、要素のオブジェクトも開ける。
        page.get_by_role("button", name="行 1", exact=True).click()
        page.get_by_role("button", name="items を開く", exact=True).click()
        expect(path).to_have_text("ROW 001items")
        expect(page.get_by_label("[1]", exact=True)).to_have_value("two")
        page.get_by_role("button", name="[0] を開く", exact=True).click()
        expect(path).to_have_text("ROW 001items[0]")
        expect(page.get_by_label("id", exact=True)).to_have_value("1")
        page.get_by_label("id", exact=True).fill("7")
        page.get_by_role("button", name="変更を確定", exact=True).click()
        expect(page.get_by_role("button", name="変更を確定", exact=True)).to_be_disabled()
        expect(path).to_have_text("ROW 001items[0]")
        expect(page.get_by_label("id", exact=True)).to_have_value("7")
        path.get_by_role("button", name="items", exact=True).click()
        expect(page.get_by_role("button", name="[0] を開く", exact=True)).to_contain_text("1 KEY")
        page.screenshot(path=str(output / "array.png"))

        # 配置を「右の詳細」にすると JSON を直接編集でき、そこからも開ける。
        path.get_by_role("button", name="ROW 001", exact=True).click()
        page.get_by_label("aaa の枠サイズ", exact=True).click()
        page.get_by_role("group", name="aaa の配置", exact=True).get_by_role("button", name="右の詳細", exact=True).click()
        expect(page.locator('.detail-fields [data-key="aaa"] textarea')).to_be_visible()
        page.get_by_role("button", name="aaa を開く", exact=True).click()
        expect(path).to_have_text("ROW 001aaa")
        path.get_by_role("button", name="ROW 001", exact=True).click()
        page.get_by_label("aaa の枠サイズ", exact=True).click()
        page.locator('[data-key="aaa"]').get_by_role("button", name="自動サイズに戻す").click()
        expect(page.locator('.metadata-table [data-key="aaa"]')).to_have_count(1)

        # 抽出条件の KEY 候補に、入れ子の表示設定の KEY を混ぜない。
        page.get_by_role("button", name="aaa を開く", exact=True).click()
        page.get_by_label("bbb をピン留め", exact=True).click()
        expect(page.locator('[data-key="bbb"]')).to_have_attribute("data-pinned", "true")
        candidates = page.evaluate(
            "async () => { const db = await new Promise((resolve, reject) => { const r = indexedDB.open('data-loom-v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });"
            " const all = await new Promise((resolve) => { const r = db.transaction('workspaces').objectStore('workspaces').getAll(); r.onsuccess = () => resolve(r.result); });"
            " db.close(); return Object.keys(all[0].layouts); }"
        )
        assert "aaa\x00bbb" in candidates, candidates
        page.get_by_label("bbb をピン留め解除", exact=True).click()
        path.get_by_role("button", name="ROW 001", exact=True).click()

        for width in [375, 768, 1255]:
            page.set_viewport_size({"width": width, "height": 742})
            page.get_by_role("button", name="aaa を開く", exact=True).click()
            page.get_by_role("button", name="bbb を開く", exact=True).click()
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            page.screenshot(path=str(output / f"nested-{width}.png"))
            path.get_by_role("button", name="ROW 001", exact=True).click()

        assert not errors, errors
        (output / "report.json").write_text(
            json.dumps(
                {
                    "status": "passed",
                    "headless": False,
                    "viewport": [1255, 742],
                    "scenarios": [
                        "compound-values-in-table",
                        "open-two-levels-and-edit-leaf",
                        "invalid-input-blocks-navigation",
                        "draft-kept-across-levels",
                        "save-keeps-precision-and-path",
                        "discard-keeps-path",
                        "path-kept-or-truncated-across-rows",
                        "array-index-and-element",
                        "raw-json-placement",
                        "nested-layout-key",
                        "responsive-375-768-1255",
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

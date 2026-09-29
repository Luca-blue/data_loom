"""表示したブラウザで favicon の配信を確認する。"""

import json
import time
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]


def verify() -> None:
    """実画面で SVG アイコンの参照と応答を検証する。"""
    output = ROOT / "artifacts" / f"favicon-{time.time_ns()}"
    output.mkdir(parents=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=False, args=["--ozone-platform=x11"])
        page = browser.new_page(viewport={"width": 1255, "height": 742})
        requests: list[str] = []
        page.on("request", lambda request: requests.append(request.url))
        page.goto("http://127.0.0.1:8765/")
        icon = page.locator('link[rel="icon"]')
        assert icon.get_attribute("href") == "/favicon.svg"
        response = page.request.get("http://127.0.0.1:8765/favicon.svg")
        assert response.status == 200
        assert "image/svg+xml" in response.headers.get("content-type", "")
        assert "<svg" in response.text()
        page.wait_for_timeout(500)
        page.screenshot(path=str(output / "page.png"))
        assert not any(url.endswith("favicon.ico") for url in requests), requests
        (output / "report.json").write_text(
            json.dumps({"headless": False, "status": "passed", "icon_status": response.status, "requests": requests}, indent=2),
            encoding="utf-8",
        )
        browser.close()


if __name__ == "__main__":
    verify()

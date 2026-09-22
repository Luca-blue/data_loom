"""画面配信とデータ送信の境界を補助的に検証する。"""
import asyncio

from httpx import ASGITransport, AsyncClient
from data_loom.web.app import create_app


async def _request(method: str, path: str):
    async with AsyncClient(transport=ASGITransport(app=create_app()), base_url="http://test") as client:
        return await client.request(method, path)


def test_health() -> None:
    """稼働状態が取得できることを確認する。"""
    assert asyncio.run(_request("GET", "/health")).json() == {"status": "ok"}


def test_no_upload_endpoint() -> None:
    """JSONL を送信する API が公開されていないことを確認する。"""
    app = create_app()
    assert all("POST" not in getattr(route, "methods", set()) for route in app.routes)
    assert app.openapi_url is None
    assert [route.path for route in app.routes if getattr(route, "methods", None)] == ["/health"]

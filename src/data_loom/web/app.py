"""データを受信せず、アプリケーションの静的資産を配信する。"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles


def create_app() -> FastAPI:
    """画面配信専用の FastAPI アプリケーションを作成する。

    Returns:
        JSONL のアップロード機能を持たないアプリケーション。
    """
    app = FastAPI(title="Data Loom", docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/health")
    async def health() -> dict[str, str]:
        """配信プロセスの稼働状態を返す。

        Returns:
            正常稼働を示すステータス。
        """
        return {"status": "ok"}

    static = Path(__file__).parent / "static"
    if static.is_dir():
        app.mount("/", StaticFiles(directory=static, html=True), name="ui")
    else:
        @app.get("/", response_class=HTMLResponse, status_code=503)
        async def missing_build() -> str:
            """未ビルド時に必要な操作を表示する。

            Returns:
                フロントエンドのビルドを案内する HTML。
            """
            return '<html lang="ja"><h1>画面をビルドしてください</h1><p>frontend で uv run npm ci と uv run npm run build を実行してください。</p></html>'
    return app


app = create_app()

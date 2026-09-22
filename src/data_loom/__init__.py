"""Data Loom の起動エントリーポイント。"""

import argparse

import uvicorn


def main() -> None:
    """コマンドライン設定で画面配信サーバーを起動する。"""
    parser = argparse.ArgumentParser(description="Data Loom — ローカル JSONL エディター")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    uvicorn.run("data_loom.web.app:app", host=args.host, port=args.port)

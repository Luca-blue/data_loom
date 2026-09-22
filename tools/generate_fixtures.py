"""実画面検証用の JSONL をメモリ使用量を制限して生成する。"""
import argparse
import json
from pathlib import Path


def generate(directory: Path, gib: float = 0) -> None:
    """境界条件と任意サイズの検証ファイルを作成する。

    Args:
        directory: データの出力先。
        gib: 大容量データの目標 GiB。0 の場合は生成しない。
    """
    directory.mkdir(parents=True, exist_ok=True)
    records = [
        {"id": 900719925474099312345, "title": "日本語の学習データ", "prompt": "大きなデータセットをどう整理しますか？", "response": "一行ずつ確認し、必要な情報を残します。\n" * 16, "quality": True, "messages": [{"role": "user", "content": "こんにちは"}], "score": 0.9, "meta": None},
        {"id": 2, "title": "検索対象のレコード", "prompt": "ブラウザで処理", "response": "サーバーに送らず、端末内で編集します。", "quality": False, "messages": [], "score": 1.25, "meta": {"split": "train"}},
        {"id": 3, "title": "短いレコード", "response": "最後の行に改行なし"},
    ]
    (directory / "sample.jsonl").write_bytes(b"\xef\xbb\xbf" + b"\r\n".join(json.dumps(row, ensure_ascii=False).encode() for row in records))
    (directory / "extra.jsonl").write_text('{"id":4,"title":"結合した行","response":"追加ファイル"}\n', encoding="utf-8")
    (directory / "invalid.jsonl").write_bytes(b'{"id":1}\n\n{"x":1,"x":2}\n[1,2]\n{broken}\n{"text":"\xff"}\n')
    with (directory / "oversized.jsonl").open("wb") as stream:
        stream.write(b'{"text":"')
        for _ in range(17):
            stream.write(b"a" * 1024 * 1024)
        stream.write(b'"}\n{"id":2}\n')
    if gib:
        # 同じ長さの1 KiB程度の行を繰り返し、生成時にも全件展開しない。
        target = int(gib * 1024**3)
        path = directory / f"large-{gib:g}gib.jsonl"
        with path.open("wb") as stream:
            row = json.dumps({"id": 900719925474099312345, "title": "大容量の検証", "response": "端末内の処理を確認します。" * 24}, ensure_ascii=False).encode() + b"\n"
            batch = row * 1024
            written = 0
            while written < target:
                stream.write(batch)
                written += len(batch)
        print(f"{path}: {path.stat().st_size:,} bytes")


def main() -> None:
    """引数を読み取り、検証データを生成する。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=Path("artifacts/fixtures"))
    parser.add_argument("--gib", type=float, default=0)
    args = parser.parse_args()
    generate(args.directory, args.gib)


if __name__ == "__main__":
    main()

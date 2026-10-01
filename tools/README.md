# 実画面検証

FastAPI を `uv run data-loom --port 8765` で起動してから実行してください。

```bash
uv sync
uv run playwright install chromium
uv run python tools/verify_ui.py --native-dialogs
```

Playwright は既存の Chromium を `headless=False` で起動し、検証ごとに `artifacts/ui-.../browser-profile/` を使用します。普段使いのブラウザプロファイルは使用しません。インストール先を限定する場合は、インストール時と実行時の両方に `PLAYWRIGHT_BROWSERS_PATH=/tmp/data-loom-browsers` を指定してください。

- `verify_ui.py`：表示中のブラウザで読み込み、結合、編集、数値精度、Undo／Redo、枠サイズ、KEY 候補と手入力による検索、一括 KEY 操作、レスポンシブ、復元、通信を検証。
- `verify_pins.py`：表・詳細・全幅のピン留め、解除、作業復元と四角い枠を実画面で確認。
- `verify_favicon.py`：タブ用 SVG アイコンが配信され、`favicon.ico` への余分なリクエストが出ないことを実画面で確認。
- `verify_field_layout.py`：短い値の表・詳細配置と設定パネルの終了操作を、1255×742 の実画面で確認。
- `verify_nested.py`：ネストした object / array を表から開く操作、経路での復帰、末端の値の編集と確定を実画面で確認。
- `verify_edges.py`：実 OPFS ディレクトリへの3方式の分割と、診断・保存失敗・タブ排他・元ファイル変更を検証。`uv run python tools/verify_edges.py` で実行します。
- `native_dialog.py`：X11 環境で表示中のファイルダイアログにキーを送る補助。`--native-dialogs` を付けると、実ファイルへの書き出しも検証します。実行中はキーボード・マウスを操作しないでください。X11 以外では保存ダイアログを手動で確認してください。
- `browser_metrics.py`：CDP でページと Worker の V8 ヒープ・ArrayBuffer 領域を測定。ブラウザ全体の RSS や OS キャッシュではありません。
- `generate_fixtures.py`：UTF-8／BOM／CRLF／重複 KEY／巨大レコード／大容量データを生成。

verify_edges.py では保存先選択だけを実 OPFS ハンドルに置き換えます。OS のフォルダ選択・許可は未検証です。verify_ui.py の --native-dialogs は単一ファイルの実保存ダイアログを操作します。通常のファイル入力もブラウザが実際のファイルを読みます。アプリ内部のファイル読み取り・OPFS・IndexedDB・書き出し処理をモックに置き換えません。

## 大容量検証

```bash
uv run python tools/generate_fixtures.py --gib 1
uv run python tools/verify_ui.py --large artifacts/fixtures/large-1gib.jsonl
uv run python tools/generate_fixtures.py --gib 5
uv run python tools/verify_ui.py --large artifacts/fixtures/large-5gib.jsonl
```

行単位で生成するため、出力は指定容量を最大1バッチ分だけ超えます。処理時間、ヒープ、ランダムアクセス、全件検索の結果を `report.json` に記録します。`trace.zip` と画面画像も同じ出力ディレクトリに保存します。

画面を表示できない場合は実画面テストを実施できません。headless や Xvfb に切り替えず、未実施として記録します。

## 手動確認を組み合わせる項目

OS ダイアログの環境差、ファイルアクセス権限の再許可、元ファイルの変更、複数タブ、容量不足、中断時の出力を確認します。容量不足を故障注入で確認した場合、実際にディスクを満杯にしたテストと区別して記録してください。

検証成果物・生成データ・専用プロファイルはすべて `artifacts/` 内で、Git 管理対象外です。不要になった検証ディレクトリはユーザーが削除できます。

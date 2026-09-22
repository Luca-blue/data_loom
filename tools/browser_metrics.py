"""表示中のページと Worker の V8 ヒープを CDP で測定する。"""
import json
from playwright.sync_api import BrowserContext, Page


class BrowserMetrics:
    """ページ・Worker のヒープ使用量を定期測定する。"""

    def __init__(self, context: BrowserContext, page: Page) -> None:
        """対象ブラウザの診断セッションを作成する。

        Args:
            context: 表示中のブラウザコンテキスト。
            page: 表示中のアプリケーション画面。
        """
        self.page = page
        self.root = context.browser.new_browser_cdp_session()
        self.main = context.new_cdp_session(page)
        self.worker_sessions: dict[str, str] = {}
        self.values: dict[str, dict] = {}
        self.sequence = 0
        self.root.on("Target.receivedMessageFromTarget", self._receive)

    def _receive(self, event: dict) -> None:
        message = json.loads(event["message"])
        if "result" in message and "usedSize" in message["result"]:
            self.values[event["sessionId"]] = message["result"]

    def sample(self) -> dict:
        """各 V8 isolate のヒープと ArrayBuffer 領域を測定する。

        Returns:
            ページと Worker の測定値と合計。ブラウザ全体の RSS ではない。
        """
        for target in self.root.send("Target.getTargets")["targetInfos"]:
            if target["type"] == "worker" and target["targetId"] not in self.worker_sessions:
                session = self.root.send("Target.attachToTarget", {"targetId": target["targetId"], "flatten": False})
                self.worker_sessions[target["targetId"]] = session["sessionId"]
        for session_id in self.worker_sessions.values():
            self.sequence += 1
            self.root.send("Target.sendMessageToTarget", {"sessionId": session_id, "message": json.dumps({"id": self.sequence, "method": "Runtime.getHeapUsage"})})
        main = self.main.send("Runtime.getHeapUsage")
        self.page.wait_for_timeout(30)
        workers = list(self.values.values())
        return {"page": main, "workers": workers, "combined_used_bytes": sum(item.get("usedSize", 0) + item.get("backingStorageSize", 0) for item in [main, *workers])}

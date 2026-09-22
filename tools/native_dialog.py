"""表示中の X11 ファイルダイアログへキーを送る補助機能。"""
import ctypes
import time


class NativeDialog:
    """実画面上のネイティブファイル選択を補助する。

    Wayland のみの環境では手動でダイアログを操作すること。
    """

    def __init__(self) -> None:
        """X11 と XTest を接続する。

        Raises:
            RuntimeError: ディスプレイに接続できない場合。
        """
        self.x = ctypes.CDLL("libX11.so.6")
        self.xtest = ctypes.CDLL("libXtst.so.6")
        self.x.XOpenDisplay.restype = ctypes.c_void_p
        self.x.XOpenDisplay.argtypes = [ctypes.c_char_p]
        self.x.XStringToKeysym.restype = ctypes.c_ulong
        self.x.XStringToKeysym.argtypes = [ctypes.c_char_p]
        self.x.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
        self.x.XKeysymToKeycode.restype = ctypes.c_uint
        self.x.XFlush.argtypes = [ctypes.c_void_p]
        self.x.XCloseDisplay.argtypes = [ctypes.c_void_p]
        self.xtest.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
        self.display = self.x.XOpenDisplay(None)
        if not self.display:
            raise RuntimeError("実画面の X11 ディスプレイに接続できません")

    def _key(self, name: str, down: bool) -> None:
        code = self.x.XKeysymToKeycode(self.display, self.x.XStringToKeysym(name.encode()))
        self.xtest.XTestFakeKeyEvent(self.display, code, int(down), 0)
        self.x.XFlush(self.display)

    def press(self, name: str, control: bool = False) -> None:
        """キーまたは Control との組み合わせを送る。

        Args:
            name: X11 のキー名。
            control: Control を同時に押すかどうか。
        """
        if control:
            self._key("Control_L", True)
        self._key(name, True)
        self._key(name, False)
        if control:
            self._key("Control_L", False)

    def type_path(self, path: str) -> None:
        """ASCII のファイルパスを入力する。

        Args:
            path: 入力する絶対パス。
        """
        mapping = {"/": "slash", ".": "period", "-": "minus", "_": "underscore", " ": "space", ":": "colon"}
        for char in path:
            shift = char.isupper() or char in "_:"
            if shift:
                self._key("Shift_L", True)
            name = mapping.get(char, char.lower())
            self.press(name)
            time.sleep(0.004)
            if shift:
                self._key("Shift_L", False)
        self.x.XFlush(self.display)

    def choose(self, path: str, submit: bool = True) -> None:
        """現在表示されているダイアログの場所欄にパスを入力する。

        Args:
            path: 選択するファイルまたはディレクトリの絶対パス。
            submit: 入力後に Enter を押すかどうか。
        """
        time.sleep(0.7)
        self.press("l", control=True)
        time.sleep(0.4)
        self.press("a", control=True)
        self.type_path(path)
        time.sleep(0.4)
        if submit:
            self.press("Return")

    def close(self) -> None:
        """X11 接続を閉じる。"""
        self.x.XCloseDisplay(self.display)

    def focus_dialog(self) -> None:
        """表示中の保存・選択ダイアログを X11 の入力対象にする。"""
        self.x.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
        self.x.XDefaultRootWindow.restype = ctypes.c_ulong
        self.x.XQueryTree.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.POINTER(ctypes.c_ulong)), ctypes.POINTER(ctypes.c_uint)]
        self.x.XFetchName.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_char_p)]
        self.x.XFree.argtypes = [ctypes.c_void_p]
        root = self.x.XDefaultRootWindow(self.display)
        parent, returned_root, children, count = ctypes.c_ulong(), ctypes.c_ulong(), ctypes.POINTER(ctypes.c_ulong)(), ctypes.c_uint()
        self.x.XQueryTree(self.display, root, ctypes.byref(returned_root), ctypes.byref(parent), ctypes.byref(children), ctypes.byref(count))
        self.focus_window = None
        target = None
        permission_target = None
        candidates = [children[i] for i in range(count.value)]
        if children:
            self.x.XFree(children)
        for _ in range(3):
            following = []
            for window in candidates:
                name = ctypes.c_char_p()
                self.x.XFetchName(self.display, window, ctypes.byref(name))
                title = name.value.decode(errors="replace") if name.value else ""
                geom_root, gx, gy = ctypes.c_ulong(), ctypes.c_int(), ctypes.c_int()
                gw, gh, border, depth = ctypes.c_uint(), ctypes.c_uint(), ctypes.c_uint(), ctypes.c_uint()
                self.x.XGetGeometry.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_uint), ctypes.POINTER(ctypes.c_uint), ctypes.POINTER(ctypes.c_uint), ctypes.POINTER(ctypes.c_uint)]
                self.x.XGetGeometry(self.display, window, ctypes.byref(geom_root), ctypes.byref(gx), ctypes.byref(gy), ctypes.byref(gw), ctypes.byref(gh), ctypes.byref(border), ctypes.byref(depth))
                if title or (gw.value>200 and gh.value>80):
                    print(f"Window {window}: {title} {gw.value}x{gh.value}", flush=True)
                if 1000 <= gw.value <= 2000 and 600 <= gh.value <= 1600:
                    self.browser_window = window
                if title in ("chrome", "") and 200 <= gw.value <= 900 and 80 <= gh.value <= 700:
                    permission_target = window
                if any(word in title.lower() for word in ["save", "保存", "open", "開く", "select", "ファイル", "this site"]):
                    target = window
                if name:
                    self.x.XFree(name)
                sub, n = ctypes.POINTER(ctypes.c_ulong)(), ctypes.c_uint()
                self.x.XQueryTree(self.display, window, ctypes.byref(returned_root), ctypes.byref(parent), ctypes.byref(sub), ctypes.byref(n))
                following.extend(sub[i] for i in range(n.value))
                if sub:
                    self.x.XFree(sub)
            candidates = following
        target = target or permission_target
        if target:
            self.focus_window = target
            self.x.XSetInputFocus.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
            self.x.XRaiseWindow.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
            self.x.XRaiseWindow(self.display, target)
            self.x.XSetInputFocus(self.display, target, 2, 0)
            self.x.XFlush(self.display)

    def click_at(self, x: int, y: int) -> None:
        """選択中の実ダイアログ内の座標をクリックする。

        Args:
            x: ウィンドウ左端からの位置。
            y: ウィンドウ上端からの位置。
        """
        if not getattr(self, "focus_window", None):
            return
        root = self.x.XDefaultRootWindow(self.display)
        child, rx, ry = ctypes.c_ulong(), ctypes.c_int(), ctypes.c_int()
        self.x.XTranslateCoordinates.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_int, ctypes.c_int, ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_ulong)]
        self.x.XTranslateCoordinates(self.display, self.focus_window, root, x, y, ctypes.byref(rx), ctypes.byref(ry), ctypes.byref(child))
        self.xtest.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong]
        self.xtest.XTestFakeButtonEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
        self.xtest.XTestFakeMotionEvent(self.display, -1, rx.value, ry.value, 0)
        self.xtest.XTestFakeButtonEvent(self.display, 1, 1, 0)
        self.xtest.XTestFakeButtonEvent(self.display, 1, 0, 0)
        self.x.XFlush(self.display)

    def save(self) -> None:
        """表示中の GTK ダイアログ右下の保存ボタンを押す。"""
        if not getattr(self, "focus_window", None):
            return
        root, gx, gy = ctypes.c_ulong(), ctypes.c_int(), ctypes.c_int()
        width, height, border, depth = ctypes.c_uint(), ctypes.c_uint(), ctypes.c_uint(), ctypes.c_uint()
        self.x.XGetGeometry.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_uint), ctypes.POINTER(ctypes.c_uint), ctypes.POINTER(ctypes.c_uint), ctypes.POINTER(ctypes.c_uint)]
        self.x.XGetGeometry(self.display, self.focus_window, ctypes.byref(root), ctypes.byref(gx), ctypes.byref(gy), ctypes.byref(width), ctypes.byref(height), ctypes.byref(border), ctypes.byref(depth))
        child, rx, ry = ctypes.c_ulong(), ctypes.c_int(), ctypes.c_int()
        self.x.XTranslateCoordinates.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_int, ctypes.c_int, ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_ulong)]
        self.x.XTranslateCoordinates(self.display, self.focus_window, root, width.value - 48, height.value - 24, ctypes.byref(rx), ctypes.byref(ry), ctypes.byref(child))
        self.xtest.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong]
        self.xtest.XTestFakeButtonEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
        self.xtest.XTestFakeMotionEvent(self.display, -1, rx.value, ry.value, 0)
        self.xtest.XTestFakeButtonEvent(self.display, 1, 1, 0)
        self.xtest.XTestFakeButtonEvent(self.display, 1, 0, 0)
        self.x.XFlush(self.display)

    def screenshot(self, path: str, window: int | None = None) -> None:
        """フォーカス中の実ウィンドウを PNG として保存する。

        Args:
            path: 画像の保存先。
            window: 対象ウィンドウ。省略時はフォーカス中のダイアログ。
        """
        import struct
        import zlib
        from pathlib import Path

        class _XImage(ctypes.Structure):
            """X11 の画像ヘッダーを読み取る内部構造体。"""
            _fields_ = [("width", ctypes.c_int), ("height", ctypes.c_int), ("xoffset", ctypes.c_int), ("format", ctypes.c_int), ("data", ctypes.c_void_p), ("byte_order", ctypes.c_int), ("bitmap_unit", ctypes.c_int), ("bitmap_bit_order", ctypes.c_int), ("bitmap_pad", ctypes.c_int), ("depth", ctypes.c_int), ("bytes_per_line", ctypes.c_int), ("bits_per_pixel", ctypes.c_int)]

        self.x.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
        self.x.XDefaultRootWindow.restype = ctypes.c_ulong
        self.x.XDisplayWidth.argtypes = [ctypes.c_void_p, ctypes.c_int]
        self.x.XDisplayHeight.argtypes = [ctypes.c_void_p, ctypes.c_int]
        width = self.x.XDisplayWidth(self.display, 0)
        height = self.x.XDisplayHeight(self.display, 0)
        root = self.x.XDefaultRootWindow(self.display)
        self.x.XGetInputFocus.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_int)]
        focus, revert = ctypes.c_ulong(), ctypes.c_int()
        self.x.XGetInputFocus(self.display, ctypes.byref(focus), ctypes.byref(revert))
        if window:
            root = window
        elif focus.value > 1:
            root = focus.value
        geom_root, gx, gy = ctypes.c_ulong(), ctypes.c_int(), ctypes.c_int()
        gw, gh, border, depth = ctypes.c_uint(), ctypes.c_uint(), ctypes.c_uint(), ctypes.c_uint()
        self.x.XGetGeometry.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_uint), ctypes.POINTER(ctypes.c_uint), ctypes.POINTER(ctypes.c_uint), ctypes.POINTER(ctypes.c_uint)]
        self.x.XGetGeometry(self.display, root, ctypes.byref(geom_root), ctypes.byref(gx), ctypes.byref(gy), ctypes.byref(gw), ctypes.byref(gh), ctypes.byref(border), ctypes.byref(depth))
        width, height = gw.value, gh.value
        print(f"Native window: {root}, {width}x{height}", flush=True)
        self.x.XGetImage.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_int, ctypes.c_uint, ctypes.c_uint, ctypes.c_ulong, ctypes.c_int]
        self.x.XGetImage.restype = ctypes.POINTER(_XImage)
        image = self.x.XGetImage(self.display, root, 0, 0, width, height, ctypes.c_ulong(-1), 2)
        if not image:
            raise RuntimeError("実画面を取得できません")
        info = image.contents
        pixels = ctypes.string_at(info.data, info.bytes_per_line * height)
        rows = bytearray()
        stride = info.bits_per_pixel // 8
        for y in range(height):
            rows.append(0)
            line = pixels[y * info.bytes_per_line:(y + 1) * info.bytes_per_line]
            for x in range(width):
                offset = x * stride
                rows.extend((line[offset + 2], line[offset + 1], line[offset]))
        def chunk(kind: bytes, data: bytes) -> bytes:
            return struct.pack("!I", len(data)) + kind + data + struct.pack("!I", zlib.crc32(kind + data))
        Path(path).write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack("!2I5B", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))
        self.x.XDestroyImage.argtypes = [ctypes.POINTER(_XImage)]
        self.x.XDestroyImage(image)

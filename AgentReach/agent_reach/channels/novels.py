# -*- coding: utf-8 -*-
"""Novels — read chapters from Qidian, Novel543, 69shuba via Jina Reader."""

import urllib.request
from urllib.parse import urlparse
from .base import Channel

_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"


class NovelChannel(Channel):
    name = "novels"
    description = "小说阅读 (Qidian, Novel543, 69shuba)"
    backends = ["Jina Reader"]
    tier = 0

    def can_handle(self, url: str) -> bool:
        netloc = urlparse(url).netloc.lower()
        return any(domain in netloc for domain in ["qidian.com", "novel543.com", "69shu", "69shuba"])

    def check(self, config=None):
        self.active_backend = self.backends[0]
        return "ok", "可直接使用 Jina Reader 读取小说章节（curl https://r.jina.ai/URL）"

    def read(self, url: str) -> str:
        """通过 Jina Reader 读取小说内容。"""
        if not url.startswith(("http://", "https://")):
            url = "https://" + url
        jina_url = f"https://r.jina.ai/{url}"
        req = urllib.request.Request(
            jina_url,
            headers={"User-Agent": _UA, "Accept": "text/plain"},
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read().decode("utf-8")

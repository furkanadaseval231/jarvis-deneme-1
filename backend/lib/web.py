"""Keyless live web access: real YouTube search by scraping ytInitialData.

No API key required. Returns real video ids that the frontend embeds and plays.
"""

import json
import re
from typing import Any

import httpx

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/123.0 Safari/537.36"
)
HEADERS = {"User-Agent": UA, "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8"}


def _walk(node: Any, key: str, out: list):
    """Collect every dict stored under `key` anywhere in a nested structure."""
    if isinstance(node, dict):
        for k, v in node.items():
            if k == key and isinstance(v, dict):
                out.append(v)
            else:
                _walk(v, key, out)
    elif isinstance(node, list):
        for item in node:
            _walk(item, key, out)


def _text(block: Any) -> str:
    if not isinstance(block, dict):
        return ""
    if "simpleText" in block:
        return str(block["simpleText"])
    runs = block.get("runs")
    if isinstance(runs, list):
        return "".join(str(r.get("text", "")) for r in runs if isinstance(r, dict))
    return ""


async def youtube_search(query: str, limit: int = 6) -> list[dict]:
    url = "https://www.youtube.com/results"
    async with httpx.AsyncClient(timeout=20, headers=HEADERS, follow_redirects=True) as http:
        res = await http.get(url, params={"search_query": query, "hl": "tr"})
    html = res.text

    data = None
    match = re.search(r"var ytInitialData\s*=\s*(\{.*?\});</script>", html, re.S)
    if not match:
        match = re.search(r'ytInitialData"\]\s*=\s*(\{.*?\});', html, re.S)
    if match:
        try:
            data = json.loads(match.group(1))
        except json.JSONDecodeError:
            data = None

    tracks: list[dict] = []
    if data:
        renderers: list[dict] = []
        _walk(data, "videoRenderer", renderers)
        for r in renderers:
            vid = r.get("videoId")
            if not vid:
                continue
            thumbs = (r.get("thumbnail") or {}).get("thumbnails") or []
            tracks.append({
                "video_id": vid,
                "title": _text(r.get("title")) or query,
                "channel": _text((r.get("ownerText") or {})) or _text(r.get("longBylineText")),
                "duration": _text(r.get("lengthText")),
                "thumbnail": thumbs[-1]["url"] if thumbs else f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
            })
            if len(tracks) >= limit:
                break

    if not tracks:  # last-resort id sweep so media control still works if the shape changes
        seen: list[str] = []
        for vid in re.findall(r'"videoId":"([\w-]{11})"', html):
            if vid not in seen:
                seen.append(vid)
            if len(seen) >= limit:
                break
        tracks = [{
            "video_id": v, "title": query, "channel": "YouTube", "duration": "",
            "thumbnail": f"https://i.ytimg.com/vi/{v}/hqdefault.jpg",
        } for v in seen]

    return tracks

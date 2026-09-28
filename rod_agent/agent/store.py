"""대화 세션·업로드 파일을 data/ 폴더에 JSON으로 저장한다."""

from __future__ import annotations

import json
import re
import threading
import time
import uuid
from pathlib import Path

from .config import SESSION_DIR, UPLOAD_DIR

_lock = threading.Lock()
_ID_RE = re.compile(r"^[a-f0-9]{32}$")


def _valid(sid: str) -> bool:
    return bool(_ID_RE.match(sid or ""))


# ------------------------------------------------------------ 세션

def new_session(mode: str = "auto") -> dict:
    s = {"id": uuid.uuid4().hex, "title": "새 작업", "mode": mode,
         "created": time.time(), "updated": time.time(), "messages": [], "outputs": []}
    save_session(s)
    return s


def load_session(sid: str) -> dict | None:
    if not _valid(sid):
        return None
    path = SESSION_DIR / f"{sid}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def save_session(s: dict) -> None:
    s["updated"] = time.time()
    with _lock:
        path = SESSION_DIR / f"{s['id']}.json"
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(s, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(path)


def list_sessions() -> list[dict]:
    items = []
    for p in SESSION_DIR.glob("*.json"):
        try:
            s = json.loads(p.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        items.append({"id": s["id"], "title": s.get("title", ""), "mode": s.get("mode", "auto"),
                      "updated": s.get("updated", 0)})
    return sorted(items, key=lambda x: x["updated"], reverse=True)


def delete_session(sid: str) -> bool:
    if not _valid(sid):
        return False
    path = SESSION_DIR / f"{sid}.json"
    if path.exists():
        path.unlink()
        return True
    return False


# ------------------------------------------------------------ 업로드

def save_upload(filename: str, data: bytes, info: dict) -> dict:
    fid = uuid.uuid4().hex
    ext = Path(filename).suffix.lower()
    (UPLOAD_DIR / f"{fid}{ext}").write_bytes(data)
    meta = {"id": fid, "name": filename, "ext": ext, "size": len(data), **info}
    (UPLOAD_DIR / f"{fid}.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return meta


def load_upload(fid: str) -> tuple[Path, dict] | None:
    if not _valid(fid):
        return None
    meta_path = UPLOAD_DIR / f"{fid}.json"
    if not meta_path.exists():
        return None
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    return UPLOAD_DIR / f"{fid}{meta['ext']}", meta

"""로드 업무 에이전트 — 로컬 웹 서버 (http://127.0.0.1:8000)."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import uuid
import webbrowser
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from agent import __version__, config, extract, llm, render, store
from agent.markdown import extract_meta
from agent.prompts import MODES, public_modes

config.ensure_dirs()
app = FastAPI(title="로드 업무 에이전트", version=__version__)
app.mount("/static", StaticFiles(directory=config.STATIC_DIR), name="static")

MAX_UPLOAD = 40 * 1024 * 1024


class ChatIn(BaseModel):
    session_id: str
    message: str = ""
    file_ids: list[str] = Field(default_factory=list)
    mode: str = "auto"
    model: str = ""
    effort: str = "medium"
    web_search: bool = False
    format: str = ""  # 비우면 모드 기본값, "none"이면 파일 자동생성 끔


class RenderIn(BaseModel):
    session_id: str
    index: int
    format: str
    org: str = ""
    doc: str = ""


class SettingsIn(BaseModel):
    api_key: str | None = None
    output_dir: str | None = None
    model: str | None = None


class SessionIn(BaseModel):
    mode: str = "auto"


# ---------------------------------------------------------------- 기본

@app.get("/")
def index():
    return FileResponse(config.STATIC_DIR / "index.html")


@app.get("/api/status")
def status():
    return {
        "version": __version__,
        "has_key": config.has_api_key(),
        "models": config.MODELS,
        "default_model": config.default_model(),
        "modes": public_modes(),
        "formats": list(render.FORMATS),
        "output_dir": str(config.output_dir()),
    }


@app.post("/api/settings")
def settings(body: SettingsIn):
    updates = {}
    if body.api_key is not None:
        key = body.api_key.strip()
        if key and not key.startswith("sk-ant-"):
            raise HTTPException(400, "API 키는 sk-ant- 로 시작해야 합니다.")
        updates["ANTHROPIC_API_KEY"] = key
    if body.output_dir is not None:
        path = Path(body.output_dir.strip()).expanduser() if body.output_dir.strip() else None
        if path:
            try:
                path.mkdir(parents=True, exist_ok=True)
            except OSError as e:
                raise HTTPException(400, f"폴더를 만들 수 없습니다: {e}") from e
        updates["OUTPUT_DIR"] = str(path) if path else ""
    if body.model is not None:
        if body.model not in config.MODELS:
            raise HTTPException(400, "지원하지 않는 모델입니다.")
        updates["CLAUDE_MODEL"] = body.model
    if updates:
        config.save_env(updates)
    return status()


# ---------------------------------------------------------------- 세션

@app.get("/api/sessions")
def sessions():
    return store.list_sessions()


@app.post("/api/sessions")
def create_session(body: SessionIn):
    return store.new_session(body.mode if body.mode in MODES else "auto")


@app.get("/api/sessions/{sid}")
def get_session(sid: str):
    s = store.load_session(sid)
    if not s:
        raise HTTPException(404, "세션을 찾을 수 없습니다.")
    for m in s["messages"]:
        m["file_info"] = [_file_brief(fid) for fid in m.get("files", [])]
    return s


@app.delete("/api/sessions/{sid}")
def remove_session(sid: str):
    return {"deleted": store.delete_session(sid)}


# ---------------------------------------------------------------- 업로드

def _file_brief(fid: str) -> dict:
    loaded = store.load_upload(fid)
    if not loaded:
        return {"id": fid, "name": "(삭제된 파일)", "status": "manual", "note": ""}
    _, meta = loaded
    return {"id": fid, "name": meta["name"], "size": meta["size"], "kind": meta["kind"],
            "status": meta["status"], "note": meta.get("note", "")}


@app.post("/api/upload")
async def upload(files: list[UploadFile] = File(...)):
    results = []
    for f in files:
        data = await f.read()
        name = Path(f.filename or "file").name
        if len(data) > MAX_UPLOAD:
            results.append({"id": "", "name": name, "status": "manual", "note": "40MB 초과 파일은 올릴 수 없습니다."})
            continue
        tmp = config.UPLOAD_DIR / f"_tmp_{uuid.uuid4().hex}{Path(name).suffix.lower()}"
        tmp.write_bytes(data)
        try:
            info = extract.analyze(tmp)
        finally:
            tmp.unlink(missing_ok=True)
        meta = store.save_upload(name, data, info)
        results.append(_file_brief(meta["id"]))
    return results


# ---------------------------------------------------------------- 대화

def _sse(event: dict) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


@app.post("/api/chat")
def chat(body: ChatIn):
    s = store.load_session(body.session_id)
    if not s:
        raise HTTPException(404, "세션을 찾을 수 없습니다.")
    if not config.has_api_key():
        raise HTTPException(400, "API 키가 설정되지 않았습니다. 설정(⚙)에서 입력하세요.")
    if not body.message.strip() and not body.file_ids:
        raise HTTPException(400, "내용을 입력하세요.")

    mode = body.mode if body.mode in MODES else "auto"
    model = body.model if body.model in config.MODELS else config.default_model()
    effort = body.effort if body.effort in config.EFFORTS else "medium"
    fmt = "" if body.format == "none" else (body.format or MODES[mode]["format"])

    s["mode"] = mode
    s["messages"].append({"role": "user", "text": body.message.strip(), "files": body.file_ids})
    if s["title"] == "새 작업":
        s["title"] = (body.message.strip() or "첨부파일 작업").splitlines()[0][:40]
    store.save_session(s)

    def stream():
        final_text = ""
        for ev in llm.run(s["messages"], mode, model, effort, body.web_search, fmt):
            if ev["type"] == "done":
                final_text = ev["text"]
            else:
                yield _sse(ev)
        if not final_text:
            # 실패한 요청은 기록에서 빼서 다음 요청이 꼬이지 않게 한다
            s["messages"].pop()
            store.save_session(s)
            yield _sse({"type": "end"})
            return

        s["messages"].append({"role": "assistant", "text": final_text, "model": model})
        index = len(s["messages"]) - 1
        store.save_session(s)
        yield _sse({"type": "saved", "index": index})

        _, meta = extract_meta(final_text)
        if fmt in render.FORMATS and meta:
            yield _sse({"type": "status", "text": f"📄 {fmt.upper()} 파일 생성·검증 중…"})
            try:
                info = render.render(final_text, fmt, config.output_dir(),
                                     doc_type=meta.get("doc") or MODES[mode]["doc"])
                s["outputs"].append({**info, "index": index})
                store.save_session(s)
                yield _sse({"type": "file", **info})
            except Exception as e:  # noqa: BLE001
                yield _sse({"type": "error", "text": f"파일 생성 실패: {e}"})
        yield _sse({"type": "end"})

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/render")
def render_file(body: RenderIn):
    s = store.load_session(body.session_id)
    if not s or not (0 <= body.index < len(s["messages"])):
        raise HTTPException(404, "메시지를 찾을 수 없습니다.")
    msg = s["messages"][body.index]
    if msg["role"] != "assistant":
        raise HTTPException(400, "Claude 응답만 파일로 만들 수 있습니다.")
    try:
        info = render.render(msg["text"], body.format, config.output_dir(),
                             doc_type=body.doc or MODES.get(s.get("mode"), MODES["auto"])["doc"],
                             org=body.org)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    s["outputs"].append({**info, "index": body.index})
    store.save_session(s)
    return info


# ---------------------------------------------------------------- 산출물

@app.get("/api/outputs")
def outputs():
    out = config.output_dir()
    files = [p for p in out.iterdir() if p.is_file() and p.suffix.lower().lstrip(".") in render.FORMATS]
    files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return [{"name": p.name, "size": p.stat().st_size, "mtime": p.stat().st_mtime} for p in files[:100]]


def _output_path(name: str) -> Path:
    out = config.output_dir().resolve()
    path = (out / Path(name).name).resolve()
    if path.parent != out or not path.is_file():
        raise HTTPException(404, "파일이 없습니다.")
    return path


@app.get("/api/download/{name}")
def download(name: str):
    path = _output_path(name)
    return FileResponse(path, filename=path.name)


def _open(path: Path) -> None:
    if sys.platform.startswith("win"):
        os.startfile(path)  # noqa: S606 - 로컬 사용자 PC에서 탐색기/연결 프로그램 실행
    elif sys.platform == "darwin":
        subprocess.Popen(["open", str(path)])
    else:
        subprocess.Popen(["xdg-open", str(path)])


@app.post("/api/open/{name}")
def open_file(name: str):
    _open(_output_path(name))
    return {"ok": True}


@app.post("/api/open-folder")
def open_folder():
    _open(config.output_dir())
    return {"ok": True}


if __name__ == "__main__":
    import uvicorn

    url = f"http://{config.HOST}:{config.port()}"
    print(f"\n  로드 업무 에이전트 v{__version__}\n  주소: {url}\n  산출물 폴더: {config.output_dir()}\n")
    if "--no-browser" not in sys.argv:
        import threading

        threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    uvicorn.run(app, host=config.HOST, port=config.port(), log_level="warning")

"""Claude가 쓴 마크다운을 렌더러 공용 블록 목록으로 변환한다.

지원 문법: 제목(#~####), 문단, 글머리(-, *, •), 번호목록(1.), 표(| |),
인용(>), 구분선(---), 코드블록(```), 굵게(**text**).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

META_RE = re.compile(r"<!--\s*meta\s*(\{.*?\})\s*-->", re.S)
_BULLET_RE = re.compile(r"^(\s*)([-*•]|\d+[.)])\s+(.*)$")
_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
_TABLE_SEP_RE = re.compile(r"^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$")
_BOLD_RE = re.compile(r"\*\*(.+?)\*\*")


@dataclass
class Block:
    kind: str  # heading | para | bullet | table | quote | hr | code
    text: str = ""
    level: int = 0
    ordered: bool = False
    rows: list[list[str]] = field(default_factory=list)


def extract_meta(markdown: str) -> tuple[str, dict]:
    """본문 끝의 `<!--meta {...}-->` 주석을 떼어내 파일명 정보로 돌려준다."""
    meta: dict = {}
    match = META_RE.search(markdown)
    if match:
        try:
            parsed = json.loads(match.group(1))
            if isinstance(parsed, dict):
                meta = parsed
        except json.JSONDecodeError:
            pass
    return META_RE.sub("", markdown).strip(), meta


def split_bold(text: str) -> list[tuple[str, bool]]:
    """'가 **나** 다' -> [('가 ', False), ('나', True), (' 다', False)]"""
    parts: list[tuple[str, bool]] = []
    pos = 0
    for m in _BOLD_RE.finditer(text):
        if m.start() > pos:
            parts.append((text[pos:m.start()], False))
        parts.append((m.group(1), True))
        pos = m.end()
    if pos < len(text):
        parts.append((text[pos:], False))
    return [(clean_inline(t), b) for t, b in parts if t]


def clean_inline(text: str) -> str:
    """굵게 표시 외 인라인 마크다운 기호 제거."""
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1 (\2)", text)
    text = re.sub(r"(?<![*\w])\*(?!\s)([^*]+?)\*(?!\*)", r"\1", text)
    return text


def plain(text: str) -> str:
    return clean_inline(_BOLD_RE.sub(r"\1", text))


def _split_row(line: str) -> list[str]:
    line = line.strip()
    if line.startswith("|"):
        line = line[1:]
    if line.endswith("|"):
        line = line[:-1]
    return [c.strip() for c in line.split("|")]


def parse(markdown: str) -> list[Block]:
    lines = markdown.replace("\r\n", "\n").split("\n")
    blocks: list[Block] = []
    para: list[str] = []
    i = 0

    def flush_para() -> None:
        if para:
            blocks.append(Block("para", " ".join(s.strip() for s in para)))
            para.clear()

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if stripped.startswith("```"):
            flush_para()
            code = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                code.append(lines[i])
                i += 1
            blocks.append(Block("code", "\n".join(code)))
            i += 1
            continue

        if not stripped:
            flush_para()
            i += 1
            continue

        if re.fullmatch(r"(-{3,}|\*{3,}|_{3,})", stripped):
            flush_para()
            blocks.append(Block("hr"))
            i += 1
            continue

        m = _HEADING_RE.match(stripped)
        if m:
            flush_para()
            blocks.append(Block("heading", m.group(2).strip(), level=len(m.group(1))))
            i += 1
            continue

        if stripped.startswith("|") and i + 1 < len(lines) and _TABLE_SEP_RE.match(lines[i + 1]):
            flush_para()
            rows = [_split_row(stripped)]
            i += 2
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append(_split_row(lines[i]))
                i += 1
            width = max(len(r) for r in rows)
            rows = [r + [""] * (width - len(r)) for r in rows]
            blocks.append(Block("table", rows=rows))
            continue

        if stripped.startswith(">"):
            flush_para()
            quote = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                quote.append(lines[i].strip().lstrip(">").strip())
                i += 1
            blocks.append(Block("quote", " ".join(q for q in quote if q)))
            continue

        m = _BULLET_RE.match(line)
        if m:
            flush_para()
            indent = len(m.group(1).replace("\t", "    "))
            blocks.append(
                Block(
                    "bullet",
                    m.group(3).strip(),
                    level=min(indent // 2, 3),
                    ordered=m.group(2)[0].isdigit(),
                )
            )
            i += 1
            continue

        para.append(line)
        i += 1

    flush_para()
    return blocks


def title_of(blocks: list[Block], fallback: str = "문서") -> str:
    for b in blocks:
        if b.kind == "heading":
            return plain(b.text)
    return fallback

"""마크다운 블록 → HWPX(한글) 문서.

assets/hwpx/base 템플릿(보고서 스타일 헤더 포함)을 복사하고
section0.xml 본문만 새로 생성해 ZIP으로 묶는다.

보고서 템플릿 스타일 ID
  charPr  7: 20pt 볼드(제목)   8: 14pt 볼드(소제목)   9: 10pt 볼드(표 헤더)
          13: 12pt 볼드 돋움(섹션 헤더)   0: 10pt 본문
  paraPr 20: 가운데   21: 표 셀 가운데   22: 표 셀 양쪽
         24/25/26: 들여쓰기 1/2/3단   27: 섹션 헤더(상하 테두리)
  borderFill 3: 표 테두리   4: 표 헤더 배경
"""

from __future__ import annotations

import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape

from .config import ASSET_DIR
from .markdown import Block, plain, split_bold

TEMPLATE_DIR = ASSET_DIR / "hwpx" / "base"
BODY_WIDTH = 42520  # A4 본문폭(HWPUNIT)
BULLET_MARKS = ("□ ", "○ ", "- ", "· ")
REQUIRED = ["mimetype", "Contents/content.hpf", "Contents/header.xml", "Contents/section0.xml"]


class _Ids:
    def __init__(self) -> None:
        self.n = 1000000001

    def next(self) -> int:
        self.n += 1
        return self.n


def _runs(text: str, char_id: int = 0, bold_id: int = 9) -> str:
    parts = split_bold(text) or [("", False)]
    return "".join(
        f'<hp:run charPrIDRef="{bold_id if bold else char_id}"><hp:t>{escape(t)}</hp:t></hp:run>'
        for t, bold in parts
    )


def _para(ids: _Ids, inner: str, para_id: int = 0) -> str:
    return (
        f'<hp:p id="{ids.next()}" paraPrIDRef="{para_id}" styleIDRef="0" '
        f'pageBreak="0" columnBreak="0" merged="0">{inner}</hp:p>'
    )


def _empty(ids: _Ids) -> str:
    return _para(ids, '<hp:run charPrIDRef="0"><hp:t/></hp:run>')


def _table(ids: _Ids, rows: list[list[str]]) -> str:
    cols = len(rows[0])
    base = BODY_WIDTH // cols
    widths = [base] * cols
    widths[-1] += BODY_WIDTH - base * cols
    row_h = 2400
    trs = []
    for r, row in enumerate(rows):
        header = r == 0
        tcs = []
        for c, cell in enumerate(row):
            inner = _para(
                ids,
                _runs(cell, char_id=9 if header else 0),
                para_id=21 if header else 22,
            )
            tcs.append(
                f'<hp:tc name="" header="{1 if header else 0}" hasMargin="0" protect="0" '
                f'editable="0" dirty="1" borderFillIDRef="{4 if header else 3}">'
                '<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" '
                'linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" '
                f'hasTextRef="0" hasNumRef="0">{inner}</hp:subList>'
                f'<hp:cellAddr colAddr="{c}" rowAddr="{r}"/>'
                '<hp:cellSpan colSpan="1" rowSpan="1"/>'
                f'<hp:cellSz width="{widths[c]}" height="{row_h}"/>'
                '<hp:cellMargin left="510" right="510" top="141" bottom="141"/>'
                "</hp:tc>"
            )
        trs.append("<hp:tr>" + "".join(tcs) + "</hp:tr>")
    tbl = (
        f'<hp:tbl id="{ids.next()}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" '
        'textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="1" '
        f'rowCnt="{len(rows)}" colCnt="{cols}" cellSpacing="0" borderFillIDRef="3" noAdjust="0">'
        f'<hp:sz width="{BODY_WIDTH}" widthRelTo="ABSOLUTE" height="{row_h * len(rows)}" '
        'heightRelTo="ABSOLUTE" protect="0"/>'
        '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" '
        'holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" '
        'vertOffset="0" horzOffset="0"/>'
        '<hp:outMargin left="0" right="0" top="0" bottom="0"/>'
        '<hp:inMargin left="510" right="510" top="141" bottom="141"/>'
        + "".join(trs)
        + "</hp:tbl>"
    )
    return _para(ids, f'<hp:run charPrIDRef="0">{tbl}</hp:run><hp:run charPrIDRef="0"><hp:t/></hp:run>')


def build_section(blocks: list[Block]) -> str:
    template = (TEMPLATE_DIR / "Contents" / "section0.xml").read_text(encoding="utf-8")
    head = template[: template.index("</hp:p>") + len("</hp:p>")]
    ids = _Ids()
    body: list[str] = []
    first_heading = True
    for b in blocks:
        if b.kind == "heading":
            text = plain(b.text)
            if first_heading and b.level == 1:
                body.append(_para(ids, f'<hp:run charPrIDRef="7"><hp:t>{escape(text)}</hp:t></hp:run>', 20))
                body.append(_empty(ids))
            elif b.level <= 2:
                body.append(_para(ids, f'<hp:run charPrIDRef="13"><hp:t>{escape(text)}</hp:t></hp:run>', 27))
            else:
                body.append(_para(ids, f'<hp:run charPrIDRef="8"><hp:t>{escape(text)}</hp:t></hp:run>'))
            first_heading = False
        elif b.kind == "para":
            body.append(_para(ids, _runs(b.text)))
        elif b.kind == "bullet":
            level = min(b.level, 2)
            mark = "" if b.ordered else BULLET_MARKS[level]
            body.append(_para(ids, _runs(mark + b.text), 24 + level))
        elif b.kind == "quote":
            body.append(_para(ids, _runs("※ " + b.text), 24))
        elif b.kind == "table" and b.rows:
            body.append(_table(ids, b.rows))
            body.append(_empty(ids))
        elif b.kind == "code":
            for line in b.text.splitlines() or [""]:
                body.append(_para(ids, _runs(line)))
        elif b.kind == "hr":
            body.append(_empty(ids))
    return head + "".join(body) + "</hs:sec>"


def write_hwpx(blocks: list[Block], path: Path, title: str = "") -> None:
    section = build_section(blocks)
    ET.fromstring(section.encode("utf-8"))  # 잘못된 XML이면 여기서 예외
    hpf = (TEMPLATE_DIR / "Contents" / "content.hpf").read_text(encoding="utf-8")
    if title:
        hpf = hpf.replace("<opf:title/>", f"<opf:title>{escape(title)}</opf:title>", 1)

    files = sorted(p for p in TEMPLATE_DIR.rglob("*") if p.is_file())
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(TEMPLATE_DIR / "mimetype", "mimetype", compress_type=zipfile.ZIP_STORED)
        for p in files:
            rel = p.relative_to(TEMPLATE_DIR).as_posix()
            if rel == "mimetype":
                continue
            if rel == "Contents/section0.xml":
                zf.writestr(rel, section)
            elif rel == "Contents/content.hpf":
                zf.writestr(rel, hpf)
            else:
                zf.write(p, rel)


def validate_hwpx(path: Path) -> list[str]:
    """hwpx 스킬 validate.py와 같은 기준의 구조 검증. 빈 목록 = 통과."""
    errors: list[str] = []
    try:
        zf = zipfile.ZipFile(path)
    except zipfile.BadZipFile:
        return ["ZIP 형식 아님"]
    with zf:
        names = zf.namelist()
        errors += [f"필수 파일 누락: {r}" for r in REQUIRED if r not in names]
        if names and names[0] != "mimetype":
            errors.append("mimetype이 첫 항목이 아님")
        if "mimetype" in names:
            if zf.read("mimetype").decode().strip() != "application/hwp+zip":
                errors.append("mimetype 값 오류")
            if zf.getinfo("mimetype").compress_type != zipfile.ZIP_STORED:
                errors.append("mimetype이 무압축이 아님")
        for n in names:
            if n.endswith((".xml", ".hpf")):
                try:
                    ET.fromstring(zf.read(n))
                except ET.ParseError as e:
                    errors.append(f"XML 오류 {n}: {e}")
    return errors

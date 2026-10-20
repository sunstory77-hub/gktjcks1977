/* DETAIL PAGE AI — 상세페이지 블록 렌더러 (캔버스).
   미리보기와 JPG 저장이 같은 함수를 쓰므로 화면과 결과물이 어긋나지 않는다.
   앱 화면(어두운 테마)과 무관하게 brief.palette 색만 사용한다. by BAPI */
(function (root) {
  'use strict';
  const W = 860;
  const PADX = 64;
  const INNER = W - PADX * 2;
  const TAIL = '"Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
  const FAMILY = `"Pretendard Variable", Pretendard, ${TAIL}`;
  // 언어별 글꼴 스택(일본어·중국어는 Noto Sans 를 먼저 쓰고, 없으면 시스템 글꼴로 대체)
  const STACKS = {
    ko: FAMILY, en: FAMILY,
    ja: `"Noto Sans JP Variable", "Pretendard Variable", "Yu Gothic UI", "Meiryo", ${TAIL}`,
    'zh-CN': `"Noto Sans SC Variable", "Pretendard Variable", "Microsoft YaHei", "PingFang SC", ${TAIL}`,
  };
  const WRAP_MODE = { ko: 'ko', en: 'latin', ja: 'cjk', 'zh-CN': 'cjk' };
  // renderBlock 동안만 쓰는 현재 언어 설정(동기 처리라 안전)
  const CUR = { family: FAMILY, wrap: 'ko' };
  function useLang(lang) { CUR.family = STACKS[lang] || FAMILY; CUR.wrap = WRAP_MODE[lang] || 'ko'; }

  function rgba(hex, a) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function rrect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  let measureCtx = null;
  function mctx() {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    return measureCtx;
  }
  const fontOf = (size, weight) => `${weight || 400} ${size}px ${CUR.family}`;

  // 일본어·중국어: 한자·가나는 글자 단위, 영문·숫자 묶음은 한 단어로 유지. 줄머리 금칙(닫는 부호)은 줄 끝에 매달고, 줄 끝 금칙(여는 괄호)은 다음 줄로 넘긴다.
  const CLOSERS = new Set('、。，．,.!?！？）)」』】〕〉》］］｝}％%：:；;ー…‥”’'.split(''));
  const OPENERS = new Set('（(「『【〔〈《［［｛{“‘'.split(''));
  function wrapCjk(text, size, weight, maxW) {
    const c = mctx();
    c.font = fontOf(size, weight);
    const width = (s) => c.measureText(s).width;
    const lines = [];
    for (const para of String(text).split('\n')) {
      if (!para.trim()) { lines.push(''); continue; }
      const tokens = para.match(/[A-Za-z0-9][A-Za-z0-9'’.,:%$€£¥\-_/@+#&]*|\s+|[\s\S]/gu) || [];
      let cur = [];
      let curW = 0;
      const flush = () => { const t = cur.join('').replace(/\s+$/, ''); if (t) lines.push(t); cur = []; curW = 0; };
      for (const tok of tokens) {
        if (/^\s+$/.test(tok)) { if (cur.length) { cur.push(' '); curW += width(' '); } continue; }
        const w = width(tok);
        if (curW + w > maxW && cur.length) {
          if (CLOSERS.has(tok) && curW + w <= maxW * 1.06) { cur.push(tok); curW += w; continue; }   // 줄 끝에 매달기
          const carry = [];
          while (cur.length && OPENERS.has(cur[cur.length - 1])) carry.unshift(cur.pop());              // 여는 괄호는 다음 줄로
          flush();
          cur = carry; curW = width(carry.join(''));
        }
        // 영문 단어 하나가 한 줄보다 길면 글자 단위로 자른다
        if (w > maxW && /^[A-Za-z0-9]/.test(tok)) {
          let part = '';
          for (const ch of tok) { if (width(part + ch) > maxW && part) { cur.push(part); flush(); part = ch; } else part += ch; }
          cur.push(part); curW = width(part);
          continue;
        }
        cur.push(tok); curW += w;
      }
      flush();
    }
    return lines;
  }

  // 한글은 글자 단위, 영문은 단어 단위로 줄바꿈한다. 줄머리에 문장부호가 오지 않게 한다.
  function wrap(text, size, weight, maxW) {
    if (CUR.wrap === 'cjk') return wrapCjk(text, size, weight, maxW);
    const c = mctx();
    c.font = fontOf(size, weight);
    const lines = [];
    for (const para of String(text).split('\n')) {
      if (!para.trim()) { lines.push(''); continue; }
      let line = '';
      const tokens = para.match(/\S+\s*|\s+/g) || [];
      for (const tok of tokens) {
        const tryLine = line + tok;
        if (c.measureText(tryLine.replace(/\s+$/, '')).width <= maxW) { line = tryLine; continue; }
        if (line) { lines.push(line.replace(/\s+$/, '')); line = ''; }
        // 토큰 하나가 한 줄보다 길면 글자 단위로 자른다.
        let cur = '';
        for (const ch of tok) {
          if (c.measureText((cur + ch).replace(/\s+$/, '')).width > maxW && cur) {
            if (/^[.,!?)\]}%:;、。」』]/.test(ch) && cur.length > 1) { lines.push(cur.slice(0, -1)); cur = cur.slice(-1) + ch; } else { lines.push(cur); cur = ch; }
          } else cur += ch;
        }
        line = cur;
      }
      if (line) lines.push(line.replace(/\s+$/, ''));
    }
    return lines;
  }

  class Layout {
    constructor(pal, opts) {
      this.pal = pal; this.opts = opts; this.ops = []; this.y = 0; this.bg = pal.bg;
      this.radius = pal.radius || 20;
      this.empty = true;
    }
    gap(h) { this.y += h; }
    mark() { this.empty = false; }
    text(str, o) {
      str = String(str == null ? '' : str);
      if (!str.trim()) return 0;
      const size = o.size, weight = o.weight || 400, lh = Math.round(size * (o.lh || 1.5));
      const x = o.x != null ? o.x : PADX;
      const maxW = o.w != null ? o.w : INNER;
      const lines = wrap(str, size, weight, maxW);
      const align = o.align || 'left';
      const tx = align === 'center' ? x + maxW / 2 : align === 'right' ? x + maxW : x;
      lines.forEach((ln, i) => {
        if (ln) this.ops.push({ t: 'text', s: ln, x: tx, y: this.y + i * lh + lh / 2, size, weight, color: o.color, align, ls: CUR.wrap === 'cjk' ? 0 : (o.ls || 0) });
      });
      const h = lines.length * lh;
      this.y += h;
      this.mark();
      return h;
    }
    rect(x, y, w, h, fill, r, stroke) { this.ops.push({ t: 'rect', x, y, w, h, fill, r: r == null ? this.radius : r, stroke }); }
    circle(cx, cy, r, fill) { this.ops.push({ t: 'circle', cx, cy, r, fill }); }
    // 이미지 슬롯. 보이면 높이를 반환하고, 건너뛰면 0.
    image(slot, x, w, o) {
      o = o || {};
      if (!slot || slot.deleted) return 0;
      const pending = this.opts.pending && this.opts.pending.has(slot.id);
      if (!slot.assetId && !pending) return 0;
      const img = slot.assetId ? this.opts.getImage(slot.assetId) : null;
      const [aw, ah] = (slot.aspect || '1:1').split(':').map(Number);
      let ratio = aw / ah || 1;
      if (img && img.naturalWidth) ratio = Math.max(0.66, Math.min(1.6, img.naturalWidth / img.naturalHeight));
      if (o.ratio) ratio = o.ratio;
      if (!img && !this.opts.preview) return 0; // 저장본에는 불러오지 못한 이미지를 넣지 않는다
      const h = Math.round(w / ratio);
      if (img) this.ops.push({ t: 'img', img, x, y: this.y, w, h, r: o.r == null ? 0 : o.r });
      else this.ops.push({ t: 'ph', x, y: this.y, w, h, r: o.r == null ? 0 : o.r, label: pending ? '이미지 생성 중…' : '이미지 불러오는 중…' });
      this.y += h;
      this.mark();
      return h;
    }
  }

  // ───────────── 블록별 배치 ─────────────
  function T(L, str, size, weight, color, extra) { return L.text(str, Object.assign({ size, weight, color }, extra || {})); }

  const LAYOUT = {
    info(L, f, b) {
      const p = L.pal; L.bg = p.surface;
      L.gap(84);
      if (f.eyebrow) { T(L, f.eyebrow, 22, 700, p.accent, { ls: 1 }); L.gap(14); }
      if (f.title) { T(L, f.title, 52, 800, p.ink, { lh: 1.28 }); L.gap(18); }
      if (f.subtitle) { T(L, f.subtitle, 28, 400, p.sub, { lh: 1.6 }); L.gap(34); }
      const rows = (f.rows || []).filter((r) => r.label || r.value);
      rows.forEach((r, i) => {
        L.rect(PADX, L.y, INNER, 2, rgba(p.ink, 0.1), 0);
        L.gap(22);
        const y0 = L.y;
        const h1 = T(L, r.label, 24, 700, p.sub, { w: 200 });
        L.y = y0;
        const h2 = T(L, r.value, 26, 500, p.ink, { x: PADX + 220, w: INNER - 220 });
        L.y = y0 + Math.max(h1, h2) + 22;
        if (i === rows.length - 1) L.rect(PADX, L.y, INNER, 2, rgba(p.ink, 0.1), 0);
      });
      L.gap(84);
    },
    promo(L, f) {
      const p = L.pal; L.bg = p.bg;
      if (!f.title && !f.desc && !f.badge) return;
      L.gap(56);
      const top = L.y;
      const inner = INNER - 88;
      L.gap(46);
      if (f.badge) {
        const c = mctx(); c.font = fontOf(20, 700);
        const bw = Math.ceil(c.measureText(f.badge).width) + 36;
        L.rect(PADX + 44, L.y, bw, 40, rgba(p.onAccent, 0.2), 20);
        L.ops.push({ t: 'text', s: f.badge, x: PADX + 44 + 18, y: L.y + 21, size: 20, weight: 700, color: p.onAccent, align: 'left', ls: 0 });
        L.gap(40 + 22); L.mark();
      }
      if (f.title) { T(L, f.title, 40, 800, p.onAccent, { x: PADX + 44, w: inner, lh: 1.3 }); L.gap(12); }
      if (f.desc) { L.ops.push({ t: 'alpha', a: 0.92 }); T(L, f.desc, 26, 400, p.onAccent, { x: PADX + 44, w: inner, lh: 1.6 }); L.ops.push({ t: 'alpha', a: 1 }); }
      L.gap(46);
      L.ops.unshift({ t: 'rect', x: PADX, y: top, w: INNER, h: L.y - top, fill: p.accent, r: L.radius + 4 });
      L.gap(56);
    },
    hero(L, f, b) {
      const p = L.pal; L.bg = p.bg;
      const slot = b.images[0];
      const h = L.image(slot, 0, W, { r: 0 });
      L.gap(h ? 72 : 120);
      if (f.title || f.subtitle) L.rect((W - 64) / 2, L.y, 64, 6, p.accent, 3);
      if (f.title || f.subtitle) L.gap(34);
      if (f.title) { T(L, f.title, 54, 800, p.ink, { align: 'center', lh: 1.25 }); L.gap(20); }
      if (f.subtitle) { T(L, f.subtitle, 28, 400, p.sub, { align: 'center', lh: 1.65 }); }
      L.gap(h ? 96 : 120);
    },
    headline(L, f) {
      const p = L.pal; L.bg = p.tint;
      L.gap(104);
      if (f.kicker) { T(L, f.kicker, 24, 700, p.accent, { align: 'center', ls: 1 }); L.gap(18); }
      if (f.title) { T(L, f.title, 46, 800, p.ink, { align: 'center', lh: 1.35 }); L.gap(48); }
      (f.points || []).forEach((pt) => {
        const top = L.y;
        const lines = wrap(pt, 28, 600, INNER - 96);
        const h = lines.length * 44 + 64;
        L.rect(PADX, top, INNER, h, p.surface, L.radius);
        L.rect(PADX, top + 28, 8, h - 56, p.accent, 4);
        L.y = top + 32;
        T(L, pt, 28, 600, p.ink, { x: PADX + 48, w: INNER - 96, lh: 1.57 });
        L.y = top + h + 22;
      });
      L.gap(82);
    },
    mood(L, f, b) {
      const p = L.pal; L.bg = p.bg;
      const h = L.image(b.images[0], 0, W, { r: 0 });
      if (!f.title && !f.text) return;
      L.gap(h ? 80 : 110);
      if (f.title) { T(L, f.title, 42, 800, p.ink, { align: 'center', lh: 1.35 }); L.gap(24); }
      if (f.text) T(L, f.text, 28, 400, p.sub, { align: 'center', lh: 1.85, x: PADX + 24, w: INNER - 48 });
      L.gap(h ? 100 : 110);
    },
    intro(L, f) {
      const p = L.pal; L.bg = p.surface;
      if (!f.title && !f.body) return;
      L.gap(100);
      L.rect(PADX, L.y, 56, 6, p.accent, 3); L.gap(32);
      if (f.title) { T(L, f.title, 44, 800, p.ink, { lh: 1.3 }); L.gap(34); }
      if (f.body) {
        const paras = f.body.split(/\n{1,}/).filter((s) => s.trim());
        paras.forEach((para, i) => { T(L, para, 28, 400, p.sub, { lh: 1.8 }); if (i < paras.length - 1) L.gap(26); });
      }
      L.gap(100);
    },
    features(L, f, b) {
      const p = L.pal; L.bg = p.bg;
      const items = (f.items || []).filter((i) => i.title || i.desc);
      const slot = b.images[0];
      const hasImg = slot && !slot.deleted && (slot.assetId || (L.opts.pending && L.opts.pending.has(slot.id)));
      if (!f.title && !items.length && !hasImg) return;
      L.gap(100);
      if (f.title) { T(L, f.title, 44, 800, p.ink, { align: 'center', lh: 1.3 }); L.gap(46); }
      if (hasImg && L.image(slot, PADX, INNER, { r: L.radius })) L.gap(38);
      items.forEach((it, i) => {
        const top = L.y;
        const tl = it.title ? wrap(it.title, 32, 800, INNER - 80).length * 46 : 0;
        const dl = it.desc ? wrap(it.desc, 26, 400, INNER - 80).length * 42 : 0;
        const h = 44 + 36 + 14 + tl + (tl && dl ? 12 : 0) + dl + 44;
        L.rect(PADX, top, INNER, h, p.surface, L.radius);
        L.y = top + 40;
        T(L, String(i + 1).padStart(2, '0'), 28, 800, p.accent, { x: PADX + 40, w: 200, lh: 1.3 }); L.gap(14);
        if (it.title) T(L, it.title, 32, 800, p.ink, { x: PADX + 40, w: INNER - 80, lh: 1.44 });
        if (it.title && it.desc) L.gap(12);
        if (it.desc) T(L, it.desc, 26, 400, p.sub, { x: PADX + 40, w: INNER - 80, lh: 1.62 });
        L.y = top + h + 24;
      });
      L.gap(76);
    },
    gallery(L, f, b) {
      const p = L.pal; L.bg = p.surface;
      const vis = b.images.filter((s) => !s.deleted && (s.assetId || (L.opts.pending && L.opts.pending.has(s.id))));
      if (!f.title && !f.caption && !vis.length) return;
      L.gap(100);
      if (f.title) { T(L, f.title, 44, 800, p.ink, { align: 'center', lh: 1.3 }); L.gap(44); }
      const colW = (INNER - 24) / 2;
      let i = 0;
      if (vis.length % 2 === 1) { L.image(vis[0], PADX, INNER, { r: L.radius, ratio: 1.2 }); L.gap(24); i = 1; }
      for (; i < vis.length; i += 2) {
        const y0 = L.y;
        const h = L.image(vis[i], PADX, colW, { r: L.radius, ratio: 1 });
        if (vis[i + 1]) { L.y = y0; L.image(vis[i + 1], PADX + colW + 24, colW, { r: L.radius, ratio: 1 }); }
        L.y = y0 + h + 24;
      }
      if (f.caption) { L.gap(10); T(L, f.caption, 26, 400, p.sub, { align: 'center', lh: 1.7 }); L.gap(10); }
      L.gap(76);
    },
    usage(L, f, b) {
      const p = L.pal; L.bg = p.tint;
      const steps = (f.steps || []).filter((s) => s.title || s.desc);
      const slot = b.images[0];
      const hasImg = slot && !slot.deleted && (slot.assetId || (L.opts.pending && L.opts.pending.has(slot.id)));
      if (!f.title && !steps.length && !hasImg) return;
      L.gap(100);
      if (f.title) { T(L, f.title, 44, 800, p.ink, { align: 'center', lh: 1.3 }); L.gap(46); }
      if (hasImg && L.image(slot, PADX, INNER, { r: L.radius })) L.gap(48);
      steps.forEach((s, i) => {
        const top = L.y;
        const tx = PADX + 92, tw = INNER - 92;
        L.y = top;
        const th = s.title ? T(L, s.title, 32, 800, p.ink, { x: tx, w: tw, lh: 1.4 }) : 0;
        if (s.title && s.desc) L.gap(8);
        const dh = s.desc ? T(L, s.desc, 26, 400, p.sub, { x: tx, w: tw, lh: 1.62 }) : 0;
        const bottom = Math.max(L.y, top + 64);
        L.circle(PADX + 32, top + 32, 32, p.accent);
        L.ops.push({ t: 'text', s: String(i + 1), x: PADX + 32, y: top + 33, size: 28, weight: 800, color: p.onAccent, align: 'center', ls: 0 });
        if (i < steps.length - 1) L.rect(PADX + 30, top + 72, 4, bottom + 36 - (top + 72) - 8, rgba(p.accent, 0.35), 2);
        L.y = bottom + 44;
        void th; void dh;
      });
      L.gap(56);
    },
    detail(L, f, b) {
      const p = L.pal; L.bg = p.bg;
      const items = (f.items || []).filter((i) => i.title || i.desc);
      const vis = b.images.filter((s) => !s.deleted && (s.assetId || (L.opts.pending && L.opts.pending.has(s.id))));
      if (!f.title && !items.length && !vis.length) return;
      L.gap(100);
      if (f.title) { T(L, f.title, 44, 800, p.ink, { align: 'center', lh: 1.3 }); L.gap(46); }
      const n = Math.max(vis.length, items.length);
      for (let i = 0; i < n; i++) {
        if (vis[i] && L.image(vis[i], PADX, INNER, { r: L.radius })) L.gap(28);
        const it = items[i];
        if (it) {
          if (it.title) T(L, it.title, 32, 800, p.ink, { lh: 1.4 });
          if (it.title && it.desc) L.gap(10);
          if (it.desc) T(L, it.desc, 26, 400, p.sub, { lh: 1.65 });
          L.gap(52);
        } else if (vis[i]) L.gap(24);
      }
      L.gap(48);
    },
    faq(L, f) {
      const p = L.pal; L.bg = p.surface;
      const faqs = (f.faqs || []).filter((x) => x.q || x.a);
      const specs = (f.specs || []).filter((x) => x.label || x.value);
      if (!faqs.length && !specs.length) return;
      L.gap(100);
      if (faqs.length) {
        T(L, f.title || '자주 묻는 질문', 44, 800, p.ink, { align: 'center', lh: 1.3 }); L.gap(46);
        faqs.forEach((x, i) => {
          const top = L.y;
          L.circle(PADX + 24, top + 28, 24, p.accent);
          L.ops.push({ t: 'text', s: 'Q', x: PADX + 24, y: top + 29, size: 24, weight: 800, color: p.onAccent, align: 'center', ls: 0 });
          T(L, x.q, 30, 700, p.ink, { x: PADX + 68, w: INNER - 68, lh: 1.5 });
          L.gap(14);
          if (x.a) { T(L, x.a, 26, 400, p.sub, { x: PADX + 68, w: INNER - 68, lh: 1.7 }); }
          L.gap(30);
          if (i < faqs.length - 1) { L.rect(PADX, L.y, INNER, 2, rgba(p.ink, 0.1), 0); L.gap(30); }
        });
        L.gap(34);
      }
      if (specs.length) {
        T(L, f.specTitle || '규격', 36, 800, p.ink, { align: 'center', lh: 1.3 }); L.gap(32);
        const top = L.y;
        const rowsH = [];
        specs.forEach((s) => {
          const a = wrap(s.label, 24, 700, 200).length, bl = wrap(s.value, 26, 500, INNER - 260).length;
          rowsH.push(Math.max(a * 38, bl * 40) + 40);
        });
        const total = rowsH.reduce((a, c) => a + c, 0);
        L.rect(PADX, top, INNER, total, p.bg, L.radius);
        let y = top;
        specs.forEach((s, i) => {
          L.y = y + 20;
          const y0 = L.y;
          T(L, s.label, 24, 700, p.sub, { x: PADX + 32, w: 200, lh: 1.58 });
          L.y = y0;
          T(L, s.value, 26, 500, p.ink, { x: PADX + 252, w: INNER - 284, lh: 1.55 });
          y += rowsH[i];
          if (i < specs.length - 1) L.rect(PADX + 24, y - 1, INNER - 48, 2, rgba(p.ink, 0.08), 0);
        });
        L.y = top + total;
      }
      L.gap(100);
    },
    cta(L, f) {
      const p = L.pal; L.bg = p.accent;
      if (!f.title && !f.desc && !f.buttonLabel) return;
      L.gap(120);
      if (f.title) { T(L, f.title, 48, 800, p.onAccent, { align: 'center', lh: 1.32 }); L.gap(20); }
      if (f.desc) { L.ops.push({ t: 'alpha', a: 0.92 }); T(L, f.desc, 28, 400, p.onAccent, { align: 'center', lh: 1.65 }); L.ops.push({ t: 'alpha', a: 1 }); L.gap(8); }
      if (f.buttonLabel) {
        L.gap(f.title || f.desc ? 44 : 0);
        const c = mctx(); c.font = fontOf(30, 800);
        const bw = Math.max(320, Math.ceil(c.measureText(f.buttonLabel).width) + 120), bh = 88;
        const bx = (W - bw) / 2;
        L.rect(bx, L.y, bw, bh, p.onAccent, bh / 2);
        L.ops.push({ t: 'text', s: f.buttonLabel, x: W / 2, y: L.y + bh / 2 + 1, size: 30, weight: 800, color: p.accent, align: 'center', ls: 0 });
        L.gap(bh); L.mark();
      }
      L.gap(120);
    },
  };

  /**
   * 블록 하나를 그려 캔버스를 돌려준다.
   * opts: { brief, getImage(assetId), scale, preview, pending:Set }
   * 내용이 없으면 { canvas:null, height:0 }.
   */
  function renderBlock(block, opts) {
    useLang(opts.lang || 'ko');
    try { return renderBlockInner(block, opts); } finally { useLang('ko'); }
  }
  function renderBlockInner(block, opts) {
    const pal = opts.brief.palette;
    const L = new Layout(pal, opts);
    const fn = LAYOUT[block.type];
    if (fn) fn(L, block.fields || {}, block);
    if (L.empty || L.y <= 0) return { canvas: null, height: 0 };
    const height = Math.ceil(L.y);
    const scale = opts.scale || 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(W * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = L.bg;
    ctx.fillRect(0, 0, W, height);
    ctx.textBaseline = 'middle';
    let alpha = 1;
    for (const op of L.ops) {
      if (op.t === 'alpha') { alpha = op.a; ctx.globalAlpha = alpha; continue; }
      if (op.t === 'rect') {
        ctx.fillStyle = op.fill;
        if (op.r > 0) { rrect(ctx, op.x, op.y, op.w, op.h, op.r); ctx.fill(); } else ctx.fillRect(op.x, op.y, op.w, op.h);
      } else if (op.t === 'circle') {
        ctx.fillStyle = op.fill; ctx.beginPath(); ctx.arc(op.cx, op.cy, op.r, 0, Math.PI * 2); ctx.fill();
      } else if (op.t === 'text') {
        ctx.font = fontOf(op.size, op.weight);
        ctx.fillStyle = op.color;
        ctx.textAlign = op.align;
        if ('letterSpacing' in ctx) ctx.letterSpacing = op.ls ? `${op.ls}px` : '0px';
        ctx.fillText(op.s, op.x, op.y);
      } else if (op.t === 'img') {
        const iw = op.img.naturalWidth, ih = op.img.naturalHeight;
        const sr = iw / ih, dr = op.w / op.h;
        let sx = 0, sy = 0, sw = iw, sh = ih;
        if (sr > dr) { sw = ih * dr; sx = (iw - sw) / 2; } else { sh = iw / dr; sy = (ih - sh) / 2; }
        ctx.save();
        if (op.r > 0) { rrect(ctx, op.x, op.y, op.w, op.h, op.r); ctx.clip(); }
        ctx.drawImage(op.img, sx, sy, sw, sh, op.x, op.y, op.w, op.h);
        ctx.restore();
      } else if (op.t === 'ph') {
        ctx.fillStyle = rgba(pal.accent, 0.12);
        if (op.r > 0) { rrect(ctx, op.x, op.y, op.w, op.h, op.r); ctx.fill(); } else ctx.fillRect(op.x, op.y, op.w, op.h);
        ctx.font = fontOf(24, 600); ctx.fillStyle = pal.sub; ctx.textAlign = 'center';
        ctx.fillText(op.label, op.x + op.w / 2, op.y + op.h / 2);
      }
    }
    ctx.globalAlpha = 1;
    return { canvas, height };
  }

  root.DPA_RENDER = { W, renderBlock, wrap, FAMILY, STACKS, fontOf, useLang, wrapCjk };
})(typeof window !== 'undefined' ? window : globalThis);

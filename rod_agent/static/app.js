"use strict";

const $ = (s) => document.querySelector(s);
const state = {
  status: null, mode: "auto", session: null, attachments: [], busy: false,
};

// ------------------------------------------------------------ 유틸
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function toast(msg, ms = 2600) {
  const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("hidden"), ms);
}
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: opts.body && !(opts.body instanceof FormData) ? { "Content-Type": "application/json" } : {},
    ...opts,
    body: opts.body && !(opts.body instanceof FormData) ? JSON.stringify(opts.body) : opts.body,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).detail || msg; } catch (_) { /* 본문 없음 */ }
    throw new Error(msg);
  }
  return res.json();
}
const fmtSize = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + "MB" : Math.max(1, Math.round(n / 1024)) + "KB";

// ------------------------------------------------------------ 마크다운 → HTML (화면 표시용)
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<i>$2</i>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
function md(src) {
  src = src.replace(/<!--\s*meta[\s\S]*?-->/g, "");
  const lines = src.split("\n");
  let html = "", i = 0, para = [];
  const flush = () => { if (para.length) { html += `<p>${inline(para.join(" "))}</p>`; para = []; } };
  while (i < lines.length) {
    const line = lines[i], t = line.trim();
    if (t.startsWith("```")) {
      flush(); const code = []; i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) code.push(lines[i++]);
      i++; html += `<pre><button class="copy-code sm">복사</button><code>${esc(code.join("\n"))}</code></pre>`; continue;
    }
    if (!t) { flush(); i++; continue; }
    let m;
    if ((m = t.match(/^(#{1,6})\s+(.*)$/))) { flush(); const l = Math.min(m[1].length, 4); html += `<h${l}>${inline(m[2])}</h${l}>`; i++; continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { flush(); html += "<hr>"; i++; continue; }
    if (t.startsWith("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flush();
      const row = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      html += "<table><thead><tr>" + row(t).map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>";
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        html += "<tr>" + row(lines[i]).map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>"; i++;
      }
      html += "</tbody></table>"; continue;
    }
    if (t.startsWith(">")) {
      flush(); const q = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) q.push(lines[i++].trim().replace(/^>\s?/, ""));
      html += `<blockquote>${inline(q.join(" "))}</blockquote>`; continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      flush();
      const stack = [];
      while (i < lines.length && (m = lines[i].match(/^(\s*)([-*•]|\d+[.)])\s+(.*)$/))) {
        const depth = Math.floor(m[1].replace(/\t/g, "    ").length / 2);
        const tag = /\d/.test(m[2]) ? "ol" : "ul";
        while (stack.length > depth + 1) html += `</li></${stack.pop()}>`;
        if (stack.length < depth + 1) { html += `<${tag}><li>`; stack.push(tag); }
        else html += "</li><li>";
        html += inline(m[3]); i++;
      }
      while (stack.length) html += `</li></${stack.pop()}>`;
      continue;
    }
    para.push(t); i++;
  }
  flush();
  return html;
}

// ------------------------------------------------------------ 모드·세션
function renderModes() {
  const nav = $("#modes"); nav.innerHTML = "";
  for (const m of state.status.modes) {
    const b = document.createElement("button");
    b.className = m.id === state.mode ? "active" : "";
    b.innerHTML = `<span>${m.icon}</span><span>${esc(m.label)}</span><span class="fmt">${m.format ? m.format.toUpperCase() : ""}</span>`;
    b.onclick = () => { setMode(m.id); if (state.session && state.session.messages.length) newSession(); closeSidebar(); };
    nav.appendChild(b);
  }
}
function setMode(id) {
  state.mode = id;
  const m = state.status.modes.find((x) => x.id === id) || state.status.modes[0];
  $("#modeTitle").textContent = `${m.icon} ${m.label}`;
  $("#fmtSel").options[0].textContent = m.format ? `모드 기본 (${m.format.toUpperCase()})` : "모드 기본 (없음)";
  const ex = $("#examples"); ex.innerHTML = "";
  for (const e of m.examples) {
    const b = document.createElement("button"); b.textContent = e;
    b.onclick = () => { $("#input").value = e; autoGrow(); $("#input").focus(); };
    ex.appendChild(b);
  }
  renderModes();
}
async function loadSessions() {
  const list = await api("/api/sessions");
  const ul = $("#sessions"); ul.innerHTML = "";
  for (const s of list) {
    const li = document.createElement("li");
    if (state.session && s.id === state.session.id) li.className = "active";
    li.innerHTML = `<span title="${esc(s.title)}">${esc(s.title)}</span><button title="삭제">✕</button>`;
    li.onclick = () => openSession(s.id);
    li.querySelector("button").onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`'${s.title}' 작업 기록을 삭제할까요?`)) return;
      await api(`/api/sessions/${s.id}`, { method: "DELETE" });
      if (state.session && state.session.id === s.id) await newSession();
      loadSessions();
    };
    ul.appendChild(li);
  }
}
async function newSession() {
  state.session = await api("/api/sessions", { method: "POST", body: { mode: state.mode } });
  $("#messages").innerHTML = ""; $("#welcome").classList.remove("hidden");
  loadSessions();
}
async function openSession(id) {
  const s = await api(`/api/sessions/${id}`);
  state.session = s; setMode(s.mode || "auto");
  const box = $("#messages"); box.innerHTML = "";
  $("#welcome").classList.toggle("hidden", s.messages.length > 0);
  s.messages.forEach((m, idx) => {
    if (m.role === "user") addUser(m.text, m.file_info || []);
    else {
      const el = addAssistant(); el.bubble.classList.remove("cursor"); el.bubble.innerHTML = md(m.text); bindCopy(el.bubble);
      addActions(el, idx);
      (s.outputs || []).filter((o) => o.index === idx).forEach((o) => addFileCard(el, o));
    }
  });
  loadSessions(); closeSidebar(); scrollEnd();
}

// ------------------------------------------------------------ 메시지 UI
function scrollEnd() { const c = $("#chat"); c.scrollTop = c.scrollHeight; }
function chipHtml(f) {
  return `<span class="chip ${f.status === "manual" ? "manual" : ""}" title="${esc(f.note || "")}">${f.status === "manual" ? "⚠ " : "📄 "}${esc(f.name)}</span>`;
}
function addUser(text, files) {
  const div = document.createElement("div"); div.className = "msg user";
  div.innerHTML = (files.length ? `<div class="files">${files.map(chipHtml).join("")}</div>` : "") +
    (text ? `<div class="bubble">${esc(text)}</div>` : "");
  $("#messages").appendChild(div); scrollEnd();
}
function addAssistant() {
  const div = document.createElement("div"); div.className = "msg assistant";
  const status = document.createElement("div"); status.className = "status";
  const bubble = document.createElement("div"); bubble.className = "bubble cursor";
  div.append(status, bubble); $("#messages").appendChild(div);
  return { div, status, bubble };
}
function bindCopy(root) {
  root.querySelectorAll(".copy-code").forEach((b) => {
    b.onclick = () => { navigator.clipboard.writeText(b.nextElementSibling.textContent); toast("복사했습니다"); };
  });
}
function addActions(el, index) {
  const bar = document.createElement("div"); bar.className = "actions";
  bar.innerHTML = `<span class="muted small">파일로 만들기</span>` +
    state.status.formats.map((f) => `<button class="sm" data-f="${f}">${f.toUpperCase()}</button>`).join("") +
    `<button class="sm ghost" data-copy="1">본문 복사</button>`;
  bar.onclick = async (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.copy) {
      const msg = state.session.messages[index];
      navigator.clipboard.writeText((msg ? msg.text : el.bubble.innerText).replace(/<!--\s*meta[\s\S]*?-->/g, "").trim());
      toast("복사했습니다"); return;
    }
    b.disabled = true;
    try {
      const info = await api("/api/render", { method: "POST", body: { session_id: state.session.id, index, format: b.dataset.f } });
      addFileCard(el, info); refreshOutputs();
    } catch (err) { toast("파일 생성 실패: " + err.message, 4000); }
    b.disabled = false;
  };
  el.div.appendChild(bar);
}
function addFileCard(el, info) {
  const card = document.createElement("div"); card.className = "filecard";
  card.innerHTML = `<span class="badge">${info.format.toUpperCase()}</span><span class="name" title="${esc(info.name)}">${esc(info.name)}</span>` +
    (info.valid ? `<span class="ok">✔ 검증 통과</span>` : `<span class="bad" title="${esc((info.errors || []).join("\n"))}">✖ 검증 실패</span>`) +
    `<button class="sm" data-open>열기</button><a href="/api/download/${encodeURIComponent(info.name)}"><button class="sm">받기</button></a>`;
  card.querySelector("[data-open]").onclick = () => api(`/api/open/${encodeURIComponent(info.name)}`, { method: "POST" }).catch((e) => toast(e.message));
  el.div.appendChild(card); scrollEnd();
}

// ------------------------------------------------------------ 전송
async function send() {
  if (state.busy) return;
  const text = $("#input").value.trim();
  const files = state.attachments.filter((f) => f.id);
  if (!text && !files.length) return;
  if (!state.status.has_key) { openSettings(); toast("먼저 API 키를 입력하세요."); return; }
  if (!state.session) await newSession();
  if (text === "리셋") { await newSession(); $("#input").value = ""; toast("새 작업으로 시작합니다."); return; }

  state.busy = true; $("#sendBtn").disabled = true;
  $("#welcome").classList.add("hidden");
  addUser(text, files);
  $("#input").value = ""; autoGrow();
  state.attachments = []; renderAttachments();

  const el = addAssistant();
  let acc = "", savedIndex = null, last = 0;
  el.status.textContent = "⏳ 요청 중…";
  try {
    const res = await fetch("/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: state.session.id, message: text, file_ids: files.map((f) => f.id), mode: state.mode,
        model: $("#modelSel").value, effort: $("#effortSel").value, web_search: $("#webChk").checked,
        format: $("#fmtSel").value,
      }),
    });
    if (!res.ok) { let d = res.statusText; try { d = (await res.json()).detail; } catch (_) { /* */ } throw new Error(d); }
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let k;
      while ((k = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, k); buf = buf.slice(k + 2);
        if (!chunk.startsWith("data: ")) continue;
        const ev = JSON.parse(chunk.slice(6));
        if (ev.type === "text") {
          acc += ev.text; el.status.textContent = "";
          const now = Date.now(); if (now - last > 80) { el.bubble.innerHTML = md(acc); last = now; scrollEnd(); }
        } else if (ev.type === "status") { el.status.textContent = ev.text; el.status.classList.remove("err"); }
        else if (ev.type === "error") { el.status.textContent = "⚠ " + ev.text; el.status.classList.add("err"); }
        else if (ev.type === "saved") { savedIndex = ev.index; }
        else if (ev.type === "file") { addFileCard(el, ev); refreshOutputs(); }
      }
    }
  } catch (err) {
    el.status.textContent = "⚠ " + err.message; el.status.classList.add("err");
  }
  el.bubble.classList.remove("cursor");
  if (acc) { el.bubble.innerHTML = md(acc); bindCopy(el.bubble); } else el.bubble.remove();
  if (savedIndex !== null) {
    state.session.messages[savedIndex - 1] = state.session.messages[savedIndex - 1] || { role: "user", text };
    state.session.messages[savedIndex] = { role: "assistant", text: acc };
    addActions(el, savedIndex);
    if (el.status.textContent.startsWith("📄")) el.status.textContent = "";
  }
  state.busy = false; $("#sendBtn").disabled = false; loadSessions(); scrollEnd();
}

// ------------------------------------------------------------ 첨부
function renderAttachments() {
  const box = $("#attachList"); box.innerHTML = "";
  state.attachments.forEach((f, i) => {
    const span = document.createElement("span");
    span.className = "chip" + (f.status === "manual" ? " manual" : "");
    span.title = f.note || "";
    span.innerHTML = `${f.uploading ? "⏳" : f.status === "manual" ? "⚠" : "📄"} ${esc(f.name)}${f.size ? " · " + fmtSize(f.size) : ""}<button title="빼기">✕</button>`;
    span.querySelector("button").onclick = () => { state.attachments.splice(i, 1); renderAttachments(); };
    box.appendChild(span);
  });
}
async function uploadFiles(fileList) {
  const files = [...fileList]; if (!files.length) return;
  const placeholders = files.map((f) => ({ name: f.name, uploading: true }));
  state.attachments.push(...placeholders); renderAttachments();
  const fd = new FormData(); files.forEach((f) => fd.append("files", f));
  try {
    const res = await api("/api/upload", { method: "POST", body: fd });
    state.attachments = state.attachments.filter((a) => !placeholders.includes(a)).concat(res);
    res.filter((r) => r.status === "manual").forEach((r) => toast(`⚠ ${r.name}: ${r.note}`, 5000));
  } catch (e) {
    state.attachments = state.attachments.filter((a) => !placeholders.includes(a));
    toast("업로드 실패: " + e.message, 4000);
  }
  renderAttachments();
}

// ------------------------------------------------------------ 산출물·설정
async function refreshOutputs() {
  const list = await api("/api/outputs");
  $("#outDir").textContent = state.status.output_dir;
  const ul = $("#outList"); ul.innerHTML = list.length ? "" : `<li class="muted">아직 만든 파일이 없습니다.</li>`;
  for (const f of list) {
    const li = document.createElement("li");
    li.innerHTML = `<span title="${esc(f.name)}">${esc(f.name)}</span><small class="muted">${fmtSize(f.size)}</small>` +
      `<button class="sm" data-open>열기</button><a href="/api/download/${encodeURIComponent(f.name)}"><button class="sm">받기</button></a>`;
    li.querySelector("[data-open]").onclick = () => api(`/api/open/${encodeURIComponent(f.name)}`, { method: "POST" }).catch((e) => toast(e.message));
    ul.appendChild(li);
  }
}
function openSettings() {
  $("#keyState").textContent = state.status.has_key ? "✔ API 키가 저장되어 있습니다." : "⚠ API 키가 없습니다. console.anthropic.com 에서 발급받아 입력하세요.";
  $("#dirInput").value = state.status.output_dir;
  $("#keyInput").value = "";
  $("#settings").classList.remove("hidden");
}
async function saveSettings() {
  const body = { output_dir: $("#dirInput").value, model: $("#defModelSel").value };
  if ($("#keyInput").value.trim()) body.api_key = $("#keyInput").value.trim();
  try {
    state.status = await api("/api/settings", { method: "POST", body });
    $("#settings").classList.add("hidden"); $("#modelSel").value = state.status.default_model;
    toast("저장했습니다"); refreshOutputs();
  } catch (e) { toast(e.message, 4000); }
}
function fillModels() {
  for (const sel of [$("#modelSel"), $("#defModelSel")]) {
    sel.innerHTML = Object.entries(state.status.models).map(([id, label]) => `<option value="${id}">${esc(label)}</option>`).join("");
    sel.value = state.status.default_model;
  }
}
function autoGrow() { const t = $("#input"); t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 220) + "px"; }
function closeSidebar() { $("#sidebar").classList.remove("open"); }

// ------------------------------------------------------------ 시작
async function init() {
  state.status = await api("/api/status");
  $("#ver").textContent = "v" + state.status.version;
  fillModels(); setMode("auto");
  try { const saved = localStorage.getItem("rod.prefs"); if (saved) { const p = JSON.parse(saved); $("#effortSel").value = p.effort || "medium"; $("#webChk").checked = !!p.web; } } catch (_) { /* 저장소 없음 */ }
  const sessions = await api("/api/sessions");
  if (sessions.length) await openSession(sessions[0].id); else await newSession();
  if (!state.status.has_key) openSettings();
  refreshOutputs();
}

$("#sendBtn").onclick = send;
$("#input").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
$("#input").addEventListener("input", autoGrow);
$("#newBtn").onclick = () => { newSession(); closeSidebar(); };
$("#attachBtn").onclick = () => $("#fileInput").click();
$("#fileInput").onchange = (e) => { uploadFiles(e.target.files); e.target.value = ""; };
$("#outputsBtn").onclick = () => { refreshOutputs(); $("#outputs").classList.add("open"); closeSidebar(); };
$("#openFolderBtn").onclick = () => api("/api/open-folder", { method: "POST" }).catch((e) => toast(e.message));
$("#settingsBtn").onclick = () => { openSettings(); closeSidebar(); };
$("#saveSettings").onclick = saveSettings;
$("#menuBtn").onclick = () => $("#sidebar").classList.toggle("open");
document.querySelectorAll("[data-close]").forEach((b) => b.onclick = () => {
  const id = b.dataset.close; const el = document.getElementById(id);
  if (el.classList.contains("drawer")) el.classList.remove("open"); else el.classList.add("hidden");
});
for (const id of ["effortSel", "webChk"]) {
  $("#" + id).addEventListener("change", () => {
    try { localStorage.setItem("rod.prefs", JSON.stringify({ effort: $("#effortSel").value, web: $("#webChk").checked })); } catch (_) { /* */ }
  });
}
let dragDepth = 0;
window.addEventListener("dragenter", (e) => { if (e.dataTransfer.types.includes("Files")) { dragDepth++; $("#dropzone").classList.remove("hidden"); } });
window.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; $("#dropzone").classList.add("hidden"); } });
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => { e.preventDefault(); dragDepth = 0; $("#dropzone").classList.add("hidden"); uploadFiles(e.dataTransfer.files); });
init().catch((e) => toast("서버 연결 실패: " + e.message, 6000));

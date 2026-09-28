'use strict';

// ===== 상수 =====
const M_TO_MPA = 0.01;            // 양정(m) → 압력(MPa) 환산계수 (현장 관용: 10 m ≈ 0.1 MPa)
const CHURN_MAX = 1.40;           // 체절운전: 정격토출압력의 140% 이하
const OVER_FLOW = 1.50;           // 과부하 운전: 정격토출량의 150%
const OVER_MIN = 0.65;            // 150% 운전 시 정격토출압력의 65% 이상
const FLOWMETER_MIN = 1.75;       // 유량계: 정격토출량의 175% 이상 측정 가능
const FLOW_TOL = 0.05;            // 유량 목표 허용 편차 ±5% (참고용)
const BAR_MAX = 160;              // 막대 게이지 최대 눈금(%)

const DRAFT_KEY = 'pumpgod.draft';
const RECORDS_KEY = 'pumpgod.records';
const SORT_KEY = 'pumpgod.recordSort';
const SITES_KEY = 'pumpgod.sites';
const VIDEO_URL = 'https://www.youtube.com/results?search_query=' + encodeURIComponent('소화펌프 성능시험 방법');

const FIELDS = ['site', 'head', 'flow', 'churn', 'q100', 'p100', 'q150', 'p150'];

const STEPS = [
  { key: 'churn', name: '체절운전', sub: '토출량 0% · 개폐밸브 잠금', flowKey: null, pKey: 'churn', mark: 140, rule: '상한 140%' },
  { key: 'rated', name: '정격운전', sub: '토출량 100%', flowKey: 'q100', pKey: 'p100', mark: 100, rule: '하한 100%' },
  { key: 'over', name: '최대운전', sub: '토출량 150%', flowKey: 'q150', pKey: 'p150', mark: 65, rule: '하한 65%' },
];

const $ = id => document.getElementById(id);
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const fmt = (v, d) => (v == null ? '-' : v.toFixed(d));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function storageGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function localStamp(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 2200);
}

// ===== 계산 =====
function readValues() {
  const v = {};
  for (const f of FIELDS) v[f] = $(f).value;
  return v;
}

function evaluate(v) {
  const head = num(v.head), flow = num(v.flow);
  const P = head != null && head > 0 ? head * M_TO_MPA : null;
  const Q = flow != null && flow > 0 ? flow : null;
  const m = {};
  for (const k of ['churn', 'q100', 'p100', 'q150', 'p150']) m[k] = num(v[k]);

  const target = { churn: 0, rated: Q, over: Q != null ? Q * OVER_FLOW : null };
  const steps = {};
  for (const s of STEPS) {
    const p = m[s.pKey];
    const pct = p != null && P ? (p / P) * 100 : null;
    let state = null;
    if (pct != null) state = s.key === 'churn' ? (pct <= s.mark ? 'ok' : 'bad') : (pct >= s.mark ? 'ok' : 'bad');
    let flowDev = null;
    if (s.flowKey && m[s.flowKey] != null && target[s.key]) flowDev = (m[s.flowKey] / target[s.key] - 1) * 100;
    steps[s.key] = { pct, state, flowDev, target: target[s.key] };
  }

  const states = STEPS.map(s => steps[s.key].state);
  const overall = states.every(Boolean) ? (states.includes('bad') ? 'bad' : 'ok') : null;
  return { P, Q, m, steps, overall };
}

// ===== 렌더링 =====
function buildSteps() {
  $('steps').innerHTML = STEPS.map(s => `
    <div class="step">
      <div class="step-head">
        <div class="step-name">${s.name}<small>${s.sub}</small></div>
        <span class="pill" id="pill-${s.key}">입력 대기</span>
      </div>
      <div class="${s.flowKey ? 'grid2' : ''}">
        ${s.flowKey ? `<label class="fld"><span>유량</span>
          <div class="unit-inp"><input id="${s.flowKey}" type="number" inputmode="decimal" step="any" placeholder="-"><em>LPM</em></div></label>` : ''}
        <label class="fld"><span>토출압력</span>
          <div class="unit-inp"><input id="${s.pKey}" type="number" inputmode="decimal" step="any" placeholder="-"><em>MPa</em></div></label>
      </div>
      <div class="bar"><div class="fill" id="fill-${s.key}"></div><div class="mark" style="left:${(s.mark / BAR_MAX) * 100}%"></div></div>
      <div class="bar-cap"><span id="cap-${s.key}">정격압 대비 -</span><span>${s.rule}</span></div>
      <div class="bar-cap" id="note-${s.key}"></div>
    </div>`).join('');
}

function render() {
  const v = readValues();
  const r = evaluate(v);
  const { P, Q } = r;

  $('topSub').textContent = v.site ? v.site : '소화펌프 성능시험';

  const stat = (label, val, unit) => `<div><span>${label}</span><strong>${val}</strong><small>${unit}</small></div>`;
  $('specStrip').innerHTML =
    stat('정격토출압력', fmt(P, 3), 'MPa') +
    stat('체절 상한 (140%)', fmt(P != null ? P * CHURN_MAX : null, 3), 'MPa') +
    stat('150% 운전 유량', fmt(Q != null ? Q * OVER_FLOW : null, 0), 'LPM') +
    stat('150% 압력 하한 (65%)', fmt(P != null ? P * OVER_MIN : null, 3), 'MPa');

  for (const s of STEPS) {
    const st = r.steps[s.key];
    if (s.flowKey) $(s.flowKey).placeholder = st.target ? `목표 ${st.target.toFixed(0)}` : '-';
    const pill = $('pill-' + s.key);
    pill.className = 'pill ' + (st.state || '');
    pill.textContent = st.state === 'ok' ? '적합' : st.state === 'bad' ? '부적합' : '입력 대기';
    const fill = $('fill-' + s.key);
    fill.className = 'fill ' + (st.state || '');
    fill.style.width = `${Math.min(st.pct ?? 0, BAR_MAX) / BAR_MAX * 100}%`;
    $('cap-' + s.key).innerHTML = `정격압 대비 <b>${st.pct != null ? st.pct.toFixed(1) + '%' : '-'}</b>`;
    const note = $('note-' + s.key);
    if (st.flowDev != null && Math.abs(st.flowDev) > FLOW_TOL * 100) {
      note.innerHTML = `<span class="pill warn">유량 확인</span><span>목표 유량과 ${st.flowDev > 0 ? '+' : ''}${st.flowDev.toFixed(1)}% 차이</span>`;
    } else note.innerHTML = '';
  }


  const vd = $('verdict');
  if (r.overall) {
    const ok = r.overall === 'ok';
    const fails = STEPS.filter(s => r.steps[s.key].state === 'bad').map(s => s.name);
    vd.className = 'result ' + r.overall;
    vd.innerHTML = `<span class="big">${ok ? '합격' : '불합격'}</span>
      <span>${ok ? '세 운전점 모두 성능 기준을 충족합니다' : esc(fails.join(', ')) + ' 기준 미달'}<small>체절 ≤140% · 정격 ≥100% · 150% 운전 ≥65%</small></span>`;
  } else {
    vd.className = 'result';
    vd.textContent = '펌프 사양과 세 운전점의 압력을 모두 입력하면 종합 판정이 나옵니다.';
  }

  $('flowmeterCalc').innerHTML = Q != null
    ? `정격토출량 ${Q} LPM → 유량계 최대 측정범위 <b>${(Q * FLOWMETER_MIN).toFixed(0)} LPM 이상</b><br>(150% 운전 유량 ${(Q * OVER_FLOW).toFixed(0)} LPM)`
    : '시험 탭에서 정격토출량을 입력하면 필요한 유량계 측정범위를 계산해 줍니다.';
  return r;
}

function niceStep(max, ticks) {
  const raw = max / ticks;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}

function chartSvg(r, opts = {}) {
  const W = 600, H = 380, L = 58, R = 18, T = 18, B = 52;
  const { P, Q, m } = r;

  const theory = P != null && Q != null ? [[0, P * CHURN_MAX], [Q, P], [Q * OVER_FLOW, P * OVER_MIN]] : [];
  const actual = [];
  if (m.churn != null) actual.push([0, m.churn]);
  if (m.q100 != null && m.p100 != null) actual.push([m.q100, m.p100]);
  if (m.q150 != null && m.p150 != null) actual.push([m.q150, m.p150]);

  const pts = [...theory, ...actual];
  const xMaxRaw = Math.max(Q ? Q * 1.75 : 0, ...pts.map(p => p[0]), 800);
  const yMaxRaw = Math.max(...pts.map(p => p[1]), 0.2) * 1.12;
  const xStep = niceStep(xMaxRaw, 6), yStep = niceStep(yMaxRaw, 5);
  const xMax = Math.ceil(xMaxRaw / xStep) * xStep, yMax = Math.ceil(yMaxRaw / yStep) * yStep;
  const px = x => L + (x / xMax) * (W - L - R);
  const py = y => H - B - (y / yMax) * (H - T - B);
  const yDec = Math.abs(yStep * 10 - Math.round(yStep * 10)) > 1e-9 ? 2 : 1;

  let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="Malgun Gothic, Noto Sans KR, sans-serif">`;
  s += `<rect width="${W}" height="${H}" fill="#fff"/>`;
  for (let y = 0; y <= yMax + 1e-9; y += yStep) {
    s += `<line x1="${L}" y1="${py(y)}" x2="${W - R}" y2="${py(y)}" stroke="#e7ebee"/>`;
    s += `<text x="${L - 8}" y="${py(y) + 4}" font-size="12" text-anchor="end" fill="#6b7a86">${y.toFixed(yDec)}</text>`;
  }
  for (let x = 0; x <= xMax + 1e-9; x += xStep) {
    s += `<line x1="${px(x)}" y1="${H - B}" x2="${px(x)}" y2="${H - B + 5}" stroke="#9aa7b1"/>`;
    s += `<text x="${px(x)}" y="${H - B + 19}" font-size="12" text-anchor="middle" fill="#6b7a86">${Math.round(x)}</text>`;
  }
  s += `<line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" stroke="#9aa7b1" stroke-width="1.5"/>`;
  s += `<line x1="${L}" y1="${T}" x2="${L}" y2="${H - B}" stroke="#9aa7b1" stroke-width="1.5"/>`;
  s += `<text x="${W - R}" y="${H - 8}" font-size="13" font-weight="700" text-anchor="end" fill="#0f2a3d">유량 Q (LPM)</text>`;
  s += `<text x="${L + 6}" y="${T + 12}" font-size="13" font-weight="700" fill="#0f2a3d">압력 P (MPa)</text>`;

  const path = a => a.map((p, i) => `${i ? 'L' : 'M'}${px(p[0]).toFixed(1)},${py(p[1]).toFixed(1)}`).join(' ');
  if (theory.length) {
    s += `<path d="${path(theory)}" fill="none" stroke="#8796a3" stroke-width="2" stroke-dasharray="7 5"/>`;
    const tags = ['140%', '100%', '65%'];
    theory.forEach((p, i) => {
      const x = px(p[0]), y = py(p[1]);
      s += `<rect x="${x - 6}" y="${y - 6}" width="12" height="12" fill="#f0a020" transform="rotate(45 ${x} ${y})"/>`;
      s += `<text x="${x + (i === 0 ? 10 : 0)}" y="${y + 22}" font-size="12" font-weight="700" text-anchor="${i === 0 ? 'start' : 'middle'}" fill="#b27400">${tags[i]}</text>`;
    });
  }
  if (actual.length) {
    s += `<path d="${path(actual)}" fill="none" stroke="#0fa39a" stroke-width="3.5" stroke-linejoin="round"/>`;
    actual.forEach(p => { s += `<circle cx="${px(p[0])}" cy="${py(p[1])}" r="6" fill="#fff" stroke="#0fa39a" stroke-width="3"/>`; });
  }
  if (opts.legend) {
    const y = T + 30;
    s += `<line x1="${W - 230}" y1="${y}" x2="${W - 205}" y2="${y}" stroke="#8796a3" stroke-width="2" stroke-dasharray="6 4"/><text x="${W - 199}" y="${y + 4}" font-size="12">기준 곡선</text>`;
    s += `<line x1="${W - 130}" y1="${y}" x2="${W - 105}" y2="${y}" stroke="#0fa39a" stroke-width="3.5"/><text x="${W - 99}" y="${y + 4}" font-size="12">측정 곡선</text>`;
  }
  return s + '</svg>';
}

const STRUCTURE_SVG = `
<svg class="struct-svg" viewBox="0 0 600 400" xmlns="http://www.w3.org/2000/svg" font-family="Malgun Gothic, Noto Sans KR, sans-serif" font-size="13">
  <defs><marker id="ar" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#0fa39a"/></marker></defs>
  <rect x="20" y="290" width="130" height="95" rx="4" fill="#e2f5f3" stroke="#0fa39a" stroke-width="2"/>
  <text x="85" y="372" text-anchor="middle" fill="#0b7a73" font-weight="700">수조</text>
  <path d="M60 345 V250 H200" fill="none" stroke="#0f2a3d" stroke-width="6"/>
  <rect x="52" y="338" width="16" height="14" fill="#0f2a3d"/><text x="76" y="340" fill="#333">풋밸브</text>
  <line x1="165" y1="238" x2="165" y2="250" stroke="#0f2a3d" stroke-width="2"/>
  <circle cx="165" cy="226" r="12" fill="#fff" stroke="#0f2a3d" stroke-width="2.5"/><text x="165" y="206" text-anchor="middle">연성계</text>
  <rect x="200" y="218" width="68" height="64" rx="10" fill="#0f2a3d"/><text x="234" y="255" text-anchor="middle" fill="#fff" font-weight="700">펌프</text>
  <rect x="210" y="290" width="48" height="30" rx="4" fill="#f0a020"/><text x="234" y="310" text-anchor="middle" font-weight="700" font-size="12">모터</text>
  <rect x="204" y="120" width="60" height="42" rx="4" fill="#e2f5f3" stroke="#0fa39a" stroke-width="2"/>
  <text x="234" y="110" text-anchor="middle">물올림탱크</text>
  <line x1="234" y1="162" x2="234" y2="218" stroke="#0f2a3d" stroke-width="3"/>
  <path d="M268 235 H300 V70 H585" fill="none" stroke="#0f2a3d" stroke-width="6"/>
  <line x1="300" y1="100" x2="316" y2="100" stroke="#0f2a3d" stroke-width="2"/>
  <circle cx="328" cy="100" r="12" fill="#fff" stroke="#0f2a3d" stroke-width="2.5"/><text x="346" y="105">압력계</text>
  <rect x="380" y="58" width="30" height="24" fill="#fff" stroke="#d64533" stroke-width="2.5"/><text x="395" y="48" text-anchor="middle" fill="#d64533">체크밸브</text>
  <path d="M450 58 L480 82 L480 58 L450 82 Z" fill="#fff" stroke="#0f2a3d" stroke-width="2.5"/><text x="465" y="48" text-anchor="middle">개폐밸브</text>
  <text x="585" y="98" text-anchor="end" fill="#0b7a73">→ 소화설비</text>
  <line x1="530" y1="70" x2="530" y2="120" stroke="#0f2a3d" stroke-width="4"/>
  <rect x="510" y="120" width="40" height="66" rx="18" fill="#fff" stroke="#0f2a3d" stroke-width="2"/><text x="530" y="205" text-anchor="middle">압력챔버</text>
  <path d="M300 150 H350 V172" fill="none" stroke="#0f2a3d" stroke-width="3"/>
  <rect x="342" y="172" width="16" height="20" fill="#f0a020"/>
  <text x="366" y="160" fill="#8a5a00">순환배관</text><text x="366" y="188" fill="#8a5a00">릴리프밸브</text>
  <path d="M300 235 V260 H580" fill="none" stroke="#0fa39a" stroke-width="5" marker-end="url(#ar)"/>
  <path d="M340 248 L366 272 L366 248 L340 272 Z" fill="#fff" stroke="#0f2a3d" stroke-width="2.5"/><text x="353" y="292" text-anchor="middle">개폐밸브</text>
  <rect x="405" y="242" width="62" height="36" rx="6" fill="#fff" stroke="#0fa39a" stroke-width="3"/><text x="436" y="265" text-anchor="middle" fill="#0b7a73" font-weight="700">유량계</text>
  <path d="M505 248 L531 272 L531 248 L505 272 Z" fill="#fff" stroke="#0f2a3d" stroke-width="2.5"/><text x="518" y="292" text-anchor="middle">유량조절밸브</text>
  <text x="440" y="326" text-anchor="middle" fill="#0b7a73" font-weight="700">성능시험배관</text>
  <text x="440" y="344" text-anchor="middle" fill="#6b7a86" font-size="12">체크밸브 이전 분기 · 유량계 175% 이상 측정</text>
</svg>`;

// ===== 저장/기록 =====
function saveDraft() { storageSet(DRAFT_KEY, readValues()); }
function fill(values) {
  for (const f of FIELDS) $(f).value = values?.[f] ?? '';
  render();
}

function saveRecord(silent) {
  const v = readValues();
  const r = evaluate(v);
  if (r.P == null || r.Q == null) { toast('정격양정과 정격토출량을 먼저 입력하세요'); return false; }
  const records = storageGet(RECORDS_KEY, []);
  const id = $('btnSave').dataset.editId || String(Date.now());
  const rec = { id, savedAt: new Date().toISOString(), values: v, overall: r.overall };
  const idx = records.findIndex(x => x.id === id);
  if (idx >= 0) records[idx] = rec; else records.unshift(rec);
  if (!storageSet(RECORDS_KEY, records)) { toast('저장 공간이 부족합니다'); return false; }
  $('btnSave').dataset.editId = id;
  const siteSaved = saveSite(v);
  if (!silent) toast((idx >= 0 ? '기록을 갱신했습니다' : '기록에 저장했습니다') + (siteSaved ? ' · 현장 저장됨' : ''));
  return true;
}

// ===== 현장 =====
// 현장명 기준으로 한 건씩 보관(같은 이름이면 양정·토출량을 최신값으로 갱신)
function saveSite(v) {
  const name = (v.site || '').trim();
  if (!name) return false;
  const sites = storageGet(SITES_KEY, []).filter(s => s.name !== name);
  sites.push({ name, head: v.head, flow: v.flow, updatedAt: new Date().toISOString() });
  return storageSet(SITES_KEY, sites);
}

// 현장 기능 이전에 저장된 기록에서 현장 목록을 한 번 만들어 둔다
function seedSitesFromRecords() {
  if (storageGet(SITES_KEY, null)) return;
  const records = storageGet(RECORDS_KEY, []).slice().sort((a, b) => (a.savedAt || '').localeCompare(b.savedAt || ''));
  const map = new Map();
  for (const rec of records) {
    const name = (rec.values.site || '').trim();
    if (name) map.set(name, { name, head: rec.values.head, flow: rec.values.flow, updatedAt: rec.savedAt });
  }
  storageSet(SITES_KEY, [...map.values()]);
}

function renderSites() {
  const sites = storageGet(SITES_KEY, []).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  $('sites').innerHTML = sites.length ? sites.map(s => `
    <div class="rec" data-name="${esc(s.name)}">
      <div class="rec-main"><b>${esc(s.name)}</b>
        <span>양정 ${esc(s.head)} m · ${esc(s.flow)} LPM · ${esc(localStamp(s.updatedAt))}</span></div>
      <span class="pill">불러오기</span>
      <button type="button" class="rec-del" aria-label="삭제">✕</button>
    </div>`).join('') : '<p class="empty">저장된 현장이 없습니다.<br>현장명을 입력하고 "기록 저장"을 누르면 여기에 등록됩니다.</p>';
}

function onSitesClick(e) {
  const item = e.target.closest('.rec');
  if (!item) return;
  const name = item.dataset.name;
  const sites = storageGet(SITES_KEY, []);
  if (e.target.closest('.rec-del')) {
    if (!confirm(`'${name}' 현장을 삭제할까요?\n(시험 기록은 그대로 남습니다)`)) return;
    storageSet(SITES_KEY, sites.filter(s => s.name !== name));
    renderSites();
    return;
  }
  const s = sites.find(x => x.name === name);
  if (!s) return;
  const cur = readValues();
  const hasMeasure = ['churn', 'q100', 'p100', 'q150', 'p150'].some(k => cur[k] !== '');
  if (hasMeasure && !confirm('입력 중인 측정값을 비우고 이 현장으로 새 시험을 시작할까요?')) return;
  fill({ site: s.name, head: s.head, flow: s.flow });
  delete $('btnSave').dataset.editId;
  saveDraft();
  showTab('test');
  toast(`'${s.name}' 현장을 불러왔습니다`);
}

function sortRecords(records, mode) {
  const byRecent = (a, b) => (b.savedAt || '').localeCompare(a.savedAt || '');
  if (mode !== 'name') return records.sort(byRecent);
  return records.sort((a, b) => {
    const sa = (a.values.site || '').trim(), sb = (b.values.site || '').trim();
    if (!sa !== !sb) return sa ? -1 : 1;           // 현장명 없는 기록은 맨 뒤
    return sa.localeCompare(sb, 'ko') || byRecent(a, b);
  });
}

function renderRecords() {
  const mode = storageGet(SORT_KEY, 'recent');
  for (const b of $('recSort').children) b.classList.toggle('on', b.dataset.sort === mode);
  const records = sortRecords(storageGet(RECORDS_KEY, []), mode);
  $('records').innerHTML = records.length ? records.map(rec => {
    const v = rec.values;
    const [cls, label] = rec.overall === 'ok' ? ['ok', '합격'] : rec.overall === 'bad' ? ['bad', '불합격'] : ['', '미판정'];
    return `<div class="rec" data-id="${esc(rec.id)}">
      <div class="rec-main"><b>${esc(v.site || '현장명 없음')}</b>
        <span>${esc(localStamp(rec.savedAt))} · 양정 ${esc(v.head)} m · ${esc(v.flow)} LPM</span></div>
      <span class="pill ${cls}">${label}</span>
      <button type="button" class="rec-del" aria-label="삭제">✕</button>
    </div>`;
  }).join('') : '<p class="empty">저장된 기록이 없습니다.<br>시험 탭에서 "기록 저장"을 누르면 여기에 쌓입니다.</p>';
}

function onRecordsClick(e) {
  const item = e.target.closest('.rec');
  if (!item) return;
  const id = item.dataset.id;
  const list = storageGet(RECORDS_KEY, []);
  if (e.target.closest('.rec-del')) {
    if (!confirm('이 기록을 삭제할까요?')) return;
    storageSet(RECORDS_KEY, list.filter(x => x.id !== id));
    if ($('btnSave').dataset.editId === id) delete $('btnSave').dataset.editId;
    renderRecords();
    return;
  }
  const rec = list.find(x => x.id === id);
  if (!rec) return;
  fill(rec.values);
  $('btnSave').dataset.editId = id;
  saveDraft();
  showTab('test');
  toast('기록을 불러왔습니다');
}

// ===== 탭 =====
function showTab(name) {
  for (const el of document.querySelectorAll('.tab')) el.hidden = el.id !== 'tab-' + name;
  for (const b of document.querySelectorAll('.tabbar button')) b.classList.toggle('on', b.dataset.tab === name);
  if (name === 'records') renderRecords();
  if (name === 'sites') renderSites();
  window.scrollTo(0, 0);
}

// ===== PDF =====
function svgToPng(svgText, width, height) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }));
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = width * 2; c.height = height * 2;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = e => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

async function makePdf() {
  const v = readValues();
  const r = evaluate(v);
  if (r.P == null || r.Q == null) { toast('정격양정과 정격토출량을 먼저 입력하세요'); return; }
  if (!window.html2canvas || !window.jspdf) { toast('PDF 모듈을 불러오지 못했습니다. 인터넷 연결을 확인하세요'); return; }

  const btn = $('btnPdf');
  btn.disabled = true;
  btn.textContent = '만드는 중…';
  try {
    saveRecord(true);
    const chartPng = await svgToPng(chartSvg(r, { legend: true }), 600, 380);
    const judge = s => s === 'ok' ? '<span class="ok">적합</span>' : s === 'bad' ? '<span class="bad">부적합</span>' : '-';
    const pct = st => st.pct != null ? st.pct.toFixed(1) + '%' : '-';
    const S = r.steps;
    const overall = r.overall === 'ok' ? '<span class="ok">합 격</span>' : r.overall === 'bad' ? '<span class="bad">불 합 격</span>' : '미판정';

    const host = $('reportHost');
    host.innerHTML = `
      <div class="report" id="reportDoc">
        <div class="rhead">
          <h1>소화펌프 성능시험 결과서</h1>
          <div class="rmeta">${esc(v.site) || '현장명 미기재'}<br>작성일 ${today()}</div>
        </div>
        <h2>■ 펌프 사양</h2>
        <table>
          <tr><th>정격양정</th><td>${esc(v.head)} m</td><th>정격토출압력</th><td>${r.P.toFixed(3)} MPa</td></tr>
          <tr><th>정격토출량</th><td>${r.Q} LPM</td><th>유량계 필요 측정범위</th><td>${(r.Q * FLOWMETER_MIN).toFixed(0)} LPM 이상</td></tr>
        </table>
        <h2>■ 운전점별 측정 결과</h2>
        <table>
          <tr><th>운전점</th><th>유량 (LPM)</th><th>압력 (MPa)</th><th>판정 기준</th><th>정격압 대비</th><th>판정</th></tr>
          <tr><td>체절운전</td><td>0</td><td>${fmt(r.m.churn, 3)}</td><td>${(r.P * CHURN_MAX).toFixed(3)} MPa 이하</td><td>${pct(S.churn)}</td><td>${judge(S.churn.state)}</td></tr>
          <tr><td>정격운전 (100%)</td><td>${fmt(r.m.q100, 1)}</td><td>${fmt(r.m.p100, 3)}</td><td>${r.P.toFixed(3)} MPa 이상</td><td>${pct(S.rated)}</td><td>${judge(S.rated.state)}</td></tr>
          <tr><td>최대운전 (150%)</td><td>${fmt(r.m.q150, 1)}</td><td>${fmt(r.m.p150, 3)}</td><td>${(r.P * OVER_MIN).toFixed(3)} MPa 이상</td><td>${pct(S.over)}</td><td>${judge(S.over.state)}</td></tr>
          <tr><th colspan="5">종합 판정</th><td style="font-size:16px">${overall}</td></tr>
        </table>
        <h2>■ 성능 곡선</h2>
        <img src="${chartPng}" alt="">
        <p class="foot">판정 기준: 체절운전 시 정격토출압력의 140% 이하, 정격토출량 150% 운전 시 정격토출압력의 65% 이상 (NFTC 103).<br>
        정격토출압력은 정격양정 × ${M_TO_MPA} MPa/m로 환산. 입력값 기반 참고 자료이며 법정 판단은 현행 기준과 교정된 계측값을 따릅니다.<br>펌프의신으로 작성</p>
      </div>`;

    const canvas = await window.html2canvas($('reportDoc'), { scale: 2, backgroundColor: '#ffffff' });
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const pw = 210, ph = 297;
    const ih = canvas.height * pw / canvas.width;
    const img = canvas.toDataURL('image/jpeg', 0.92);
    if (ih <= ph) pdf.addImage(img, 'JPEG', 0, 0, pw, ih);
    else pdf.addImage(img, 'JPEG', (pw - pw * ph / ih) / 2, 0, pw * ph / ih, ph);
    pdf.save(`펌프성능시험_${(v.site || '현장').replace(/[\\/:*?"<>|\s]+/g, '_')}_${today()}.pdf`);
    host.innerHTML = '';
    toast('PDF 보고서를 저장했습니다');
  } catch (e) {
    console.error(e);
    toast('PDF 생성 중 오류가 발생했습니다');
  } finally {
    btn.disabled = false;
    btn.textContent = 'PDF 보고서';
  }
}

// ===== 초기화 =====
function init() {
  buildSteps();
  $('appVer').textContent = typeof APP_VERSION === 'string' ? APP_VERSION : '';
  $('structureSvg').innerHTML = STRUCTURE_SVG;
  $('btnVideo').href = VIDEO_URL;

  seedSitesFromRecords();
  fill(storageGet(DRAFT_KEY, null));

  $('tab-test').addEventListener('input', e => {
    if (e.target.matches('input')) { render(); saveDraft(); }
  });
  for (const b of document.querySelectorAll('.tabbar button')) b.onclick = () => showTab(b.dataset.tab);
  $('records').addEventListener('click', onRecordsClick);
  $('sites').addEventListener('click', onSitesClick);
  $('methodSeg').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    for (const x of $('methodSeg').children) x.classList.toggle('on', x === b);
    for (const el of document.querySelectorAll('#tab-method .sub')) el.hidden = el.id !== 'sub-' + b.dataset.sub;
    window.scrollTo(0, 0);
  });
  $('recSort').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    storageSet(SORT_KEY, b.dataset.sort);
    renderRecords();
  });

  $('btnNew').onclick = () => {
    if (!confirm('입력값을 모두 비우고 새 시험을 시작할까요?\n(저장된 기록은 그대로 남습니다)')) return;
    fill(null);
    delete $('btnSave').dataset.editId;
    saveDraft();
    showTab('test');
  };
  $('btnSave').onclick = () => saveRecord(false);
  $('btnPdf').onclick = makePdf;
}

init();

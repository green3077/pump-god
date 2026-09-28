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

// 펌프는 주펌프 1대 + 예비펌프(선택) 1대
const PUMP_NAMES = ['주펌프', '예비펌프'];
const PUMP_FIELDS = ['head', 'flow', 'churn', 'q100', 'p100', 'q150', 'p150'];
const MEASURE_FIELDS = ['churn', 'q100', 'p100', 'q150', 'p150'];

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

// ===== 값 구조 =====
// values = { site, pumps: [{ head, flow, churn, q100, p100, q150, p150 }, ...] }
const emptyPump = () => Object.fromEntries(PUMP_FIELDS.map(f => [f, '']));

// 예전(펌프 1대, 평평한 구조) 기록·임시저장도 새 구조로 읽는다
function normalizeValues(v) {
  if (!v) return { site: '', pumps: [emptyPump()] };
  const src = Array.isArray(v.pumps) && v.pumps.length ? v.pumps : [v];
  const pumps = src.slice(0, PUMP_NAMES.length).map(p => Object.fromEntries(PUMP_FIELDS.map(f => [f, p?.[f] ?? ''])));
  return { site: v.site ?? '', pumps };
}

function pumpCount() { return document.querySelectorAll('#pumpSpecs .pump-spec').length; }

function readValues() {
  const pumps = [];
  for (let i = 0; i < pumpCount(); i++) {
    const p = {};
    for (const f of PUMP_FIELDS) p[f] = document.querySelector(`[data-p="${i}"][data-f="${f}"]`).value;
    pumps.push(p);
  }
  return { site: $('site').value, pumps };
}

// ===== 계산 =====
function evaluatePump(p) {
  const head = num(p.head), flow = num(p.flow);
  const P = head != null && head > 0 ? head * M_TO_MPA : null;
  const Q = flow != null && flow > 0 ? flow : null;
  const m = {};
  for (const k of MEASURE_FIELDS) m[k] = num(p[k]);

  const target = { churn: 0, rated: Q, over: Q != null ? Q * OVER_FLOW : null };
  const steps = {};
  for (const s of STEPS) {
    const pr = m[s.pKey];
    const pct = pr != null && P ? (pr / P) * 100 : null;
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

function evaluate(v) {
  const pumps = v.pumps.map(evaluatePump);
  const all = pumps.map(r => r.overall);
  const overall = all.every(Boolean) ? (all.includes('bad') ? 'bad' : 'ok') : null;
  return { pumps, overall };
}

// ===== 화면 구성 =====
function pumpSpecHtml(i) {
  const action = i === 0
    ? `<button type="button" class="mini-btn" id="btnAddPump">＋ 펌프 추가</button>`
    : `<button type="button" class="mini-btn danger" data-remove="${i}">삭제</button>`;
  const inp = (f, unit) => `<div class="unit-inp"><input data-p="${i}" data-f="${f}" type="number" inputmode="decimal" step="any" placeholder="0"><em>${unit}</em></div>`;
  return `
    <section class="panel pump-spec">
      <div class="panel-head">
        <div class="panel-title"><span class="num">0${i + 1}</span> 펌프사양(${PUMP_NAMES[i]})</div>
        ${action}
      </div>
      <div class="grid2">
        <label class="fld"><span>정격양정</span>${inp('head', 'm')}</label>
        <label class="fld"><span>정격토출량</span>${inp('flow', 'LPM')}</label>
      </div>
      <div class="spec-strip" id="strip-${i}"></div>
    </section>`;
}

function stepsHtml(i, multi) {
  const inp = (f, unit) => `<div class="unit-inp"><input data-p="${i}" data-f="${f}" type="number" inputmode="decimal" step="any" placeholder="-"><em>${unit}</em></div>`;
  return `
    <div class="pump-steps">
      ${multi ? `<div class="pump-label">${PUMP_NAMES[i]}</div>` : ''}
      ${STEPS.map(s => `
      <div class="step">
        <div class="step-head">
          <div class="step-name">${s.name}<small>${s.sub}</small></div>
          <span class="pill" id="pill-${i}-${s.key}">입력 대기</span>
        </div>
        <div class="${s.flowKey ? 'grid2' : ''}">
          ${s.flowKey ? `<label class="fld"><span>유량</span>${inp(s.flowKey, 'LPM')}</label>` : ''}
          <label class="fld"><span>토출압력</span>${inp(s.pKey, 'MPa')}</label>
        </div>
        <div class="bar"><div class="fill" id="fill-${i}-${s.key}"></div><div class="mark" style="left:${(s.mark / BAR_MAX) * 100}%"></div></div>
        <div class="bar-cap"><span id="cap-${i}-${s.key}">정격압 대비 -</span><span>${s.rule}</span></div>
        <div class="bar-cap" id="note-${i}-${s.key}"></div>
      </div>`).join('')}
    </div>`;
}

function buildPumps(n) {
  $('pumpSpecs').innerHTML = Array.from({ length: n }, (_, i) => pumpSpecHtml(i)).join('');
  $('steps').innerHTML = Array.from({ length: n }, (_, i) => stepsHtml(i, n > 1)).join('');
  $('btnAddPump').hidden = n >= PUMP_NAMES.length;
  $('stepsNum').textContent = '0' + (n + 1);
}

// ===== 렌더링 =====
function render() {
  const v = readValues();
  const r = evaluate(v);

  $('topSub').textContent = v.site ? v.site : '현장명 미입력';
  $('topSub').classList.toggle('empty', !v.site);

  const stat = (label, val, unit) => `<div><span>${label}</span><strong>${val}</strong><small>${unit}</small></div>`;
  r.pumps.forEach((pr, i) => {
    const { P, Q } = pr;
    $('strip-' + i).innerHTML =
      stat('정격토출압력', fmt(P, 3), 'MPa') +
      stat('체절 상한 (140%)', fmt(P != null ? P * CHURN_MAX : null, 3), 'MPa') +
      stat('150% 운전 유량', fmt(Q != null ? Q * OVER_FLOW : null, 0), 'LPM') +
      stat('150% 압력 하한 (65%)', fmt(P != null ? P * OVER_MIN : null, 3), 'MPa');

    for (const s of STEPS) {
      const st = pr.steps[s.key];
      if (s.flowKey) document.querySelector(`[data-p="${i}"][data-f="${s.flowKey}"]`).placeholder = st.target ? `목표 ${st.target.toFixed(0)}` : '-';
      const pill = $(`pill-${i}-${s.key}`);
      pill.className = 'pill ' + (st.state || '');
      pill.textContent = st.state === 'ok' ? '적합' : st.state === 'bad' ? '부적합' : '입력 대기';
      const fill = $(`fill-${i}-${s.key}`);
      fill.className = 'fill ' + (st.state || '');
      fill.style.width = `${Math.min(st.pct ?? 0, BAR_MAX) / BAR_MAX * 100}%`;
      $(`cap-${i}-${s.key}`).innerHTML = `정격압 대비 <b>${st.pct != null ? st.pct.toFixed(1) + '%' : '-'}</b>`;
      const note = $(`note-${i}-${s.key}`);
      if (st.flowDev != null && Math.abs(st.flowDev) > FLOW_TOL * 100) {
        note.innerHTML = `<span class="pill warn">유량 확인</span><span>목표 유량과 ${st.flowDev > 0 ? '+' : ''}${st.flowDev.toFixed(1)}% 차이</span>`;
      } else note.innerHTML = '';
    }
  });

  const multi = r.pumps.length > 1;
  const vd = $('verdict');
  if (r.overall) {
    const ok = r.overall === 'ok';
    const fails = [];
    r.pumps.forEach((pr, i) => {
      const bad = STEPS.filter(s => pr.steps[s.key].state === 'bad').map(s => s.name);
      if (bad.length) fails.push((multi ? PUMP_NAMES[i] + ' ' : '') + bad.join(', '));
    });
    vd.className = 'result ' + r.overall;
    vd.innerHTML = `<span class="big">${ok ? '합격' : '불합격'}</span>
      <span>${ok ? (multi ? '주펌프·예비펌프 모두 성능 기준을 충족합니다' : '세 운전점 모두 성능 기준을 충족합니다') : esc(fails.join(' / ')) + ' 기준 미달'}<small>체절 ≤140% · 정격 ≥100% · 150% 운전 ≥65%</small></span>`;
  } else {
    vd.className = 'result';
    vd.textContent = `펌프 사양과 세 운전점의 압력을 ${multi ? '펌프마다 ' : ''}모두 입력하면 종합 판정이 나옵니다.`;
  }

  const Q = r.pumps[0].Q;
  $('flowmeterCalc').innerHTML = Q != null
    ? `정격토출량 ${Q} LPM → 유량계 최대 측정범위 <b>${(Q * FLOWMETER_MIN).toFixed(0)} LPM 이상</b><br>(150% 운전 유량 ${(Q * OVER_FLOW).toFixed(0)} LPM)`
    : '시험 탭에서 정격토출량을 입력하면 필요한 유량계 측정범위를 계산해 줍니다.';
  return r;
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
  const v = normalizeValues(values);
  buildPumps(v.pumps.length);
  $('site').value = v.site;
  v.pumps.forEach((p, i) => {
    for (const f of PUMP_FIELDS) document.querySelector(`[data-p="${i}"][data-f="${f}"]`).value = p[f];
  });
  render();
}

function addPump() {
  const v = readValues();
  if (v.pumps.length >= PUMP_NAMES.length) return;
  v.pumps.push(emptyPump());
  fill(v);
  saveDraft();
  document.querySelector(`[data-p="${v.pumps.length - 1}"][data-f="head"]`).focus();
}

function removePump(i) {
  const v = readValues();
  const hasData = PUMP_FIELDS.some(f => v.pumps[i][f] !== '');
  if (hasData && !confirm(`${PUMP_NAMES[i]} 입력값을 삭제할까요?`)) return;
  v.pumps.splice(i, 1);
  fill(v);
  saveDraft();
}

function saveRecord(silent) {
  const v = readValues();
  const r = evaluate(v);
  if (r.pumps[0].P == null || r.pumps[0].Q == null) { toast('주펌프 정격양정과 정격토출량을 먼저 입력하세요'); return false; }
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
// 현장 = { name, pumps: [{ head, flow }], updatedAt } — 같은 이름이면 최신값으로 갱신
function siteSpecs(s) {
  return Array.isArray(s.pumps) && s.pumps.length ? s.pumps : [{ head: s.head ?? '', flow: s.flow ?? '' }];
}

function saveSite(values) {
  const v = normalizeValues(values);
  const name = (v.site || '').trim();
  if (!name) return false;
  const sites = storageGet(SITES_KEY, []).filter(s => s.name !== name);
  sites.push({ name, pumps: v.pumps.map(p => ({ head: p.head, flow: p.flow })), updatedAt: new Date().toISOString() });
  return storageSet(SITES_KEY, sites);
}

// 현장 기능 이전에 저장된 기록에서 현장 목록을 한 번 만들어 둔다
function seedSitesFromRecords() {
  if (storageGet(SITES_KEY, null)) return;
  const records = storageGet(RECORDS_KEY, []).slice().sort((a, b) => (a.savedAt || '').localeCompare(b.savedAt || ''));
  const map = new Map();
  for (const rec of records) {
    const v = normalizeValues(rec.values);
    const name = (v.site || '').trim();
    if (name) map.set(name, { name, pumps: v.pumps.map(p => ({ head: p.head, flow: p.flow })), updatedAt: rec.savedAt });
  }
  storageSet(SITES_KEY, [...map.values()]);
}

// 목록에 보여줄 펌프 요약: "양정 70 m · 520 LPM" (+ 예비펌프)
function specSummary(pumps) {
  const main = pumps[0] || {};
  return `양정 ${esc(main.head)} m · ${esc(main.flow)} LPM${pumps.length > 1 ? ' · 예비펌프 포함' : ''}`;
}

function renderSites() {
  const sites = storageGet(SITES_KEY, []).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  $('sites').innerHTML = sites.length ? sites.map(s => `
    <div class="rec" data-name="${esc(s.name)}">
      <div class="rec-main"><b>${esc(s.name)}</b>
        <span>${specSummary(siteSpecs(s))} · ${esc(localStamp(s.updatedAt))}</span></div>
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
  const hasMeasure = cur.pumps.some(p => MEASURE_FIELDS.some(k => p[k] !== ''));
  if (hasMeasure && !confirm('입력 중인 측정값을 비우고 이 현장으로 새 시험을 시작할까요?')) return;
  fill({ site: s.name, pumps: siteSpecs(s).map(p => ({ head: p.head, flow: p.flow })) });
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
    const v = normalizeValues(rec.values);
    const [cls, label] = rec.overall === 'ok' ? ['ok', '합격'] : rec.overall === 'bad' ? ['bad', '불합격'] : ['', '미판정'];
    return `<div class="rec" data-id="${esc(rec.id)}">
      <div class="rec-main"><b>${esc(v.site || '현장명 없음')}</b>
        <span>${esc(localStamp(rec.savedAt))} · ${specSummary(v.pumps)}</span></div>
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

// ===== 보고서 내보내기 (PDF / 이미지) =====
let lastExport = null;   // { file: File, url: string }

function reportPumpHtml(p, r, name) {
  const judge = s => s === 'ok' ? '<span class="ok">적합</span>' : s === 'bad' ? '<span class="bad">부적합</span>' : '-';
  const pct = st => st.pct != null ? st.pct.toFixed(1) + '%' : '-';
  const S = r.steps;
  const overall = r.overall === 'ok' ? '<span class="ok">합 격</span>' : r.overall === 'bad' ? '<span class="bad">불 합 격</span>' : '미판정';
  const P = r.P, Q = r.Q;
  return `
      <h2>■ 펌프 사양 (${name})</h2>
      <table>
        <tr><th>정격양정</th><td>${esc(p.head) || '-'} m</td><th>정격토출압력</th><td>${fmt(P, 3)} MPa</td></tr>
        <tr><th>정격토출량</th><td>${Q ?? '-'} LPM</td><th>유량계 필요 측정범위</th><td>${Q != null ? (Q * FLOWMETER_MIN).toFixed(0) + ' LPM 이상' : '-'}</td></tr>
      </table>
      <h2>■ 운전점별 측정 결과 (${name})</h2>
      <table>
        <tr><th>운전점</th><th>유량 (LPM)</th><th>압력 (MPa)</th><th>판정 기준</th><th>정격압 대비</th><th>판정</th></tr>
        <tr><td>체절운전</td><td>0</td><td>${fmt(r.m.churn, 3)}</td><td>${P != null ? (P * CHURN_MAX).toFixed(3) + ' MPa 이하' : '-'}</td><td>${pct(S.churn)}</td><td>${judge(S.churn.state)}</td></tr>
        <tr><td>정격운전 (100%)</td><td>${fmt(r.m.q100, 1)}</td><td>${fmt(r.m.p100, 3)}</td><td>${P != null ? P.toFixed(3) + ' MPa 이상' : '-'}</td><td>${pct(S.rated)}</td><td>${judge(S.rated.state)}</td></tr>
        <tr><td>최대운전 (150%)</td><td>${fmt(r.m.q150, 1)}</td><td>${fmt(r.m.p150, 3)}</td><td>${P != null ? (P * OVER_MIN).toFixed(3) + ' MPa 이상' : '-'}</td><td>${pct(S.over)}</td><td>${judge(S.over.state)}</td></tr>
        <tr><th colspan="5">판정 (${name})</th><td style="font-size:16px">${overall}</td></tr>
      </table>`;
}

function reportHtml(v, r) {
  return `
    <div class="report" id="reportDoc">
      <div class="rhead">
        <h1>소화펌프 성능시험 결과서 <span class="rmeta">(${esc(v.site) || '현장명 미기재'}, 작성일 ${today()})</span></h1>
      </div>
      ${v.pumps.map((p, i) => reportPumpHtml(p, r.pumps[i], PUMP_NAMES[i])).join('')}
    </div>`;
}

const canvasToBlob = (canvas, type, quality) => new Promise((resolve, reject) =>
  canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob 실패'))), type, quality));

async function pdfBlob(canvas) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const pw = 210, ph = 297;
  const ih = canvas.height * pw / canvas.width;
  const img = canvas.toDataURL('image/jpeg', 0.92);
  if (ih <= ph) pdf.addImage(img, 'JPEG', 0, 0, pw, ih);
  else pdf.addImage(img, 'JPEG', (pw - pw * ph / ih) / 2, 0, pw * ph / ih, ph);
  return pdf.output('blob');
}

// kind: 'pdf' | 'image'
async function exportReport(kind) {
  const v = readValues();
  const r = evaluate(v);
  if (r.pumps[0].P == null || r.pumps[0].Q == null) { toast('주펌프 정격양정과 정격토출량을 먼저 입력하세요'); return; }
  if (!window.html2canvas || (kind === 'pdf' && !window.jspdf)) { toast('보고서 모듈을 불러오지 못했습니다. 인터넷 연결을 확인하세요'); return; }

  const btn = $(kind === 'pdf' ? 'btnPdf' : 'btnImg');
  const label = btn.textContent;
  $('btnPdf').disabled = $('btnImg').disabled = true;
  btn.textContent = '만드는 중…';
  try {
    saveRecord(true);
    const host = $('reportHost');
    host.innerHTML = reportHtml(v, r);
    const canvas = await window.html2canvas($('reportDoc'), { scale: 2, backgroundColor: '#ffffff' });
    host.innerHTML = '';

    const base = `펌프성능시험_${(v.site || '현장').replace(/[\\/:*?"<>|\s]+/g, '_')}_${today()}`;
    const file = kind === 'pdf'
      ? new File([await pdfBlob(canvas)], base + '.pdf', { type: 'application/pdf' })
      : new File([await canvasToBlob(canvas, 'image/png')], base + '.png', { type: 'image/png' });
    if (lastExport) URL.revokeObjectURL(lastExport.url);
    lastExport = { file, url: URL.createObjectURL(file) };
    openShareSheet(kind);
  } catch (e) {
    console.error(e);
    toast('보고서 생성 중 오류가 발생했습니다');
  } finally {
    $('btnPdf').disabled = $('btnImg').disabled = false;
    btn.textContent = label;
  }
}

// 안드로이드 앱(Capacitor) 안에서는 WebView가 Web Share·다운로드 링크를 지원하지 않으므로
// Filesystem/Share 네이티브 플러그인으로 파일을 쓰고 공유한다. 웹(GitHub Pages)에서는 기존 방식 그대로.
const IS_NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const NativeFS = IS_NATIVE ? window.Capacitor.Plugins.Filesystem : null;
const NativeShare = IS_NATIVE ? window.Capacitor.Plugins.Share : null;
const SAVE_FOLDER = '펌프의신';

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1]);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

function canShareFile(file) {
  if (IS_NATIVE) return !!NativeShare;
  try { return !!(navigator.canShare && navigator.canShare({ files: [file] })); } catch { return false; }
}

function openShareSheet(kind) {
  $('sheetTitle').textContent = kind === 'pdf' ? '📄 PDF 보고서가 만들어졌습니다' : '🖼️ 보고서 이미지가 만들어졌습니다';
  $('shareName').textContent = lastExport.file.name;
  const ok = canShareFile(lastExport.file);
  $('btnShare').hidden = !ok;
  $('shareNote').hidden = ok;
  $('shareSheet').hidden = false;
}
function closeShareSheet() { $('shareSheet').hidden = true; }

// 공유창은 사용자가 버튼을 누른 순간에만 열 수 있어서, 파일을 만든 뒤 별도 버튼으로 공유한다
async function shareExport() {
  if (!lastExport) return;
  try {
    if (IS_NATIVE) {
      const { uri } = await NativeFS.writeFile({
        path: lastExport.file.name, data: await blobToBase64(lastExport.file), directory: 'CACHE',
      });
      await NativeShare.share({ title: '소화펌프 성능시험 결과서', files: [uri], dialogTitle: '공유하기' });
    } else {
      await navigator.share({ files: [lastExport.file], title: '소화펌프 성능시험 결과서' });
    }
    closeShareSheet();
  } catch (e) {
    const msg = String(e && (e.message || e.name) || '');
    if (e.name === 'AbortError' || /cancel/i.test(msg)) return;
    console.error(e);
    toast('공유하지 못했습니다. "기기에 저장"을 이용하세요');
  }
}

async function downloadExport() {
  if (!lastExport) return;
  if (IS_NATIVE) {
    try {
      await NativeFS.writeFile({
        path: `${SAVE_FOLDER}/${lastExport.file.name}`, data: await blobToBase64(lastExport.file),
        directory: 'DOCUMENTS', recursive: true,
      });
      toast(`내 파일 > Documents > ${SAVE_FOLDER} 폴더에 저장했습니다`);
    } catch (e) {
      console.error(e);
      toast('저장하지 못했습니다. "공유하기"로 다른 앱에 보내 주세요');
    }
    return;
  }
  const a = document.createElement('a');
  a.href = lastExport.url;
  a.download = lastExport.file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast('기기에 저장했습니다');
}

// 안드로이드 뒤로가기: 열린 창 닫기 → 시험 탭으로 → 앱 종료
function setupBackButton() {
  const App = IS_NATIVE && window.Capacitor.Plugins.App;
  if (!App) return;
  App.addListener('backButton', () => {
    if (!$('shareSheet').hidden) closeShareSheet();
    else if ($('tab-test').hidden) showTab('test');
    else App.exitApp();
  });
}

function startNewTest() {
  fill(null);
  delete $('btnSave').dataset.editId;
  saveDraft();
  showTab('test');
}

// ===== 초기화 =====
function init() {
  setupBackButton();
  $('appVer').textContent = typeof APP_VERSION === 'string' ? APP_VERSION : '';
  $('structureSvg').innerHTML = STRUCTURE_SVG;

  seedSitesFromRecords();
  fill(storageGet(DRAFT_KEY, null));

  $('tab-test').addEventListener('input', e => {
    if (e.target.matches('input')) { render(); saveDraft(); }
  });
  // 펌프 추가/삭제 버튼은 다시 그려지므로 위임으로 처리
  $('pumpSpecs').addEventListener('click', e => {
    if (e.target.closest('#btnAddPump')) addPump();
    const rm = e.target.closest('[data-remove]');
    if (rm) removePump(Number(rm.dataset.remove));
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
    startNewTest();
  };
  // 기록 저장이 끝나면 바로 새 시험으로 넘어간다
  $('btnSave').onclick = () => {
    if (saveRecord(false)) startNewTest();
  };
  $('btnPdf').onclick = () => exportReport('pdf');
  $('btnImg').onclick = () => exportReport('image');
  $('btnShare').onclick = shareExport;
  $('btnDownload').onclick = downloadExport;
  $('btnSheetClose').onclick = closeShareSheet;
  $('shareSheet').onclick = e => { if (e.target === $('shareSheet')) closeShareSheet(); };
}

init();

'use strict';

// ===== 상수 =====
const M_TO_MPA = 0.0098;          // 양정(m) → 압력(MPa) 환산계수 (ρg ≈ 9.8 kPa/m)
const CHURN_MAX = 1.40;           // 체절운전 시 정격토출압력의 140% 이하
const OVER_FLOW = 1.50;           // 정격토출량의 150%
const OVER_MIN = 0.65;            // 150% 운전 시 정격토출압력의 65% 이상
const FLOWMETER_MIN = 1.75;       // 유량측정장치: 정격토출량의 175% 이상 측정 가능
const FLOW_TOL = 0.05;            // 유량 목표치 허용 편차(±5%, 참고용)

const DRAFT_KEY = 'pumpgod.draft';
const RECORDS_KEY = 'pumpgod.records';
const VIDEO_URL = 'https://www.youtube.com/results?search_query=' + encodeURIComponent('소화펌프 성능시험 방법');

const BASIC_FIELDS = ['site', 'testDate', 'inspector', 'pumpName', 'head', 'flow'];

const MEASURES = [
  { key: 'churn', icon: '◔', iconClass: 'gauge', title: '체절운전시 압력 (MPa)', unit: 'MPa' },
  { key: 'q100',  icon: '💧', title: '정격부하(100%) 토출량 (LPM)', unit: 'LPM' },
  { key: 'p100',  icon: '◔', iconClass: 'gauge', title: '정격부하(100%) 토출압 (MPa)', unit: 'MPa' },
  { key: 'q150',  icon: '💧', title: '토출량 150% 지점의 유량 (LPM)', unit: 'LPM' },
  { key: 'p150',  icon: '◔', iconClass: 'gauge', title: '토출량 150% 시 토출압 (MPa)', unit: 'MPa' },
];
const ALL_FIELDS = [...BASIC_FIELDS, ...MEASURES.map(m => m.key)];

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
  for (const f of ALL_FIELDS) v[f] = $(f).value;
  return v;
}

function evaluate(v) {
  const head = num(v.head), flow = num(v.flow);
  const P = head != null && head > 0 ? head * M_TO_MPA : null;   // 정격토출압력
  const Q = flow != null && flow > 0 ? flow : null;               // 정격토출량
  const m = {};
  for (const k of ['churn', 'q100', 'p100', 'q150', 'p150']) m[k] = num(v[k]);

  const r = { P, Q, items: {} };

  // 각 항목: crit(기준 문구), pct(링 표시), state(ok/bad/info/null), msg
  const pctOf = (x, base) => (x != null && base ? (x / base) * 100 : null);

  r.items.churn = (() => {
    const lim = P != null ? P * CHURN_MAX : null;
    const pct = pctOf(m.churn, P);
    let state = null, msg = '';
    if (pct != null) {
      state = m.churn <= lim ? 'ok' : 'bad';
      msg = `정격토출압력 대비 ${pct.toFixed(1)}% (기준 140% 이하) → ${state === 'ok' ? '적합' : '부적합'}`;
    }
    return { crit: `기준: ${fmt(lim ?? 0, 3)} MPa 이하`, pct, state, msg };
  })();

  r.items.q100 = (() => {
    const pct = pctOf(m.q100, Q);
    let state = null, msg = '';
    if (pct != null) {
      state = Math.abs(pct - 100) <= FLOW_TOL * 100 ? 'info' : 'bad';
      msg = state === 'info' ? `정격토출량 대비 ${pct.toFixed(1)}%` : `정격토출량 대비 ${pct.toFixed(1)}% — 유량을 정격(100%)에 맞춰 측정하세요`;
    }
    return { crit: `이론치: ${fmt(Q ?? 0, 1)} LPM`, pct, state, msg };
  })();

  r.items.p100 = (() => {
    const pct = pctOf(m.p100, P);
    let state = null, msg = '';
    if (pct != null) {
      state = m.p100 >= P ? 'ok' : 'bad';
      msg = `정격토출압력 대비 ${pct.toFixed(1)}% (기준 100% 이상) → ${state === 'ok' ? '적합' : '부적합'}`;
    }
    return { crit: `기준: ${fmt(P ?? 0, 3)} MPa 이상`, pct, state, msg };
  })();

  r.items.q150 = (() => {
    const target = Q != null ? Q * OVER_FLOW : null;
    const pct = pctOf(m.q150, target);
    let state = null, msg = '';
    if (pct != null) {
      state = Math.abs(pct - 100) <= FLOW_TOL * 100 ? 'info' : 'bad';
      const ofRated = (m.q150 / Q) * 100;
      msg = state === 'info' ? `정격토출량 대비 ${ofRated.toFixed(1)}%` : `정격토출량 대비 ${ofRated.toFixed(1)}% — 유량을 150%에 맞춰 측정하세요`;
    }
    return { crit: `이론치: ${fmt(target ?? 0, 1)} LPM`, pct, state, msg };
  })();

  r.items.p150 = (() => {
    const lim = P != null ? P * OVER_MIN : null;
    const pct = pctOf(m.p150, P);
    let state = null, msg = '';
    if (pct != null) {
      state = m.p150 >= lim ? 'ok' : 'bad';
      msg = `정격토출압력 대비 ${pct.toFixed(1)}% (기준 65% 이상) → ${state === 'ok' ? '적합' : '부적합'}`;
    }
    return { crit: `기준: ${fmt(lim ?? 0, 3)} MPa 이상`, pct, state, msg };
  })();

  // 종합 판정: 압력 3항목이 모두 입력되어야 판정
  const judged = ['churn', 'p100', 'p150'].map(k => r.items[k].state);
  if (judged.every(s => s)) r.overall = judged.includes('bad') ? 'bad' : 'ok';
  else r.overall = null;

  r.m = m;
  return r;
}

// ===== 렌더링 =====
function buildMeasureCards() {
  const host = $('measureList');
  host.innerHTML = MEASURES.map(m => `
    <section class="card m-card">
      <div class="m-head">
        <div class="m-title"><span class="ic ${m.iconClass || ''}">${m.icon}</span>${m.title}</div>
        <div class="m-crit" id="crit-${m.key}"></div>
      </div>
      <div class="m-body">
        <input id="${m.key}" class="inp" type="number" inputmode="decimal" step="any" placeholder="실측값 입력">
        <div class="ring" id="ring-${m.key}">
          <svg viewBox="0 0 84 84"><circle cx="42" cy="42" r="35" fill="none" stroke="#eeeff2" stroke-width="9"/>
            <circle class="arc" cx="42" cy="42" r="35" fill="none" stroke="#3949ab" stroke-width="9" stroke-linecap="round"
              stroke-dasharray="219.9" stroke-dashoffset="219.9"/></svg>
          <div class="pct">0.0%</div>
        </div>
      </div>
      <p class="m-status" id="status-${m.key}"></p>
    </section>`).join('');
}

const STATE_COLOR = { ok: '#2e9d5b', bad: '#e0453f', info: '#3949ab' };

function render() {
  const v = readValues();
  const r = evaluate(v);

  $('headHint').textContent = r.P != null
    ? `정격토출압력 = ${num(v.head)} m × ${M_TO_MPA} = ${r.P.toFixed(3)} MPa`
    : `정격토출압력 = 양정 × ${M_TO_MPA} MPa`;

  for (const m of MEASURES) {
    const it = r.items[m.key];
    $('crit-' + m.key).textContent = it.crit;
    const ring = $('ring-' + m.key);
    const arc = ring.querySelector('.arc');
    const pct = it.pct ?? 0;
    const full = 2 * Math.PI * 35;
    arc.setAttribute('stroke-dashoffset', String(full * (1 - Math.min(pct, 100) / 100)));
    arc.setAttribute('stroke', STATE_COLOR[it.state] || '#3949ab');
    const pctEl = ring.querySelector('.pct');
    pctEl.textContent = `${pct.toFixed(1)}%`;
    pctEl.style.color = it.state === 'bad' ? STATE_COLOR.bad : it.state === 'ok' ? STATE_COLOR.ok : '#203a70';
    const st = $('status-' + m.key);
    st.textContent = it.msg;
    st.className = 'm-status ' + (it.state || '');
  }

  $('chart').innerHTML = chartSvg(r);

  const vd = $('verdict');
  if (r.overall === 'ok') {
    vd.className = 'verdict ok';
    vd.innerHTML = '✅ 종합 판정: 적합<small>체절 140% 이하 · 정격 100% 이상 · 150% 운전 시 65% 이상</small>';
  } else if (r.overall === 'bad') {
    const fails = MEASURES.filter(m => r.items[m.key].state === 'bad' && m.unit === 'MPa').map(m => m.title.replace(/ \(.*\)/, ''));
    vd.className = 'verdict bad';
    vd.innerHTML = `❌ 종합 판정: 부적합<small>${esc(fails.join(', '))}</small>`;
  } else {
    vd.className = 'verdict';
    vd.innerHTML = '정격양정·정격토출량과 압력 실측값을 모두 입력하면 종합 판정이 표시됩니다';
  }
  return r;
}

function niceStep(max, ticks) {
  const raw = max / ticks;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}

function chartSvg(r, opts = {}) {
  const W = 600, H = 420, L = 66, R = 20, T = 20, B = 62;
  const { P, Q, m } = r;

  const theory = P != null && Q != null
    ? [[0, P * CHURN_MAX], [Q, P], [Q * OVER_FLOW, P * OVER_MIN]] : [];
  const actual = [];
  if (m.churn != null) actual.push([0, m.churn]);
  if (m.q100 != null && m.p100 != null) actual.push([m.q100, m.p100]);
  if (m.q150 != null && m.p150 != null) actual.push([m.q150, m.p150]);

  const xsAll = [...theory, ...actual].map(p => p[0]);
  const ysAll = [...theory, ...actual].map(p => p[1]);
  const xMaxRaw = Math.max(Q ? Q * 1.75 : 0, ...xsAll, 900);
  const yMaxRaw = Math.max(...ysAll, 0.2) * 1.1;
  const xStep = niceStep(xMaxRaw, 8), yStep = niceStep(yMaxRaw, 6);
  const xMax = Math.ceil(xMaxRaw / xStep) * xStep, yMax = Math.ceil(yMaxRaw / yStep) * yStep;
  const px = x => L + (x / xMax) * (W - L - R);
  const py = y => H - B - (y / yMax) * (H - T - B);
  const yDec = yStep < 0.1 ? 2 : 1;

  let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="Malgun Gothic, Noto Sans KR, sans-serif">`;
  s += `<rect width="${W}" height="${H}" fill="#fff"/>`;
  for (let x = 0; x <= xMax + 1e-9; x += xStep) {
    s += `<line x1="${px(x)}" y1="${T}" x2="${px(x)}" y2="${H - B}" stroke="#eceef2"/>`;
    s += `<text x="${px(x)}" y="${H - B + 20}" font-size="13" text-anchor="middle" fill="#333">${Math.round(x)}</text>`;
  }
  for (let y = 0; y <= yMax + 1e-9; y += yStep) {
    s += `<line x1="${L}" y1="${py(y)}" x2="${W - R}" y2="${py(y)}" stroke="#eceef2"/>`;
    s += `<text x="${L - 8}" y="${py(y) + 4}" font-size="13" text-anchor="end" fill="#333">${y.toFixed(yDec)}</text>`;
  }
  s += `<rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="none" stroke="#d6d9e0"/>`;
  s += `<text x="${(L + W - R) / 2}" y="${H - 12}" font-size="15" font-weight="700" text-anchor="middle" fill="#e0453f">토출량 (LPM)</text>`;
  s += `<text transform="translate(18 ${(T + H - B) / 2}) rotate(-90)" font-size="15" font-weight="700" text-anchor="middle" fill="#3f88d6">압력 (MPa)</text>`;

  const path = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${px(p[0]).toFixed(1)},${py(p[1]).toFixed(1)}`).join(' ');
  if (theory.length) {
    s += `<path d="${path(theory)}" fill="none" stroke="#8fb4f0" stroke-width="3" stroke-dasharray="8 6"/>`;
    const labels = ['체절 140%', '정격 100%', '150% → 65%'];
    theory.forEach((p, i) => {
      s += `<circle cx="${px(p[0])}" cy="${py(p[1])}" r="5" fill="#fff" stroke="#8fb4f0" stroke-width="2.5"/>`;
      s += `<text x="${px(p[0]) + (i === 0 ? 8 : 0)}" y="${py(p[1]) - 10}" font-size="12" text-anchor="${i === 0 ? 'start' : 'middle'}" fill="#5b82c4">${labels[i]}</text>`;
    });
  }
  if (actual.length) {
    s += `<path d="${path(actual)}" fill="none" stroke="#e0453f" stroke-width="3.5" stroke-linejoin="round"/>`;
    actual.forEach(p => {
      s += `<circle cx="${px(p[0])}" cy="${py(p[1])}" r="5.5" fill="#e0453f"/>`;
    });
  }
  if (opts.legend) {
    const ly = T + 12;
    s += `<line x1="${W - 250}" y1="${ly}" x2="${W - 220}" y2="${ly}" stroke="#8fb4f0" stroke-width="3" stroke-dasharray="6 4"/>`;
    s += `<text x="${W - 214}" y="${ly + 4}" font-size="12">이론 성능선</text>`;
    s += `<line x1="${W - 130}" y1="${ly}" x2="${W - 100}" y2="${ly}" stroke="#e0453f" stroke-width="3.5"/>`;
    s += `<text x="${W - 94}" y="${ly + 4}" font-size="12">실제 측정선</text>`;
  }
  s += '</svg>';
  return s;
}

// ===== 저장/불러오기 =====
function saveDraft() { storageSet(DRAFT_KEY, readValues()); }
function fill(values) {
  for (const f of ALL_FIELDS) $(f).value = values?.[f] ?? '';
  if (!$('testDate').value) $('testDate').value = today();
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
  if (!storageSet(RECORDS_KEY, records)) { toast('저장 공간이 부족해 저장하지 못했습니다'); return false; }
  $('btnSave').dataset.editId = id;
  if (!silent) toast(idx >= 0 ? '목록의 기록을 수정했습니다' : '목록에 저장했습니다');
  return true;
}

function showList() {
  const records = storageGet(RECORDS_KEY, []);
  const body = records.length ? records.map(rec => {
    const v = rec.values;
    const badge = rec.overall === 'ok' ? ['ok', '적합'] : rec.overall === 'bad' ? ['bad', '부적합'] : ['none', '미판정'];
    return `<div class="rec-item" data-id="${esc(rec.id)}">
      <div class="rec-main"><b>${esc(v.site || '(현장명 없음)')} ${v.pumpName ? '· ' + esc(v.pumpName) : ''}</b>
        <span>${esc(v.testDate || '')} · 양정 ${esc(v.head)}m · ${esc(v.flow)}LPM</span></div>
      <span class="rec-badge ${badge[0]}">${badge[1]}</span>
      <button type="button" class="rec-del" aria-label="삭제">🗑</button>
    </div>`;
  }).join('') : '<p class="empty">저장된 시험 기록이 없습니다.<br>시험 수치 입력 후 "목록에 저장"을 누르세요.</p>';
  openModal('시험 기록 목록', body);

  $('modalBody').onclick = e => {
    const item = e.target.closest('.rec-item');
    if (!item) return;
    const id = item.dataset.id;
    const list = storageGet(RECORDS_KEY, []);
    if (e.target.closest('.rec-del')) {
      if (!confirm('이 기록을 삭제할까요?')) return;
      storageSet(RECORDS_KEY, list.filter(x => x.id !== id));
      if ($('btnSave').dataset.editId === id) delete $('btnSave').dataset.editId;
      showList();
      return;
    }
    const rec = list.find(x => x.id === id);
    if (!rec) return;
    fill(rec.values);
    $('btnSave').dataset.editId = id;
    saveDraft();
    closeModal();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast('기록을 불러왔습니다');
  };
}

// ===== 모달 =====
function openModal(title, html) {
  $('modalTitle').textContent = title;
  $('modalBody').innerHTML = html;
  $('modalBody').onclick = null;
  $('modal').hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeModal() {
  $('modal').hidden = true;
  document.body.style.overflow = '';
}

function showFlowmeter() {
  const r = evaluate(readValues());
  const calc = r.Q != null ? `
    <div class="calc-box">
      정격토출량 ${r.Q} LPM 기준<br>
      · 150% 운전 유량: <b>${(r.Q * OVER_FLOW).toFixed(1)} LPM</b><br>
      · 유량계 측정 필요 범위: <b>${(r.Q * FLOWMETER_MIN).toFixed(1)} LPM 이상</b><br>
      <small>→ 최대 측정범위가 ${(r.Q * FLOWMETER_MIN).toFixed(0)} LPM 이상인 유량계를 선정하세요.</small>
    </div>` : '<div class="calc-box">정격토출량을 입력하면 필요한 유량계 측정범위가 자동 계산됩니다.</div>';
  openModal('유량계 선정 기준', `
    ${calc}
    <h4>성능시험배관 설치기준 (NFTC 103 2.3.7)</h4>
    <ul>
      <li>성능시험배관은 펌프의 토출측에 설치된 <b>개폐밸브 이전</b>에서 분기하여 직선으로 설치하고, 유량측정장치를 기준으로 <b>전단 직관부에 개폐밸브</b>를, <b>후단 직관부에 유량조절밸브</b>를 설치할 것.</li>
      <li>유량측정장치는 성능시험배관의 직관부에 설치하되, 펌프의 <b>정격토출량의 175% 이상</b>까지 측정할 수 있는 성능이 있을 것.</li>
    </ul>
    <h4>현장 선정 시 참고</h4>
    <ul>
      <li>유량계 전·후단 직관 길이는 제조사 기준을 따르되, 일반적으로 전단 8D·후단 5D 이상을 권장합니다.</li>
      <li>유량계 구경은 성능시험배관 구경과 맞추고, 150% 유량이 눈금 범위 중간 이후에 오도록 고르면 판독이 쉽습니다.</li>
    </ul>
    <p class="hint">※ 최신 화재안전기술기준(NFTC)을 반드시 확인하세요.</p>`);
}

function showStructure() {
  openModal('펌프구조 (소화펌프 주변 배관)', `
    <svg class="struct-svg" viewBox="0 0 600 430" xmlns="http://www.w3.org/2000/svg" font-family="Malgun Gothic, Noto Sans KR, sans-serif" font-size="13">
      <defs><marker id="ar" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#3f88d6"/></marker></defs>
      <!-- 수조 -->
      <rect x="20" y="300" width="130" height="100" fill="#dcebfb" stroke="#3f88d6" stroke-width="2"/>
      <text x="85" y="390" text-anchor="middle" fill="#2a5d9c">수조</text>
      <!-- 흡입배관 -->
      <path d="M60 360 V250 H200" fill="none" stroke="#555" stroke-width="6"/>
      <rect x="52" y="352" width="16" height="14" fill="#555"/><text x="76" y="352" fill="#333">풋밸브</text>
      <circle cx="170" cy="230" r="12" fill="#fff" stroke="#8a4fd8" stroke-width="2.5"/><line x1="170" y1="242" x2="170" y2="250" stroke="#8a4fd8" stroke-width="2"/>
      <text x="170" y="210" text-anchor="middle" fill="#8a4fd8">연성계</text>
      <!-- 펌프 + 모터 -->
      <circle cx="235" cy="250" r="34" fill="#3949ab"/><text x="235" y="255" text-anchor="middle" fill="#fff" font-weight="700">펌프</text>
      <rect x="200" y="292" width="90" height="36" rx="6" fill="#f2b632"/><text x="245" y="315" text-anchor="middle" font-weight="700">전동기</text>
      <!-- 물올림장치 -->
      <rect x="205" y="120" width="60" height="44" fill="#dcebfb" stroke="#3f88d6" stroke-width="2"/>
      <text x="235" y="110" text-anchor="middle">물올림탱크</text>
      <line x1="235" y1="164" x2="235" y2="216" stroke="#555" stroke-width="3"/>
      <!-- 토출배관 -->
      <path d="M235 216 V200 H300 V70 H580" fill="none" stroke="#555" stroke-width="6"/>
      <line x1="300" y1="100" x2="316" y2="100" stroke="#8a4fd8" stroke-width="2"/><circle cx="328" cy="100" r="12" fill="#fff" stroke="#8a4fd8" stroke-width="2.5"/>
      <text x="346" y="105" fill="#8a4fd8">압력계</text>
      <!-- 체크밸브 / 개폐밸브 -->
      <rect x="360" y="58" width="30" height="24" fill="#fff" stroke="#e0453f" stroke-width="2.5"/><text x="375" y="48" text-anchor="middle" fill="#e0453f">체크밸브</text>
      <path d="M440 58 L470 82 L470 58 L440 82 Z" fill="#fff" stroke="#333" stroke-width="2.5"/><text x="455" y="48" text-anchor="middle">개폐밸브</text>
      <text x="575" y="95" text-anchor="end" fill="#2a5d9c">→ 소화설비(옥내소화전 등)</text>
      <!-- 압력챔버 -->
      <line x1="520" y1="70" x2="520" y2="110" stroke="#555" stroke-width="4"/>
      <rect x="500" y="110" width="40" height="70" rx="18" fill="#eef0f7" stroke="#3949ab" stroke-width="2"/><text x="520" y="200" text-anchor="middle">압력챔버</text>
      <!-- 순환배관 -->
      <path d="M300 130 H340 V160" fill="none" stroke="#555" stroke-width="3"/>
      <rect x="332" y="160" width="16" height="20" fill="#f47f55"/>
      <text x="356" y="150" fill="#c65a33">순환배관</text><text x="356" y="176" fill="#c65a33">릴리프밸브</text>
      <!-- 성능시험배관 -->
      <path d="M300 250 H580" fill="none" stroke="#3f88d6" stroke-width="5" marker-end="url(#ar)"/>
      <path d="M300 200 V250" fill="none" stroke="#3f88d6" stroke-width="5"/>
      <path d="M345 238 L371 262 L371 238 L345 262 Z" fill="#fff" stroke="#333" stroke-width="2.5"/><text x="358" y="285" text-anchor="middle">개폐밸브</text>
      <rect x="410" y="232" width="60" height="36" rx="6" fill="#fff" stroke="#2e9d5b" stroke-width="3"/><text x="440" y="255" text-anchor="middle" fill="#2e9d5b" font-weight="700">유량계</text>
      <path d="M505 238 L531 262 L531 238 L505 262 Z" fill="#fff" stroke="#333" stroke-width="2.5"/><text x="518" y="285" text-anchor="middle">유량조절밸브</text>
      <text x="440" y="320" text-anchor="middle" fill="#2a5d9c" font-weight="700">성능시험배관 (체크밸브 이전 분기)</text>
      <text x="440" y="340" text-anchor="middle" fill="#666" font-size="12">직관부 · 정격토출량 175% 이상 측정 가능</text>
    </svg>
    <h4>주요 구성</h4>
    <ul>
      <li><b>연성계/진공계</b>: 흡입측 압력 측정 (수원이 펌프보다 낮을 때)</li>
      <li><b>압력계</b>: 토출측, 체크밸브 이전에 설치</li>
      <li><b>순환배관</b>: 체절운전 시 수온 상승 방지, 체절압력 미만에서 개방되는 릴리프밸브 설치</li>
      <li><b>성능시험배관</b>: 개폐밸브 → 유량계 → 유량조절밸브 순서</li>
      <li><b>물올림장치</b>: 수원의 수위가 펌프보다 낮을 때 설치</li>
    </ul>
    <h4>성능시험 순서 (요약)</h4>
    <ul>
      <li>① 토출측 개폐밸브 폐쇄, 성능시험배관 밸브 폐쇄 → 펌프 기동 → <b>체절압력</b> 확인</li>
      <li>② 성능시험배관 개폐밸브 개방, 유량조절밸브로 <b>정격토출량(100%)</b> 맞춘 뒤 압력 확인</li>
      <li>③ 유량조절밸브를 더 열어 <b>150% 유량</b>에서 압력 확인</li>
      <li>④ 시험 후 밸브를 원상태로 복구하고 제어반 자동 상태 확인</li>
    </ul>`);
}

// ===== PDF 보고서 =====
function svgToPng(svgText, width, height) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
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
  btn.textContent = 'PDF 만드는 중…';
  try {
    saveRecord(true);
    const chartPng = await svgToPng(chartSvg(r, { legend: true }), 600, 420);
    const judge = s => s === 'ok' ? '<span class="ok">적합</span>' : s === 'bad' ? '<span class="bad">부적합</span>' : '-';
    const it = r.items;
    const overall = r.overall === 'ok' ? '<span class="ok">적 합</span>' : r.overall === 'bad' ? '<span class="bad">부 적 합</span>' : '미판정(입력 부족)';

    const host = $('reportHost');
    host.innerHTML = `
      <div class="report" id="reportDoc">
        <h1>소화펌프 성능시험 보고서</h1>
        <div class="sub">펌프의신 · 작성일 ${esc(today())}</div>
        <h2>기본정보</h2>
        <table>
          <tr><th style="width:18%">현장명</th><td style="width:32%">${esc(v.site) || '-'}</td><th style="width:18%">점검일자</th><td>${esc(v.testDate) || '-'}</td></tr>
          <tr><th>펌프 구분</th><td>${esc(v.pumpName) || '-'}</td><th>점검자</th><td>${esc(v.inspector) || '-'}</td></tr>
          <tr><th>정격양정</th><td>${esc(v.head)} m</td><th>정격토출압력</th><td>${r.P.toFixed(3)} MPa</td></tr>
          <tr><th>정격토출량</th><td>${r.Q} LPM</td><th>유량계 필요범위</th><td>${(r.Q * FLOWMETER_MIN).toFixed(0)} LPM 이상</td></tr>
        </table>
        <h2>시험 결과</h2>
        <table>
          <tr><th>구분</th><th>유량 (LPM)</th><th>압력 (MPa)</th><th>기준</th><th>정격압 대비</th><th>판정</th></tr>
          <tr><td>체절운전 (0%)</td><td>0</td><td>${fmt(r.m.churn, 3)}</td><td>${(r.P * CHURN_MAX).toFixed(3)} 이하 (140%)</td><td>${it.churn.pct != null ? it.churn.pct.toFixed(1) + '%' : '-'}</td><td>${judge(it.churn.state)}</td></tr>
          <tr><td>정격부하 (100%)</td><td>${fmt(r.m.q100, 1)}</td><td>${fmt(r.m.p100, 3)}</td><td>${r.P.toFixed(3)} 이상 (100%)</td><td>${it.p100.pct != null ? it.p100.pct.toFixed(1) + '%' : '-'}</td><td>${judge(it.p100.state)}</td></tr>
          <tr><td>최대부하 (150%)</td><td>${fmt(r.m.q150, 1)}</td><td>${fmt(r.m.p150, 3)}</td><td>${(r.P * OVER_MIN).toFixed(3)} 이상 (65%)</td><td>${it.p150.pct != null ? it.p150.pct.toFixed(1) + '%' : '-'}</td><td>${judge(it.p150.state)}</td></tr>
          <tr><th colspan="5">종합 판정</th><td style="font-size:16px">${overall}</td></tr>
        </table>
        <h2>성능 곡선</h2>
        <img src="${chartPng}" alt="">
        <p class="foot">※ 기준: 체절운전 시 정격토출압력의 140% 이하, 정격토출량 150% 운전 시 정격토출압력의 65% 이상 (NFTC 103).<br>
        ※ 정격토출압력은 정격양정 × ${M_TO_MPA} MPa/m로 환산하였습니다. 본 보고서는 입력값을 바탕으로 작성된 참고자료입니다.</p>
        <div class="sign">점검자: ${esc(v.inspector) || '　　　　'} (서명)</div>
      </div>`;

    const canvas = await window.html2canvas($('reportDoc'), { scale: 2, backgroundColor: '#ffffff' });
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const pw = 210, ph = 297;
    const ih = canvas.height * pw / canvas.width;
    const img = canvas.toDataURL('image/jpeg', 0.92);
    if (ih <= ph) {
      pdf.addImage(img, 'JPEG', 0, 0, pw, ih);
    } else {
      const scale = ph / ih;   // 한 페이지에 맞춤
      pdf.addImage(img, 'JPEG', (pw - pw * scale) / 2, 0, pw * scale, ph);
    }
    const name = `펌프성능시험_${(v.site || '현장').replace(/[\\/:*?"<>|\s]+/g, '_')}_${v.testDate || today()}.pdf`;
    pdf.save(name);
    host.innerHTML = '';
    toast('PDF 보고서를 저장했습니다');
  } catch (e) {
    console.error(e);
    toast('PDF 생성 중 오류가 발생했습니다');
  } finally {
    btn.disabled = false;
    btn.textContent = '⬇ PDF 성능시험 보고서 생성';
  }
}

// ===== 초기화 =====
function init() {
  buildMeasureCards();
  $('btnVideo').href = VIDEO_URL;

  fill(storageGet(DRAFT_KEY, null));

  document.querySelector('main').addEventListener('input', e => {
    if (e.target.matches('input')) { render(); saveDraft(); }
  });

  $('btnNew').onclick = () => {
    if (!confirm('입력한 내용을 모두 지우고 새로 입력할까요?\n(목록에 저장된 기록은 유지됩니다)')) return;
    fill(null);
    delete $('btnSave').dataset.editId;
    saveDraft();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  $('btnList').onclick = showList;
  $('btnStructure').onclick = showStructure;
  $('btnFlowmeter').onclick = showFlowmeter;
  $('btnSave').onclick = () => saveRecord(false);
  $('btnPdf').onclick = makePdf;
  $('modalClose').onclick = closeModal;
  $('modal').onclick = e => { if (e.target === $('modal')) closeModal(); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('modal').hidden) closeModal(); });
}

init();

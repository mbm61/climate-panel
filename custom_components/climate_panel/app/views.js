import { ROOMS, GENERAL, roomById } from './rooms.js';

let ha = null;
export const ui = { opt: {} };
export function init(client) { ha = client; }

/* ---------- утилиты ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ent = (id) => (id ? ha.get(id) : undefined);
const ok = (id) => { const e = ent(id); return !!e && e.state !== 'unavailable' && e.state !== 'unknown' && e.state !== undefined; };
const st = (id) => (ok(id) ? ent(id).state : undefined);
const attr = (id, k) => { const e = ent(id); return e ? e.attributes[k] : undefined; };
const val = (id) => { const s = st(id); const n = parseFloat(s); return s === undefined || !Number.isFinite(n) ? NaN : n; };
const fmt = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d).replace(/\.0+$/, '').replace('.', ',') : '—');
const isOn = (id) => st(id) === 'on';

function optVal(id, field, fallback) {
  const o = ui.opt[id + '|' + field];
  if (o && o.until > Date.now()) return o.v;
  return fallback;
}
export function setOpt(id, field, v) { ui.opt[id + '|' + field] = { v, until: Date.now() + 4000 }; }

const A = (svc, id, args) => `data-svc="${svc}" data-ent="${id}" data-args="${esc(JSON.stringify(args || {}))}"`;

const IC = {
  fan: '<path d="M12 12m-1.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0M12 10.4C12 6 9.8 3.6 7.6 4.6S7 9.2 10.6 11M13.6 12c4.4 0 6.8-2.2 5.8-4.4s-5.8-1-7.2 2.4M12 13.6c0 4.4 2.2 6.8 4.4 5.8s1-5.8-2.4-7.2M10.4 12c-4.4 0-6.8 2.2-5.8 4.4s5.8 1 7.2-2.4"/>',
  drop: '<path d="M12 3.5S5.5 10.5 5.5 14.5a6.5 6.5 0 0 0 13 0C18.5 10.5 12 3.5 12 3.5z"/>',
  heat: '<path d="M4 8h2v10H4zM9 8h2v10H9zM14 8h2v10h-2zM19 8h1.5v10H19zM3 6h18M3 20h18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  flame: '<path d="M12 3c1 3 4.5 5 4.5 9.5A4.5 4.5 0 0 1 12 17a4.5 4.5 0 0 1-4.5-4.5c0-2 1-3.2 2-4.2.2 1.4.8 2.3 1.8 2.8C11 8.5 11.3 5.8 12 3z"/>',
  auto: '<path d="M4.5 16a7.5 7.5 0 0 1 15 0M12 16l3.5-4.5M7 16h.01"/>',
  layers: '<path d="M12 4l8 4.5-8 4.5-8-4.5L12 4z M4 12.5l8 4.5 8-4.5M4 16.5l8 4.5 8-4.5"/>',
  sliders: '<path d="M4 7h9M19 7h1M4 17h1M11 17h9"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  bolt: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
  home: '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>',
  warn: '<path d="M12 4l9 16H3zM12 10v4M12 17.2v.1"/>',
  chev: '<path d="M9 5l7 7-7 7"/>',
  valve: '<path d="M3 12h18M12 12V6M8 6h8M8 12v5h8v-5"/>',
  chart: '<path d="M4 19h16M7 15l3.5-4 3 2.5 4.5-6"/>',
};
IC.moon = '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>';
IC.rocket = '<path d="M4.5 16.5c-1.5 1.5-2 4.5-2 4.5s3-.5 4.5-2"/><path d="M12 15l-3-3a18 18 0 0 1 3-7.5A18 18 0 0 1 20 3c0 4-1.5 8-6.5 12a18 18 0 0 1-1.5 0z"/><circle cx="15" cy="9" r="1.5"/>';
const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n] || ''}</svg>`;

/* ---------- производные значения комнаты ---------- */
/* оттенки карточек по комнатам: близкие к основному цвету, чтобы карточки не сливались */
const ROOM_TINT = {
  vent: ['#03a9f4', '#00bcd4', '#3f51b5'],
  heat: ['#ff7043', '#ff5252', '#ff9800'],
  hum: ['#2196f3', '#00acc1', '#5c6bc0'],
};
const tint = (kind, r) => ROOM_TINT[kind][Math.max(0, ROOMS.findIndex((x) => x.id === r.id))];
const MODE_ICON = { 'Авто': 'auto', 'Макс': 'bolt', 'Ночной': 'moon' };

export function co2Class(n) { return !Number.isFinite(n) ? 'na' : n < 800 ? 'good' : n < 1200 ? 'mid' : 'bad'; }

function metrics(r) {
  let t = val(r.sensors.t), tSrc = 'sensor';
  if (!Number.isFinite(t)) {
    const c = ent(r.heat.climate);
    const cur = r.heat.template ? (c ? parseFloat(c.attributes.current_temperature) : NaN) : val(r.heat.local);
    if (Number.isFinite(cur)) { t = cur; tSrc = 'head'; }
  }
  let h = val(r.sensors.h);
  if (!Number.isFinite(h) && r.humidifier) h = val(r.humidifier.rh);
  const co2 = val(r.sensors.co2);
  return { t, tSrc, h, co2 };
}


function ventInfo(r) {
  const b = r.breezer; const c = ent(b.climate);
  if (!c || c.state === 'unavailable') return { state: 'na', text: 'Нет связи' };
  if (c.state === 'off') return { state: 'off', text: 'Выкл' };
  const fm = c.attributes.fan_mode;
  const heat = c.state === 'heat' || c.state === 'heat_cool';
  const mode = heat ? 'Подогрев' : 'Вентиляция';
  const tone = heat ? 'warm' : 'vent'; // цвет статуса на главной: подогрев — оранжевый, вентиляция — синий
  if (isOn(b.boost)) return { state: 'boost', tone, text: `${mode} · Boost` };
  const base = String(fm) === 'auto' ? 'Авто' : `Скорость ${fm}`;
  const target = String(fm) === 'auto' && ent(b.setpoint) ? ` · ${fmt(val(b.setpoint), 0)} ppm` : '';
  return { state: String(fm) === 'auto' ? 'auto' : 'on', tone, text: `${mode} · ${base}${target}` };
}


export function warningsFor(id) { const r = roomById(id); return r ? warnings(r) : []; }

function warnings(r) {
  const w = [];
  const b = r.breezer;
  const fl = val(b.filterLeft);
  if (isOn(b.filterWorn)) w.push({ lvl: 'bad', t: 'Фильтр бризера изношен' });
  else if (Number.isFinite(fl) && fl <= 30) w.push({ lvl: fl <= 7 ? 'bad' : 'mid', t: `Фильтр бризера: осталось ${fmt(fl, 0)} дн` });
  if (isOn(b.problem)) w.push({ lvl: 'bad', t: 'Бризер: нет ответа от устройства' });
  const err = st(b.errors);
  if (err) w.push({ lvl: 'bad', t: 'Ошибка бризера: ' + err });
  const sb = val(r.sensors.bat);
  if (isOn(r.sensors.batLow) || (Number.isFinite(sb) && sb <= 20)) w.push({ lvl: sb <= 5 ? 'bad' : 'mid', t: `Датчик комнаты: батарея ${fmt(sb, 0)}%` });
  if (!r.heat.template) {
    const hb = val(r.heat.bat);
    if (Number.isFinite(hb) && hb <= 30) w.push({ lvl: hb <= 15 ? 'bad' : 'mid', t: `Термоголовка: батарея ${fmt(hb, 0)}%` });
    if (isOn(r.heat.window)) w.push({ lvl: 'mid', t: 'Термоголовка: открыто окно' });
  }
  if (r.humidifier) {
    const h = ent(r.humidifier.main);
    if (h && h.state === 'unavailable') w.push({ lvl: 'mid', t: 'Увлажнитель не отвечает (выключен из розетки или нет Wi‑Fi)' });
    const wl = st(r.humidifier.water);
    if (wl && wl !== 'normal') w.push({ lvl: 'mid', t: 'Увлажнитель: проверьте воду (' + wl + ')' });
  }
  return w;
}

/* ---------- компоненты ---------- */
const seg = (items, active, mk, cls = '') => `<div class="seg ${cls}">${items.map((i) => `<button class="${String(i.v) === String(active) ? 'on' : ''}" ${mk(i.v)}>${i.l}</button>`).join('')}</div>`;

function slider({ id, svc, field, min, max, step, value, unit = '', label, hint, valFmt, dec = 0 }) {
  const v = optVal(id, field, value);
  const shown = Number.isFinite(v) ? v : min;
  return `<div class="row">
    <div class="row-top"><span>${label}</span><output data-unit="${esc(unit)}" data-dec="${dec}">${fmt(shown, dec)}${unit ? ' ' + esc(unit) : ''}</output></div>
    <input type="range" min="${min}" max="${max}" step="${step}" value="${shown}" ${A(svc, id, {})} data-field="${field}">
    ${hint ? `<div class="hint">${hint}</div>` : ''}
  </div>`;
}

function numberRow(id, label, { unit, hint, dec = 0, step } = {}) {
  if (!ent(id)) return '';
  const a = ent(id).attributes;
  return slider({ id, svc: 'number.set_value', field: 'value', min: a.min ?? 0, max: a.max ?? 100, step: step ?? a.step ?? 1, value: val(id), unit: unit ?? a.unit_of_measurement ?? '', label, hint, dec });
}

const switchRow = (id, label, { confirm, hint } = {}) => `<div class="row switch-row">
  <div><div>${label}</div>${hint ? `<div class="hint">${hint}</div>` : ''}</div>
  <button class="sw ${isOn(id) ? 'on' : ''} ${ok(id) ? '' : 'na'}" role="switch" aria-checked="${isOn(id)}" ${A(isOn(id) ? 'switch.turn_off' : 'switch.turn_on', id)} ${confirm ? `data-confirm="${esc(confirm)}"` : ''}><i></i></button>
</div>`;

const card = (accent, title, ic, body, right = '', extra = '') => `<section class="card ${extra}" style="--accent:${accent}">
  <div class="card-head"><div class="card-title">${icon(ic)}<h2>${title}</h2></div>${right}</div>${body}</section>`;

const kv = (k, v) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`;

const COLORS = { vent: '#03a9f4', hum: '#2196f3', heat: '#ff7043', gen: '#9c27b0', warn: '#ffc107' };

/* ---------- разделы, карточки устройств, окна «все сразу» ---------- */
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;
const preAttr = (list) => (list && list.length ? ` data-pre="${esc(JSON.stringify(list))}"` : '');
const M = (svc, ids, args) => `data-svc="${svc}" data-ents="${esc(JSON.stringify(ids))}" data-args="${esc(JSON.stringify(args || {}))}"`;
const powerSw = (on, attrs, label) => `<button class="sw ${on ? 'on' : ''}" role="switch" aria-checked="${on}" aria-label="${esc(label)}" ${attrs}><i></i></button>`;
const ib = (on, attrs, inner, label, cls = '') => `<button class="ibtn ${cls}${on ? ' on' : ''}" aria-pressed="${on}" aria-label="${label}" title="${label}" ${attrs}>${inner}</button>`;
const breezerOn = (r) => { const c = ent(r.breezer.climate); return !!c && c.state !== 'off' && c.state !== 'unavailable'; };
const heatOnR = (r) => { const c = ent(r.heat.climate); return !!c && c.state === 'heat'; };
const humOnR = (r) => { const h = ent(r.humidifier && r.humidifier.main); return !!h && h.state === 'on'; };

export const lastFan = (() => { try { return JSON.parse(localStorage.getItem('climate.lastfan') || '{}'); } catch (e) { return {}; } })();
export function rememberFan(id, v) {
  lastFan[id] = String(v);
  try { localStorage.setItem('climate.lastfan', JSON.stringify(lastFan)); } catch (e) { /* ignore */ }
}

function devCard(color, room, label, body, power = '', off = false) {
  return `<section class="card dev${off ? ' is-off' : ''}" style="--accent:${color}">
    <div class="card-head"><div class="card-title"><div><h2>${esc(room)}</h2><small>${label}</small></div></div>${power}</div>${body}</section>`;
}

/* ---- карточка бризера ---- */
export function breezerCard(r) {
  const b = r.breezer; const c = ent(b.climate);
  if (!c || c.state === 'unavailable') return devCard(tint('vent', r), r.name, 'Бризер', '<p class="empty">Бризер не отвечает</p>', '', true);
  const a = c.attributes; const on = c.state !== 'off';
  const mode = c.state === 'heat_cool' ? 'heat' : c.state;
  const heatOn = on && mode === 'heat';
  const fm = String(a.fan_mode); const isAuto = fm === 'auto';
  const boostOn = isOn(b.boost); const boostLeft = val(b.boostLeft);
  const speeds = (a.fan_modes || ['auto', '1', '2', '3', '4', '5', '6']).map(String).filter((x) => x !== 'auto');
  const co2 = metrics(r).co2;
  const outdoorMx = `<div class="mx"><b>${fmt(val(b.outdoor))}°</b><small>Улица</small></div>`;
  const indoorMx = `<div class="mx"><b>${fmt(parseFloat(a.current_temperature))}°</b><small>Приток</small></div>`;
  const co2Mx = `<div class="mx ${co2Class(co2)}"><b>${fmt(co2, 0)}</b><small>CO₂ ppm</small></div>`;
  const gear = `<button class="icbtn" data-nav="#/room/${r.id}/breezer" aria-label="Настройки бризера">${icon('sliders')}</button>`;
  const power = `<div class="head-r">${outdoorMx}${indoorMx}${co2Mx}${gear}${powerSw(on, A('climate.set_hvac_mode', b.climate, { hvac_mode: on ? 'off' : 'fan_only' }), 'Бризер ' + r.name)}</div>`;
  if (!on) return devCard(tint('vent', r), r.name, 'Бризер', '', power, true);
  const controls = `<div class="bz-controls">
      ${ib(mode === 'fan_only', A('climate.set_hvac_mode', b.climate, { hvac_mode: 'fan_only' }), icon('fan'), 'Вентиляция')}
      ${ib(mode === 'heat', A('climate.set_hvac_mode', b.climate, { hvac_mode: 'heat' }), icon('flame'), 'Подогрев')}
      ${ib(isAuto, `data-act="auto" data-room="${r.id}"`, icon('auto'), 'Авто')}
      ${ib(boostOn, boostOn ? A('switch.turn_off', b.boost) : A('switch.turn_on', b.boost), icon('rocket') + (boostOn && boostLeft > 0 ? `<span>${mmss(boostLeft)}</span>` : ''), 'Boost', 'boost')}
    </div>`;
  const speedPart = isAuto
    ? (ent(b.setpoint) ? numberRow(b.setpoint, 'Уставка CO₂', { unit: 'ppm', step: 50 }) : '')
    : `<div class="label">Скорость</div>${seg(speeds.map((x) => ({ v: x, l: x })), fm, (v) => A('climate.set_fan_mode', b.climate, { fan_mode: v }) + preAttr(boostOn ? [b.boost] : []), 'fans')}`;
  const heatPart = heatOn ? slider({ id: b.climate, svc: 'climate.set_temperature', field: 'temperature', min: a.min_temp ?? 1, max: a.max_temp ?? 30, step: a.target_temp_step ?? 1, value: parseFloat(a.temperature), unit: '°C', label: 'Подогрев притока до' }) : '';
  return devCard(heatOn ? tint('heat', r) : tint('vent', r), r.name, 'Бризер', controls + speedPart + heatPart, power, false);
}

/* ---- карточка отопления ---- */
export function heatCard(r) {
  const c = ent(r.heat.climate);
  if (!c || c.state === 'unavailable') return devCard(tint('heat', r), r.name, 'Отопление', '<p class="empty">Нет связи с термоголовкой</p>', '', true);
  const a = c.attributes; const on = c.state === 'heat';
  const m = metrics(r);
  const target = optVal(r.heat.climate, 'temperature', parseFloat(a.temperature));
  const min = a.min_temp ?? 5; const max = a.max_temp ?? 30; const step = a.target_temp_step ?? 0.5;
  const now = `<div class="mx"><b>${fmt(m.t)}°</b><small>Сейчас</small></div>`;
  const power = `<div class="head-r">${now}${powerSw(on, A('climate.set_hvac_mode', r.heat.climate, { hvac_mode: on ? 'off' : 'heat' }), 'Отопление ' + r.name)}</div>`;
  const body = `${on ? `<div class="stepper">
      <button class="round" data-step="-${step}" data-ent="${r.heat.climate}" data-min="${min}" data-max="${max}" aria-label="Меньше">−</button>
      <div class="big"><b>${fmt(target)}</b><sup>°C</sup><small>Целевое значение</small></div>
      <button class="round" data-step="${step}" data-ent="${r.heat.climate}" data-min="${min}" data-max="${max}" aria-label="Больше">+</button>
    </div>` : ''}`;
  return devCard(tint('heat', r), r.name, 'Отопление', body, power, !on);
}

/* ---- карточка увлажнителя ---- */
export function humCard(r) {
  const h = r.humidifier; const e = ent(h.main);
  if (!e || e.state === 'unavailable') return devCard(tint('hum', r), r.name, 'Увлажнитель', '<p class="empty">Увлажнитель не отвечает. Показания появятся, когда он выйдет на связь.</p>', '', true);
  const a = e.attributes; const on = e.state === 'on';
  const modes = (a.available_modes || []).filter((x) => x !== 'Off');
  const cur = val(r.sensors.h);
  const wl = st(h.water);
  const nowMx = `<div class="mx"><b>${fmt(Number.isFinite(cur) ? cur : val(h.rh), 0)}%</b><small>Сейчас</small></div>`;
  const waterMx = `<div class="mx"><b>${wl === 'normal' ? 'норма' : wl || '—'}</b><small>Вода</small></div>`;
  const power = `<div class="head-r">${nowMx}${waterMx}${powerSw(on, A(on ? 'humidifier.turn_off' : 'humidifier.turn_on', h.main), 'Увлажнитель ' + r.name)}</div>`;
  const body = `${on ? slider({ id: h.main, svc: 'humidifier.set_humidity', field: 'humidity', min: a.min_humidity ?? 30, max: a.max_humidity ?? 60, step: 1, value: parseFloat(a.humidity), unit: '%', label: 'Целевая влажность' }) : ''}
    ${on && modes.length ? `<div class="bz-controls">${modes.map((m) => ib(a.mode === m, A('humidifier.set_mode', h.main, { mode: m }), icon(MODE_ICON[m] || 'drop'), m)).join('')}</div>` : ''}`;
  return devCard(tint('hum', r), r.name, 'Увлажнитель', body, power, !on);
}

/* ---- карточка клапана отопления (зона 2) ---- */
function valveCard() {
  const v = GENERAL.valve; const on = isOn(v);
  const attrs = A(on ? 'switch.turn_off' : 'switch.turn_on', v) + ' data-confirm="Изменить состояние кранов отопления? Они физически открываются и закрываются."';
  return devCard(COLORS.gen, 'Краны отопления', 'Зона 2 · Neptun', `<p class="hint">Закрытие остановит подачу тепла во всех комнатах.</p>`, powerSw(on, attrs, 'Краны отопления'), !on);
}

/* ---- главные карточки: три ряда по столбцам комнат ---- */
const rowBadge = (b) => (b ? `<span class="badge ${b.state} ${b.tone || ''}">${b.text}</span>` : '');
function homeGrid(rs, cell, badge, extra = '') {
  const c = rs.map((r) => cell(r));
  return `<div class="dgrid ${extra}" style="--n:${rs.length}">
    ${c.map((x) => `<div class="dcell dval ${x.cls || ''}">${x.html}</div>`).join('')}
    ${rs.map((r) => `<div class="dcell dname">${esc(r.name)}</div>`).join('')}
    <div class="dsep"></div>
    ${rs.map((r) => `<div class="dcell dstat">${rowBadge(badge(r))}</div>`).join('')}
  </div>`;
}
const breezerGrid = () => homeGrid(ROOMS,
  (r) => { const m = metrics(r); return { html: `<b>${fmt(m.co2, 0)}</b><small>ppm</small>`, cls: co2Class(m.co2) }; },
  (r) => ventInfo(r), 'bz');
const heatGrid = () => homeGrid(ROOMS,
  (r) => { const m = metrics(r); return { html: `<b>${fmt(m.t)}°</b>` }; },
  (r) => { const c = ent(r.heat.climate); if (!c || c.state === 'unavailable') return { state: 'na', text: 'Нет связи' }; if (c.state === 'heat') return { state: 'heat heating', text: `Цель: ${fmt(optVal(r.heat.climate, 'temperature', parseFloat(c.attributes.temperature)))}°` }; return { state: 'off', text: 'Выкл' }; });
const humBadge = (r) => {
  const h = ent(r.humidifier.main);
  if (!h || h.state === 'unavailable') return { state: 'na', text: 'Нет связи' };
  if (h.state === 'off') return { state: 'off', text: 'Выкл' };
  return { state: 'on', text: h.attributes.mode || 'Вкл' };
};
const humGrid = () => homeGrid(ROOMS,
  (r) => { const cur = val(r.sensors.h); return { html: `<b>${fmt(cur, 0)}%</b>` }; },
  (r) => (r.humidifier ? humBadge(r) : null));

function dirCard(route, title, color, ic, grid) {
  return `<section class="card dir" data-nav="#/${route}" style="--accent:${color}">
    <div class="card-head"><div class="card-title">${icon(ic)}<h2>${title}</h2></div>
      <div class="dir-right"><button class="bulkbtn" data-bulk="${route}" aria-label="Общее управление: ${title}">${icon('layers')}<span>Общее<br>управление</span></button></div>
    </div>
    ${grid}</section>`;
}

export function viewHome() {
  return `<div class="dirs">
    ${dirCard('breezers', 'Бризеры', COLORS.vent, 'fan', breezerGrid())}
    ${dirCard('heating', 'Отопление', COLORS.heat, 'heat', heatGrid())}
    ${dirCard('humidity', 'Увлажнители', COLORS.hum, 'drop', humGrid())}
    ${historyRow()}
  </div>`;
}

/* ---- страницы направлений ---- */
// На страницах «Бризеры» и «Отопление» Спальня и Кухня поменяны местами.
const dirRooms = () => ['kitchen', 'nursery', 'bedroom'].map(roomById);
export function viewBreezers() { return dirRooms().map(breezerCard).join(''); }
export function viewHeating() { return dirRooms().map(heatCard).join(''); }
export function viewValve() { return valveCard(); }
export function valveOn() { return isOn(GENERAL.valve); }
export function viewHumidity() { return ROOMS.filter((r) => r.humidifier).map(humCard).join('') || '<p class="empty">Нет увлажнителей</p>'; }

/* ---- окна «все сразу» ---- */
function bulkSlider(ids, svc, field, min, max, step, value, unit, label) {
  const dec = step < 1 ? 1 : 0;
  const v = Number.isFinite(value) ? value : min;
  return `<div class="row"><div class="row-top"><span>${label}</span><output data-unit="${esc(unit)}" data-dec="${dec}">${fmt(v, dec)} ${esc(unit)}</output></div>
    <input type="range" min="${min}" max="${max}" step="${step}" value="${v}" data-svc="${svc}" data-ents="${esc(JSON.stringify(ids))}" data-args="{}" data-field="${field}"></div>`;
}

export function viewBulk(kind) {
  if (kind === 'breezers') {
    const ids = ROOMS.map((r) => r.breezer.climate);
    const anyOn = ROOMS.some(breezerOn);
    const boostIds = ROOMS.map((r) => r.breezer.boost);
    const boostOnIds = boostIds.filter(isOn);
    const common = (xs) => (xs.length && xs.every((x) => x === xs[0]) ? xs[0] : '');
    const onR = ROOMS.filter(breezerOn);
    const curMode = common(onR.map((r) => { const c = ent(r.breezer.climate); return c.state === 'heat' || c.state === 'heat_cool' ? 'heat' : 'fan_only'; }));
    const curFan = common(onR.map((r) => String(ent(r.breezer.climate).attributes.fan_mode)));
    const autoOn = curFan === 'auto';
    const spIds = ROOMS.map((r) => r.breezer.setpoint);
    const sp0 = ent(spIds[0]);
    const spVals = spIds.map((id) => optVal(id, 'value', val(id))).filter(Number.isFinite);
    const spAvg = spVals.length ? spVals.reduce((x, y) => x + y, 0) / spVals.length : 800;
    const spRow = sp0 ? bulkSlider(spIds, 'number.set_value', 'value', sp0.attributes.min ?? 0, sp0.attributes.max ?? 2000, 50, spAvg, 'ppm', 'Уставка CO₂ (все бризеры)') : '';
    const sp = (x) => `<button class="${curFan === x ? 'on' : ''}" ${M('climate.set_fan_mode', ids, { fan_mode: x }) + preAttr(boostOnIds)}>${x}</button>`;
    const speedRow = `<div class="label">Скорость</div><div class="seg fans">${['1', '2', '3', '4', '5', '6'].map(sp).join('')}</div>`;
    const body = anyOn ? `<div class="bz-controls">
        ${ib(curMode === 'fan_only', M('climate.set_hvac_mode', ids, { hvac_mode: 'fan_only' }), icon('fan'), 'Вентиляция')}
        ${ib(curMode === 'heat', M('climate.set_hvac_mode', ids, { hvac_mode: 'heat' }), icon('flame'), 'Подогрев')}
        ${ib(autoOn, 'data-act="bulk-auto"', icon('auto'), 'Авто')}
        ${ib(boostOnIds.length > 0, boostOnIds.length ? M('switch.turn_off', boostOnIds) : M('switch.turn_on', boostIds), icon('rocket'), 'Boost', 'boost')}
      </div>
      ${autoOn ? spRow : speedRow}`
      : '<p class="hint">Включите, чтобы управлять всеми бризерами сразу.</p>';
    const heatMode = curMode === 'heat';
    const tAvgList = ids.map((id) => optVal(id, 'temperature', parseFloat(ent(id)?.attributes.temperature))).filter(Number.isFinite);
    const tAvg = tAvgList.length ? tAvgList.reduce((x, y) => x + y, 0) / tAvgList.length : 20;
    const ta = ent(ids[0])?.attributes || {};
    const hRow = heatMode ? bulkSlider(ids, 'climate.set_temperature', 'temperature', ta.min_temp ?? 1, ta.max_temp ?? 30, ta.target_temp_step ?? 1, tAvg, '°C', 'Подогрев притока до (все)') : '';
    const full = anyOn ? body + hRow : body;
    return devCard(heatMode ? COLORS.heat : COLORS.vent, 'Все бризеры', ROOMS.map((r) => r.name).join(' · '), full, powerSw(anyOn, M('climate.set_hvac_mode', ids, { hvac_mode: anyOn ? 'off' : 'fan_only' }), 'Все бризеры'), !anyOn);
  }
  if (kind === 'heating') {
    const ids = ROOMS.map((r) => r.heat.climate);
    const anyOn = ROOMS.some(heatOnR);
    const tg = ROOMS.map((r) => optVal(r.heat.climate, 'temperature', parseFloat(ent(r.heat.climate)?.attributes.temperature))).filter(Number.isFinite);
    const avg = tg.length ? tg.reduce((x, y) => x + y, 0) / tg.length : 25;
    const ents = esc(JSON.stringify(ids));
    const stepper = `<div class="stepper">
      <button class="round" data-step="-0.5" data-ents="${ents}" data-ent="${ids[0]}" data-cur="${avg}" data-min="5" data-max="30" aria-label="Меньше">−</button>
      <div class="big"><b>${fmt(avg)}</b><sup>°C</sup><small>Целевое значение, все комнаты</small></div>
      <button class="round" data-step="0.5" data-ents="${ents}" data-ent="${ids[0]}" data-cur="${avg}" data-min="5" data-max="30" aria-label="Больше">+</button>
    </div>`;
    const body = anyOn ? stepper : '<p class="hint">Включите, чтобы управлять всем отоплением сразу.</p>';
    return devCard(COLORS.heat, 'Всё отопление', ROOMS.map((r) => r.name).join(' · '), body, powerSw(anyOn, M('climate.set_hvac_mode', ids, { hvac_mode: anyOn ? 'off' : 'heat' }), 'Всё отопление'), !anyOn);
  }
  if (kind === 'humidity') {
    const hs = ROOMS.filter((r) => r.humidifier);
    const ids = hs.map((r) => r.humidifier.main);
    const anyOn = hs.some(humOnR);
    const ref = ids.map((id) => ent(id)).find((e) => e && e.state === 'on');
    const modeList = [...new Set(ids.flatMap((id) => (ent(id)?.attributes.available_modes || [])))].filter((x) => x !== 'Off');
    const modesNow = ids.map((id) => ent(id)?.attributes.mode).filter(Boolean);
    const curHum = modesNow.length && modesNow.every((x) => x === modesNow[0]) ? modesNow[0] : '';
    const body = anyOn && ref ? bulkSlider(ids, 'humidifier.set_humidity', 'humidity', 30, 60, 1, parseFloat(ref.attributes.humidity), '%', 'Целевая влажность (все)')
      + (modeList.length ? `<div class="bz-controls">${modeList.map((m) => ib(curHum === m, M('humidifier.set_mode', ids, { mode: m }), icon(MODE_ICON[m] || 'drop'), m)).join('')}</div>` : '')
      : '<p class="hint">Включите, чтобы управлять всеми увлажнителями сразу.</p>';
    return devCard(COLORS.hum, 'Все увлажнители', hs.map((r) => r.name).join(' · '), body, powerSw(anyOn, M(anyOn ? 'humidifier.turn_off' : 'humidifier.turn_on', ids), 'Все увлажнители'), !anyOn);
  }
  return '';
}

/* ---------- настройки бризера ---------- */
export function viewBreezer(id) {
  const r = roomById(id); if (!r) return '<p class="empty">Комната не найдена</p>';
  const b = r.breezer; const c = ent(b.climate);
  if (!c || c.state === 'unavailable') return card(COLORS.vent, 'Настройки бризера', 'sliders', '<p class="empty">Бризер не отвечает</p>');
  const isAuto = String(c.attributes.fan_mode) === 'auto';
  const minF = val(b.minFan); const aggr = val(b.aggr); const delta = val(b.minDelta);
  const boostLeft = val(b.boostLeft);
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

  const onThr = Number.isFinite(aggr) ? (5 - aggr) * 20 + 50 : null;
  const minHint = minF === 0
    ? `Минимум 0: бризер выключен, пока CO₂ не превысит уставку на ${onThr ?? '…'} ppm. Затем держит скорость ≥ 1, пока CO₂ выше уставки.`
    : '';
  const deltaHint = delta === 0 ? '<span class="bad-t">При 0 пауза между переключениями отключена — на шумном датчике скорость может меняться на каждое показание.</span>' : 'Минимальная пауза между сменами скорости. 0 — без паузы.';

  const boost = card(COLORS.vent, 'Boost', 'bolt', `
    ${switchRow(b.boost, 'Режим Boost', { hint: isOn(b.boost) && boostLeft > 0 ? 'Осталось ' + mmss(boostLeft) : 'Максимальная скорость на заданное время' })}
    ${numberRow(b.boostTime, 'Длительность Boost', { unit: 'мин' })}`);

  const auto = card(COLORS.vent, 'Авто по CO₂', 'fan', `
    ${!isAuto ? `<div class="note">Сейчас ручной режим скорости — параметры ниже сохраняются, но не действуют.
      <button class="btn small" ${A('climate.set_fan_mode', b.climate, { fan_mode: 'auto' })}>Включить «Авто»</button></div>` : ''}
    ${numberRow(b.setpoint, 'Уставка CO₂ (Auto Setpoint)', { unit: 'ppm', step: 50 })}
    <div class="label">Алгоритм</div>
    ${ent(b.algo) ? seg((attr(b.algo, 'options') || []).map((x) => ({ v: x, l: x })), st(b.algo), (v) => A('select.select_option', b.algo, { option: v }), 'algo') : ''}
    ${numberRow(b.aggr, 'Агрессивность (Auto Aggressiveness)', { hint: '1 — медленно, 3 — средне, 5 — быстро реагирует на рост CO₂' })}
    ${numberRow(b.minFan, 'Мин. скорость (Auto Min Fan Speed)', { hint: minHint })}
    ${numberRow(b.maxFan, 'Макс. скорость (Auto Max Fan Speed)')}
    ${numberRow(b.minDelta, 'Мин. интервал (Auto Min Time Delta)', { unit: 'мин', hint: deltaHint })}
    ${switchRow(b.ramping, 'Плавное изменение скорости (Ramping)', { hint: 'Скорость меняется на 1 ступень за шаг' })}`);

  const fl = val(b.filterLeft);
  const service = card(COLORS.gen, 'Сервис', 'sliders', `
    ${switchRow(b.led, 'Подсветка')}
    ${switchRow(b.buzzer, 'Звук')}
    ${switchRow(b.recirc, 'Рециркуляция')}
    ${kv('Фильтр', Number.isFinite(fl) ? `осталось ${fmt(fl, 0)} дн` : '—')}
    <div class="actions">
      <button class="btn danger" data-act="reset-filter" data-room="${r.id}">Сбросить счётчик фильтра</button>
    </div>`);

  const diag = card(COLORS.gen, 'Диагностика', 'sliders', `<div class="kvs col">
    ${kv('Прошивка', esc(st(b.version) || '—'))}
    ${kv('Wi‑Fi', fmt(val(b.wifi), 0) + ' дБм')}
    ${kv('Нагреватель', fmt(val(b.heaterPower), 0) + ' Вт')}
    ${kv('Температура платы', fmt(val(b.espTemp)) + '°')}
    ${kv('Время работы', Number.isFinite(val(b.uptime)) ? fmt(val(b.uptime) / 86400, 1) + ' сут' : '—')}
    ${kv('Ошибки', esc(st(b.errors) || 'нет'))}
  </div>`);

  return boost + auto + service + diag;
}

/* ---------- сервис и предупреждения ---------- */
export const APP_VERSION = '1.8';
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };

function serviceCard(demo) {
  const when = ha.cacheTs ? new Date(ha.cacheTs).toLocaleString('ru', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '—';
  const sTxt = { online: 'на связи', connecting: 'подключение…', offline: 'нет связи', auth_error: 'токен не принят', idle: '—' }[ha.status];
  const url = ha.url || lsGet('climate.url') || location.origin;
  return card(COLORS.gen, 'Подключение', 'home', `
      <label class="field">Адрес Home Assistant<input id="f-url" type="url" value="${esc(url)}" ${demo ? 'disabled' : ''} autocapitalize="off" autocorrect="off" placeholder="https://домен:8443"></label>
      <label class="field">Новый токен (необязательно)<input id="f-token" type="password" ${demo ? 'disabled' : ''} autocapitalize="off" autocorrect="off" placeholder="оставьте пустым, чтобы не менять"></label>
      <div class="actions"><button class="btn active" data-act="svc-save" ${demo ? 'disabled' : ''}>Сохранить и переподключить</button></div>
      ${demo ? '<div class="hint">В демо адрес не меняется.</div>' : ''}
      <div class="kvs col" style="margin-top:12px">
        ${kv('Статус', sTxt)}
        ${kv('Данные обновлены', when)}
        ${kv('Версия приложения', APP_VERSION)}
      </div>
      <div class="actions"><button class="btn danger" data-act="logout">Сменить токен / выйти</button></div>`);
}

const THEME_OPTS = [['auto', 'Как в iPhone'], ['light', 'Светлая'], ['dark', 'Тёмная']];
export function viewService(demo, mode = 'auto') {
  return serviceCard(demo) + themeCard(mode) + viewPush(pushInfo);
}
const themeCard = (mode) => card(COLORS.gen, 'Тема', 'moon', `<div class="seg theme-seg">${THEME_OPTS.map(([v, l]) => `<button class="${mode === v ? 'on' : ''}" data-theme-set="${v}">${l}</button>`).join('')}</div><p class="hint">Тема меняется сразу и запоминается на этом устройстве.</p>`);

export function viewWarnings() {
  const parts = ROOMS.map((r) => {
    const w = warningsFor(r.id);
    if (!w.length) return '';
    return `<h3 class="grp">${esc(r.name)}</h3>` + w.map((x) => `<div class="warn ${x.lvl}">${icon('warn')}<span>${esc(x.t)}</span></div>`).join('');
  }).join('');
  return parts || '<p class="empty">Замечаний нет.</p>';
}
export function warningsCount() { return ROOMS.reduce((n, r) => n + warningsFor(r.id).length, 0); }
export function warningsBad() { return ROOMS.some((r) => warningsFor(r.id).some((x) => x.lvl === 'bad')); }

export function viewSetup(error) {
  const url = localStorage.getItem('climate.url') || location.origin;
  return `<section class="card setup" style="--accent:${COLORS.vent}">
    <h2>Подключение к Home Assistant</h2>
    <p class="hint">Вставьте долгосрочный токен пользователя Home Assistant (профиль → Безопасность → Долгосрочные токены).</p>
    ${error ? `<div class="warn bad">${icon('warn')}<span>${esc(error)}</span></div>` : ''}
    <label class="field">Адрес<input id="f-url" type="url" value="${esc(url)}" autocapitalize="off" autocorrect="off"></label>
    <label class="field">Токен<input id="f-token" type="password" autocapitalize="off" autocorrect="off" placeholder="eyJ…"></label>
    <button class="btn active" data-act="save-creds">Подключиться</button>
  </section>`;
}

export function titleFor(route) {
  const [p, id, sub] = route;
  if (p === 'room') { const r = roomById(id); return r ? 'Настройки · ' + r.name : 'Климат'; }
  if (p === 'breezers') return 'Бризеры';
  if (p === 'heating') return 'Отопление';
  if (p === 'humidity') return 'Увлажнители';
  if (p === 'service') return 'Сервис';
  return 'Климат';
}

/* ---- история: графики CO₂ и температуры ---- */
const HIST_KINDS = [['co2', 'CO₂', 'vent', 'fan'], ['temp', 'Температура', 'heat', 'heat'], ['hum', 'Влажность', 'hum', 'drop']];
const historyRow = () => `<div class="hist-btns">${HIST_KINDS.map(([k, l, c, ic]) => `<button class="hist-btn" data-hist="${k}" style="--accent:${COLORS[c]}">${icon(ic)}<span>${l}</span></button>`).join('')}</div>`;

export const HIST_RANGES = [['6h', '6 ч'], ['24h', '24 ч'], ['7d', '7 дн']];
export const hist = { range: '24h', data: null, loading: false, error: '' };
const ROOM_COLOR = { bedroom: '#2196f3', nursery: '#26a69a', kitchen: '#ff7043' };
const ROOM_NAME = { bedroom: 'Спальня', nursery: 'Детская', kitchen: 'Кухня' };

// Равномерные деления шкалы: шаг 1, 2, 2.5 или 5 × 10ⁿ, не больше n интервалов.
function niceTicks(lo, hi, n) {
  const raw = (hi - lo) / n;
  if (!(raw > 0)) return { ticks: [lo], step: 0 };
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(Number(v.toFixed(6)));
  return { ticks, step };
}

function lineChart(series, from, to, opt) {
  const W = 320, H = 150, L = 38, R = 8, T = 8, B = 20;
  const pts = Object.values(series).flat().map((p) => p[1]);
  if (!pts.length) return '<p class="empty">Нет данных за период</p>';
  let min = Math.min(...pts), max = Math.max(...pts);
  if (opt.kind === 'co2') { min = Math.min(400, min); max = Math.max(opt.threshold + 200, max * 1.05); }
  else { min = Math.floor(min) - 1; max = Math.ceil(max) + 1; }
  const x = (t) => L + ((t - from) / (to - from)) * (W - L - R);
  const y = (v) => T + (1 - (v - min) / (max - min)) * (H - T - B);
  const fmtX = (t) => new Date(t).toLocaleString('ru', hist.range === '6h'
    ? { hour: '2-digit', minute: '2-digit' }
    : hist.range === '24h' ? { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: '2-digit' });
  const lines = Object.entries(series).map(([rid, arr]) => (arr.length
    ? `<polyline fill="none" stroke="${ROOM_COLOR[rid]}" stroke-width="2" stroke-linejoin="round" points="${arr.map(([t, v]) => `${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"/>`
    : '')).join('');
  const thr = opt.threshold !== undefined
    ? `<line x1="${L}" x2="${W - R}" y1="${y(opt.threshold).toFixed(1)}" y2="${y(opt.threshold).toFixed(1)}" stroke="#d92d20" stroke-dasharray="4 3" stroke-width="1"/><text x="${W - R}" y="${(y(opt.threshold) - 3).toFixed(1)}" text-anchor="end" fill="#d92d20">${opt.threshold}</text>`
    : '';
  const { ticks, step } = niceTicks(min, max, 4);
  const dec = step < 1 ? 1 : 0;
  const grid = ticks.map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text x="${L - 4}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end">${v.toFixed(dec)}</text>`).join('');
  const axis = `${grid}
    <text x="${L}" y="${H - 4}">${fmtX(from)}</text>
    <text x="${W - R}" y="${H - 4}" text-anchor="end">${fmtX(to)}</text>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${opt.label}">${thr}${lines}${axis}</svg>`;
}

const legend = (series) => `<div class="legend">${Object.keys(series).map((rid) => `<span><i style="background:${ROOM_COLOR[rid]}"></i>${ROOM_NAME[rid]}</span>`).join('')}</div>`;

export function viewHistory(kind) {
  const seg = `<div class="seg hist-range">${HIST_RANGES.map(([r, l]) => `<button class="${hist.range === r ? 'on' : ''}" data-range="${r}">${l}</button>`).join('')}</div>`;
  const meta = {
    temp: ['Температура, °C', 'Температура по комнатам', 'heat', { kind: 'temp' }],
    hum: ['Влажность, %', 'Влажность по комнатам', 'hum', { kind: 'hum' }],
    co2: ['CO₂, ppm', 'CO₂ по комнатам', 'vent', { kind: 'co2', threshold: 1000 }],
  }[kind];
  if (!meta) return '';
  const [title, label, color, opt] = meta;
  const head = `<div class="card-head"><div class="card-title" style="--accent:${COLORS[color]}">${icon('chart')}<h2>${title}</h2></div></div>`;
  let body;
  if (hist.loading && !hist.data) body = '<p class="empty">Загрузка…</p>';
  else if (hist.error) body = `<p class="empty">${esc(hist.error)}</p>`;
  else if (!hist.data || !hist.data.series[kind]) body = '<p class="empty">Нет данных за период</p>';
  else {
    const d = hist.data;
    body = `${lineChart(d.series[kind], d.from, d.to, { ...opt, label })}${legend(d.series[kind])}`;
  }
  return `<div class="hist-body" style="--accent:${COLORS[color]}">${head}${body}${seg}</div>`;
}

/* демо: синтетические данные той же формы, что отдаёт сервер */
export function demoHistory(range) {
  const spans = { '6h': 6, '24h': 24, '7d': 168 };
  const to = Date.now(), from = to - spans[range] * 3600e3, n = 120, step = (to - from) / n;
  const gen = (f) => Object.fromEntries(ROOMS.map((r, i) => [r.id, Array.from({ length: n }, (_, k) => [Math.round(from + k * step), f(k, i)])]));
  return { range, from, to, series: {
    co2: gen((k, i) => Math.round(650 + 300 * Math.sin(k / (9 + i)) + (i === 2 ? 180 : 0))),
    temp: gen((k, i) => +(22.5 + 1.6 * Math.sin(k / 17 + i)).toFixed(1)),
    hum: gen((k, i) => +(46 + 8 * Math.sin(k / 13 + i * 1.3)).toFixed(1)),
  } };
}

/* блок «Уведомления» на странице «Сервис» */
export const pushInfo = { supported: false, enabled: false, msg: 'Проверка…' };

export function viewPush(info) {
  const btns = info.enabled
    ? '<button class="btn" data-act="push-test">Проверить</button><button class="btn danger" data-act="push-off">Выключить</button>'
    : `<button class="btn active" data-act="push-on" ${info.supported ? '' : 'disabled'}>Включить</button>`;
  return card(COLORS.gen, 'Уведомления CO₂', 'warn', `
      <p class="hint">${esc(info.msg)}</p>
      <div class="actions">${btns}</div>`);
}

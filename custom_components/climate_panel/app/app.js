import { HA } from './ha.js';
import { ROOMS, allEntityIds, roomById } from './rooms.js';
import * as V from './views.js';
import * as P from './push.js';

const $ = (id) => document.getElementById(id);
const $app = $('app'), $prev = $('prev'), $stage = $('stage'), $page = $('page'), $header = document.querySelector('header.top');
const $title = $('title'), $back = $('back'), $banner = $('banner'), $toast = $('toast');
const $dlg = $('dlg'), $info = $('info'), $infoN = $('info-n'), $svc = $('svc'), $valve = $('valve');
const HIST_ORDER = ['co2', 'temp', 'hum'];
const $sheet = $('sheet'), $sheetCard = $('sheet-card'), $sheetBody = $('sheet-body'), $sheetTitle = $('sheet-title');
const DEMO = !!window.__DEMO;

const ha = new HA(allEntityIds());
V.init(ha);

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
};

let busy = false;
let setupError = '';
let curHash = DEMO ? '#/' : (location.hash || '#/');
let sheetKind = null;
const stepTimers = {};
const isOnId = (id) => ha.get(id)?.state === 'on';

function toast(msg) {
  $toast.textContent = msg; $toast.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => $toast.classList.remove('show'), 3500);
}

function askConfirm(msg) {
  return new Promise((res) => {
    $dlg.querySelector('p').textContent = msg; $dlg.hidden = false;
    const done = (v) => { $dlg.hidden = true; res(v); };
    $dlg.querySelector('[data-ok]').onclick = () => done(true);
    $dlg.querySelector('[data-cancel]').onclick = () => done(false);
  });
}

/* ---------- маршруты ---------- */
const parse = (h) => { const x = (h || '#/').replace(/^#\/?/, ''); return x ? x.split('/') : ['']; };
const route = () => parse(curHash);
const isHome = (rt) => rt[0] === '';
const depth = (rt) => (isHome(rt) ? 0 : rt[0] === 'room' ? 2 : 1);
const parentHash = (rt) => (rt[0] === 'room' && rt[2] ? '#/breezers' : depth(rt) > 0 ? '#/' : null);
function hasCreds() { return DEMO || !!store.get('climate.token'); }

function viewFor(rt) {
  if (!hasCreds() || ha.status === 'auth_error') return V.viewSetup(ha.status === 'auth_error' ? 'Токен не принят. Проверьте токен и адрес.' : setupError);
  if (rt[0] === 'room' && rt[2] === 'breezer') return V.viewBreezer(rt[1]);
  if (rt[0] === 'breezers') return V.viewBreezers();
  if (rt[0] === 'heating') return V.viewHeating();
  if (rt[0] === 'humidity') return V.viewHumidity();
  if (rt[0] === 'service') return V.viewService(DEMO, themeMode());
  return V.viewHome();
}

/* ---------- тема: как в iPhone / светлая / тёмная ---------- */
const THEME_KEY = 'climate.theme';
function themeMode() {
  try { const v = localStorage.getItem(THEME_KEY); return v === 'light' || v === 'dark' ? v : 'auto'; } catch (e) { return 'auto'; }
}
function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === 'light' || mode === 'dark') root.dataset.theme = mode; else delete root.dataset.theme;
  const dark = mode === 'dark' || (mode === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => { m.content = dark ? '#0b1220' : '#e9f1fb'; });
}
function setTheme(mode) {
  try { localStorage.setItem(THEME_KEY, mode); } catch (e) { /* без записи тема действует до перезагрузки */ }
  applyTheme(mode); scheduleRender();
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(themeMode()));
applyTheme(themeMode());

/* ---------- история ---------- */
let histTimer = null;
async function loadHistory() {
  V.hist.loading = true; V.hist.error = '';
  scheduleRender();
  if (DEMO) { V.hist.data = V.demoHistory(V.hist.range); V.hist.loading = false; scheduleRender(); return; }
  try { V.hist.data = await ha.api(`/climate_api/history?range=${V.hist.range}`); }
  catch (err) { V.hist.error = 'Не удалось загрузить историю: ' + err.message; }
  V.hist.loading = false; scheduleRender();
}
function startHist() {
  loadHistory();
  clearInterval(histTimer);
  histTimer = setInterval(() => { if (sheetKind && sheetKind.startsWith('hist-')) loadHistory(); }, 60000);
}
function stopHist() { clearInterval(histTimer); histTimer = null; }

/* ---------- уведомления ---------- */
let svcOn = false;
async function refreshPush() {
  if (DEMO) { V.pushInfo.msg = 'В демо уведомлений нет.'; scheduleRender(); return; }
  V.pushInfo.supported = P.pushSupported();
  if (!V.pushInfo.supported) {
    V.pushInfo.enabled = false;
    V.pushInfo.msg = 'Уведомления работают в приложении на экране «Домой» (iPhone: iOS 16.4 и новее).';
    scheduleRender(); return;
  }
  const sub = await P.currentSubscription().catch(() => null);
  V.pushInfo.enabled = !!sub;
  V.pushInfo.msg = sub
    ? 'Включено. Придёт уведомление, если CO₂ выше 1000 ppm дольше 10 минут.'
    : 'Выключено. Включите, чтобы получать уведомления о высоком CO₂.';
  scheduleRender();
}
function syncService(rt) {
  const on = rt[0] === 'service';
  if (on && !svcOn) { svcOn = true; refreshPush(); }
  if (!on) svcOn = false;
}

function render(anim) {
  const rt = route();
  const y = anim ? 0 : window.scrollY;
  const setup = !hasCreds() || ha.status === 'auth_error';
  $app.innerHTML = viewFor(rt);
  syncService(rt);
  window.scrollTo(0, y);
  if (anim) {
    $app.classList.remove('enter-right', 'enter-left');
    void $app.offsetWidth;
    $app.classList.add(anim === 'fwd' ? 'enter-right' : 'enter-left');
  }
  $title.textContent = setup ? 'Климат' : V.titleFor(rt);
  $back.hidden = setup || isHome(rt);
  $svc.hidden = setup || !isHome(rt);
  $valve.hidden = setup || rt[0] !== 'heating';
  $valve.classList.toggle('on', !setup && V.valveOn());
  // Информация — на всех страницах, всегда крайняя справа; бейдж только при наличии замечаний
  $info.hidden = setup || !isHome(rt);
  const n = V.warningsCount();
  $infoN.textContent = n;
  $infoN.hidden = n === 0;
  const bad = V.warningsBad();
  $info.classList.toggle('bad', bad);
  $info.classList.toggle('mid', !bad);
  if (sheetKind) $sheetBody.innerHTML = sheetHtml(sheetKind);
  else if (!$sheet.hidden) closeSheet(true);
  document.body.classList.toggle('offline', ha.status !== 'online');
  renderBanner();
}

function go(h) {
  const from = route();
  curHash = h;
  if (!DEMO && location.hash !== h) location.hash = h;
  closeSheet(true);
  const to = route();
  render(depth(to) > depth(from) ? 'fwd' : depth(to) < depth(from) ? 'back' : null);
}

const CONN_LABEL = {
  online: 'Связь с Home Assistant есть',
  connecting: 'Подключение к Home Assistant…',
  idle: 'Подключение к Home Assistant…',
  offline: 'Нет связи с Home Assistant',
  auth_error: 'Ошибка авторизации',
};
function renderConn() {
  const s = DEMO ? 'online' : (hasCreds() ? ha.status : 'idle');
  $svc.dataset.s = s;
  $svc.title = CONN_LABEL[s] || '';
  $svc.setAttribute('aria-label', CONN_LABEL[s] || 'Сервис');
}

function renderBanner() {
  renderConn();
  const s = ha.status;
  if (!hasCreds() || s === 'online' || s === 'idle') { $banner.hidden = true; return; }
  const t = ha.cacheTs ? new Date(ha.cacheTs).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }) : null;
  $banner.hidden = false;
  $banner.className = 'banner ' + (s === 'connecting' ? 'info' : 'bad');
  $banner.textContent = s === 'connecting' ? 'Подключение…' : `Нет связи с Home Assistant.${t ? ' Показаны данные от ' + t + '.' : ''} Управление отключено.`;
}

let rt = 0;
function scheduleRender() {
  if (rt) return;
  rt = setTimeout(() => { rt = 0; if (!busy) render(); }, 120);
}
ha.addEventListener('entities', scheduleRender);
ha.addEventListener('status', () => { render(); });

window.addEventListener('hashchange', () => {
  if (DEMO) return;
  const h = location.hash || '#/';
  if (h === curHash) return;
  curHash = h; window.scrollTo(0, 0); closeSheet(true); render();
});

/* ---------- назад: кнопка и свайп (карусель) ---------- */
const EASE = 'transform .3s cubic-bezier(.22,.8,.3,1)';
let drag = null;

function prevHeaderHtml(pr) {
  const hdr = $header.cloneNode(true);
  hdr.removeAttribute('id');
  hdr.querySelectorAll('[id]').forEach((e) => e.removeAttribute('id'));
  const home = isHome(pr);
  const back = hdr.querySelector('#back, button');
  if (back) back.hidden = home;
  hdr.querySelector('h1').textContent = V.titleFor(pr);
  const info = hdr.querySelector('.infobtn');
  if (info) { const n = V.warningsCount(); info.hidden = !home; const b = info.querySelector('b'); if (b) { b.textContent = n; b.hidden = n === 0; } }
  const svc = hdr.querySelector('[aria-label="Сервис"]'); if (svc) svc.hidden = !home;
  const valve = hdr.querySelector('[aria-label="Краны отопления"]'); if (valve) valve.hidden = pr[0] !== 'heating';
  return hdr.outerHTML;
}
function dragStart() {
  const parent = parentHash(route());
  if (!parent) return false;
  const pr = parse(parent);
  $prev.innerHTML = prevHeaderHtml(pr) + `<main class="prev-main">${viewFor(pr)}</main>`;
  $prev.hidden = false;
  $prev.style.left = (-window.innerWidth) + 'px';
  $prev.style.top = Math.max(0, window.scrollY - $stage.offsetTop) + 'px';
  $prev.style.transition = 'none'; $page.style.transition = 'none';
  drag = { parent, vw: window.innerWidth };
  busy = true;
  return true;
}
const BLUR_MAX = 8;
function dragSet(dx) {
  const t = `translate3d(${dx}px,0,0)`;
  const p = Math.min(1, Math.max(0, Math.abs(dx) / window.innerWidth));
  $page.style.transform = t; $prev.style.transform = t;
  $page.style.filter = `blur(${(p * BLUR_MAX).toFixed(2)}px)`;
  $prev.style.filter = `blur(${((1 - p) * BLUR_MAX).toFixed(2)}px)`;
}
function dragFinish(commit) {
  if (!drag) return;
  const { parent, vw } = drag;
  const T = `${EASE}, filter .3s ease`;
  $page.style.transition = T; $prev.style.transition = T;
  dragSet(commit ? vw : 0);
  setTimeout(() => {
    $page.style.transition = 'none'; $prev.style.transition = 'none';
    $page.style.transform = ''; $prev.style.transform = ''; $page.style.filter = ''; $prev.style.filter = '';
    $prev.hidden = true; $prev.innerHTML = '';
    drag = null; busy = false;
    if (commit) { curHash = parent; if (!DEMO && location.hash !== parent) location.hash = parent; window.scrollTo(0, 0); render(); }
    else scheduleRender();
  }, 310);
}
function backNow() {
  if (drag || !dragStart()) return;
  void $app.offsetWidth;
  dragFinish(true);
}
$back.addEventListener('click', backNow);

// тактильный отклик на iPhone: нажатие на кнопку или карточку дёргает скрытый переключатель (Safari 17.4+)
const $hapt = document.getElementById('hapticLbl');
const HAPT_SEL = 'button, [data-nav], [data-act], [data-step], [data-svc], [data-bulk], [data-hist], [data-theme-set], [data-range], .card, .dir, .ibtn, .sw';
document.addEventListener('click', (e) => {
  if (!$hapt || !(e.target instanceof Element)) return;
  // поля ввода и подписи не трогаем: программный клик по переключателю уводит фокус из поля
  if (e.target.closest('input, textarea, select, label')) return;
  if (e.target.closest(HAPT_SEL)) $hapt.click();
}, true);

const sw = { on: false, locked: false, x0: 0, y0: 0, dx: 0, hist: [] };
document.addEventListener('touchstart', (e) => {
  sw.on = false;
  if (e.touches.length !== 1 || drag || !$sheet.hidden || !$dlg.hidden) return;
  if (e.target.closest('input[type=range]')) return;
  if (!parentHash(route())) return;
  const t = e.touches[0];
  Object.assign(sw, { on: true, locked: false, x0: t.clientX, y0: t.clientY, dx: 0, hist: [{ x: t.clientX, t: e.timeStamp }] });
}, { passive: true });
document.addEventListener('touchmove', (e) => {
  if (!sw.on) return;
  const t = e.touches[0]; const dx = t.clientX - sw.x0; const dy = t.clientY - sw.y0;
  if (!sw.locked) {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    if (dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.4 && dragStart()) sw.locked = true;
    else { sw.on = false; return; }
  }
  e.preventDefault();
  sw.dx = Math.max(0, dx);
  sw.hist.push({ x: t.clientX, t: e.timeStamp }); if (sw.hist.length > 5) sw.hist.shift();
  dragSet(sw.dx);
}, { passive: false });
function swipeEnd() {
  if (!sw.on || !sw.locked) { sw.on = false; return; }
  sw.on = false;
  const h = sw.hist; const a = h[0]; const b = h[h.length - 1];
  const v = b.t > a.t ? (b.x - a.x) / (b.t - a.t) : 0;
  dragFinish(sw.dx > window.innerWidth * 0.33 || v > 0.55);
}
document.addEventListener('touchend', swipeEnd);
document.addEventListener('touchcancel', swipeEnd);

/* ---------- окно (предупреждения и «все сразу») ---------- */
const SHEET_TITLE = { warn: 'Замечания' };
function sheetHtml(k) {
  if (k.startsWith('hist-')) return V.viewHistory(k.slice(5));
  return k === 'warn' ? V.viewWarnings() : k === 'valve' ? V.viewValve() : V.viewBulk(k.slice(5));
}

function resetSheetFx() {
  $sheetCard.style.transition = ''; $sheetCard.style.transform = ''; $sheetCard.style.opacity = '';
  $sheet.style.transition = ''; $sheet.style.opacity = '';
}
function openSheet(k) {
  if (k.startsWith('hist-')) startHist();
  sheetKind = k;
  resetSheetFx();
  $sheetCard.classList.toggle('bare', !(k === 'warn' || k.startsWith('hist-')));
  $sheetCard.classList.toggle('solid', k.startsWith('hist-'));
  $sheetTitle.textContent = SHEET_TITLE[k] || '';
  $sheetTitle.hidden = !SHEET_TITLE[k];
  $sheetBody.innerHTML = sheetHtml(k);
  $sheet.hidden = false;
  $sheetCard.style.transition = 'none'; $sheetCard.style.transform = 'translateY(-120%)';
  void $sheetCard.offsetWidth;
  $sheetCard.style.transition = ''; $sheetCard.style.transform = 'translateY(0)';
}
function closeSheet(now) {
  if (sheetKind && sheetKind.startsWith('hist-')) stopHist();
  sheetKind = null;
  if (now) { $sheet.hidden = true; resetSheetFx(); return; }
  $sheetCard.style.transition = 'transform .22s ease-in, opacity .22s ease-in';
  $sheetCard.style.transform = 'translateY(-60px)'; $sheetCard.style.opacity = '0';
  $sheet.style.transition = 'opacity .22s ease-in'; $sheet.style.opacity = '0';
  setTimeout(() => { if (!sheetKind) { $sheet.hidden = true; resetSheetFx(); } }, 230);
}
$info.addEventListener('click', () => openSheet('warn'));
$valve.addEventListener('click', () => openSheet('valve'));
$sheet.addEventListener('click', (e) => { if (e.target === $sheet) closeSheet(); });

// карусель графиков: горизонтальный свайп по всему окну; соседний график едет следом, как при свайпе «назад»
const hs = { on: false, lock: false, busy: false, x0: 0, y0: 0, dx: 0, dir: 0, w: 1, peer: null, hist: [] };
const histIdx = () => HIST_ORDER.indexOf(sheetKind.slice(5));
const histNextOk = (dir) => { const i = histIdx() + dir; return i >= 0 && i < HIST_ORDER.length; };
function histSetDx(dx) {
  const { dir, w, peer } = hs;
  if (!histNextOk(dir) || !peer) { $sheetBody.style.transform = `translate3d(${dx * 0.3}px,0,0)`; return; } // у края — сопротивление
  const p = Math.min(1, Math.abs(dx) / w);
  $sheetBody.style.transform = `translate3d(${dx}px,0,0)`;
  $sheetBody.style.filter = `blur(${(p * BLUR_MAX).toFixed(2)}px)`;
  peer.style.transform = `translate3d(${dx + dir * w}px,0,0)`;
  peer.style.filter = `blur(${((1 - p) * BLUR_MAX).toFixed(2)}px)`;
}
function histFinish(commit) {
  const { dir, w, peer } = hs;
  const ok = commit && peer && histNextOk(dir);
  const T = `${EASE}, filter .3s ease`;
  $sheetBody.style.transition = T;
  if (peer) peer.style.transition = T;
  if (ok) {
    $sheetBody.style.transform = `translate3d(${-dir * w}px,0,0)`; $sheetBody.style.filter = `blur(${BLUR_MAX}px)`;
    peer.style.transform = 'translate3d(0,0,0)'; peer.style.filter = 'blur(0px)';
  } else {
    $sheetBody.style.transform = 'translate3d(0,0,0)'; $sheetBody.style.filter = 'blur(0px)';
    if (peer) { peer.style.transform = `translate3d(${dir * w}px,0,0)`; peer.style.filter = `blur(${BLUR_MAX}px)`; }
  }
  hs.busy = true;
  setTimeout(() => {
    if (ok) sheetKind = 'hist-' + HIST_ORDER[histIdx() + dir];
    if (peer) peer.remove();
    hs.peer = null;
    $sheetBody.style.transition = 'none'; $sheetBody.style.transform = ''; $sheetBody.style.filter = '';
    if (ok) $sheetBody.innerHTML = sheetHtml(sheetKind);
    void $sheetBody.offsetWidth; $sheetBody.style.transition = '';
    hs.busy = false;
  }, 310);
}
$sheet.addEventListener('touchstart', (e) => {
  hs.on = !!(sheetKind && sheetKind.startsWith('hist-') && !hs.busy && e.touches.length === 1 && !e.target.closest('input[type=range]'));
  if (!hs.on) return;
  const t = e.touches[0];
  Object.assign(hs, { lock: false, x0: t.clientX, y0: t.clientY, dx: 0, hist: [{ x: t.clientX, t: e.timeStamp }] });
}, { passive: true });
$sheet.addEventListener('touchmove', (e) => {
  if (!hs.on) return;
  const t = e.touches[0]; const dx = t.clientX - hs.x0; const dy = t.clientY - hs.y0;
  if (!hs.lock) {
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
    if (Math.abs(dx) <= Math.abs(dy) * 1.4) { hs.on = false; return; }
    hs.lock = true; if (sd) sd = null;
    hs.dir = dx < 0 ? 1 : -1; hs.w = $sheetBody.offsetWidth || 1;
    if (histNextOk(hs.dir)) {
      const el = document.createElement('div');
      el.className = 'hist-peer';
      el.innerHTML = sheetHtml('hist-' + HIST_ORDER[histIdx() + hs.dir]);
      Object.assign(el.style, { width: hs.w + 'px', left: $sheetBody.offsetLeft + 'px', top: $sheetBody.offsetTop + 'px', transform: `translate3d(${hs.dir * hs.w}px,0,0)` });
      $sheetCard.appendChild(el); hs.peer = el;
    }
  }
  e.preventDefault();
  hs.dx = dx;
  hs.hist.push({ x: t.clientX, t: e.timeStamp }); if (hs.hist.length > 5) hs.hist.shift();
  histSetDx(dx);
}, { passive: false });
function histSwipeEnd() {
  if (!hs.on || !hs.lock) { hs.on = false; return; }
  hs.on = false;
  const h = hs.hist; const a = h[0]; const b = h[h.length - 1];
  const v = b.t > a.t ? (b.x - a.x) / (b.t - a.t) : 0;
  const sameWay = (hs.dx < 0 ? 1 : -1) === hs.dir;
  histFinish(sameWay && (Math.abs(hs.dx) > hs.w * 0.33 || Math.abs(v) > 0.5));
}
$sheet.addEventListener('touchend', histSwipeEnd);
$sheet.addEventListener('touchcancel', histSwipeEnd);

// закрытие смахиванием вверх: только если содержимое окна прокручено в начало и жест начат не на ползунке/кнопке
let sd = null;
$sheet.addEventListener('touchstart', (e) => {
  if (e.target.closest('input[type=range], button')) { sd = null; return; }
  sd = { y0: e.touches[0].clientY, dy: 0, t0: e.timeStamp, on: false };
}, { passive: true });
$sheet.addEventListener('touchmove', (e) => {
  if (!sd) return;
  const dy = e.touches[0].clientY - sd.y0;
  if (!sd.on) {
    if (dy < -8 && $sheetBody.scrollTop <= 0) { sd.on = true; $sheetCard.style.transition = 'none'; }
    else if (dy > 8) { sd = null; return; }
    else return;
  }
  sd.dy = Math.min(0, dy);
  $sheetCard.style.transform = `translateY(${sd.dy}px)`;
  $sheetCard.style.opacity = String(Math.max(0.15, 1 + sd.dy / 160));
  e.preventDefault();
}, { passive: false });
const sheetEnd = (e) => {
  if (!sd) return;
  const wasOn = sd.on;
  const fast = wasOn && sd.dy < -20 && (e.timeStamp - sd.t0) < 250;
  $sheetCard.style.transition = '';
  if (wasOn && (sd.dy < -70 || fast)) closeSheet();
  else if (wasOn) { $sheetCard.style.transform = 'translateY(0)'; $sheetCard.style.opacity = ''; }
  sd = null;
};
$sheet.addEventListener('touchend', sheetEnd);
$sheet.addEventListener('touchcancel', sheetEnd);

$svc.addEventListener('click', () => go('#/service'));

/* ---------- ввод ---------- */
async function runCalls(list) {
  const errs = [];
  for (const [d, s, args, id] of list) {
    try { await ha.call(d, s, args, id); } catch (e) { errs.push(e.message); }
  }
  if (errs.length) toast(errs[0] + (errs.length > 1 ? ` (ещё ошибок: ${errs.length - 1})` : ''));
  scheduleRender();
}

async function callSvc(el, extraArgs) {
  const [domain, service] = el.dataset.svc.split('.');
  const ids = el.dataset.ents ? JSON.parse(el.dataset.ents) : [el.dataset.ent];
  let args = {};
  try { args = JSON.parse(el.dataset.args || '{}'); } catch (e) { /* ignore */ }
  Object.assign(args, extraArgs || {});
  const list = [];
  // любая скорость или «Авто» сначала отменяет Boost
  if (el.dataset.pre) for (const id of JSON.parse(el.dataset.pre)) list.push(['switch', 'turn_off', {}, id]);
  for (const id of ids) list.push([domain, service, args, id]);
  el.classList.add('pending');
  await runCalls(list);
  el.classList.remove('pending');
}

function validateFan(el, value) {
  const room = ['bedroom', 'nursery', 'kitchen'].map(roomById).find((r) => r.breezer.minFan === el.dataset.ent || r.breezer.maxFan === el.dataset.ent);
  if (!room) return null;
  const b = room.breezer;
  const min = el.dataset.ent === b.minFan ? value : parseFloat(ha.get(b.minFan)?.state);
  const max = el.dataset.ent === b.maxFan ? value : parseFloat(ha.get(b.maxFan)?.state);
  if (Number.isFinite(min) && Number.isFinite(max) && min >= max) return 'Мин. скорость должна быть меньше макс.';
  return null;
}

document.addEventListener('pointerdown', (e) => { if (e.target.matches('input[type=range]')) busy = true; });
const release = () => { if (busy && !drag) { busy = false; scheduleRender(); } };
document.addEventListener('pointerup', release);
document.addEventListener('pointercancel', release);

document.addEventListener('input', (e) => {
  const el = e.target;
  if (!el.matches('input[type=range]')) return;
  const out = el.closest('.row').querySelector('output');
  const dec = parseInt(out.dataset.dec || '0', 10);
  out.textContent = Number(el.value).toFixed(dec).replace('.', ',') + (out.dataset.unit ? ' ' + out.dataset.unit : '');
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  if (!el.matches('input[type=range]')) return;
  busy = false;
  const v = parseFloat(el.value);
  const err = validateFan(el, v);
  if (err) { toast(err); scheduleRender(); return; }
  if (el.dataset.ent) V.setOpt(el.dataset.ent, el.dataset.field, v);
  await callSvc(el, { [el.dataset.field]: v });
});

document.addEventListener('click', async (e) => {
  const t = e.target;

  const bulk = t.closest('[data-bulk]');
  if (bulk) { openSheet('bulk:' + bulk.dataset.bulk); return; }

  const th = t.closest('[data-theme-set]');
  if (th) { setTheme(th.dataset.themeSet); return; }
  const hb = t.closest('[data-hist]');
  if (hb) { openSheet('hist-' + hb.dataset.hist); return; }
  const rng = t.closest('[data-range]');
  if (rng) { V.hist.range = rng.dataset.range; V.hist.data = null; loadHistory(); return; }

  const nav = t.closest('[data-nav]');
  if (nav) { go(nav.dataset.nav); return; }

  const stepBtn = t.closest('[data-step]');
  if (stepBtn) {
    const ids = stepBtn.dataset.ents ? JSON.parse(stepBtn.dataset.ents) : [stepBtn.dataset.ent];
    const key = ids.join(',');
    const id = ids[0];
    let base;
    if (stepBtn.dataset.cur !== undefined) base = parseFloat(stepBtn.dataset.cur);
    else {
      const cur = parseFloat(ha.get(id)?.attributes.temperature);
      base = V.ui.opt[id + '|temperature']?.until > Date.now() ? V.ui.opt[id + '|temperature'].v : cur;
    }
    if (!Number.isFinite(base)) return;
    const next = Math.min(parseFloat(stepBtn.dataset.max), Math.max(parseFloat(stepBtn.dataset.min), base + parseFloat(stepBtn.dataset.step)));
    const svcFull = stepBtn.dataset.svc || 'climate.set_temperature';
    const field = stepBtn.dataset.field || 'temperature';
    ids.forEach((x) => V.setOpt(x, field, next));
    const stepper = stepBtn.closest('.stepper');
    if (stepper) {
      stepper.querySelectorAll('[data-cur]').forEach((b) => { b.dataset.cur = String(next); });
      const shown = stepper.querySelector('.big b');
      if (shown) shown.textContent = next.toFixed(1).replace(/\.0+$/, '').replace('.', ',');
    }
    // кнопки −/+ у ползунка: двигаем сам ползунок и подпись, все кнопки ряда запоминают новое значение
    const row = stepBtn.closest('.row');
    if (row && !stepper) {
      const rng = row.querySelector('input[type=range]');
      if (rng) rng.value = String(next);
      const out = row.querySelector('output');
      if (out) out.textContent = Number(next).toFixed(Number(out.dataset.dec) || 0) + (out.dataset.unit ? ' ' + out.dataset.unit : '');
      row.querySelectorAll('[data-step]').forEach((b) => { b.dataset.cur = String(next); });
    }
    scheduleRender();
    clearTimeout(stepTimers[key]);
    stepTimers[key] = setTimeout(() => {
      const [dom, svcName] = svcFull.split('.');
      Promise.all(ids.map((x) => ha.call(dom, svcName, { [field]: next }, x)))
        .catch((err) => toast(err.message)).finally(scheduleRender);
    }, 600);
    return;
  }

  const act = t.closest('[data-act]');
  if (act) {
    const a = act.dataset.act;
    if (a === 'auto') {
      const r = roomById(act.dataset.room); const cl = r.breezer.climate;
      const cur = String(ha.get(cl)?.attributes.fan_mode);
      // первое нажатие включает «Авто»; повторное переводит на 1-ю скорость.
      // Прошивка esphome-tion сбрасывает авто только при смене скорости, поэтому сначала ставим 2-ю, потом 1-ю.
      const list = [];
      if (isOnId(r.breezer.boost)) list.push(['switch', 'turn_off', {}, r.breezer.boost]);
      if (cur === 'auto') list.push(['climate', 'set_fan_mode', { fan_mode: '2' }, cl]);
      list.push(['climate', 'set_fan_mode', { fan_mode: cur === 'auto' ? '1' : 'auto' }, cl]);
      await runCalls(list);
    } else if (a === 'bulk-auto') {
      const allAuto = ROOMS.every((r) => String(ha.get(r.breezer.climate)?.attributes.fan_mode) === 'auto');
      const list = [];
      ROOMS.forEach((r) => { if (isOnId(r.breezer.boost)) list.push(['switch', 'turn_off', {}, r.breezer.boost]); });
      if (allAuto) ROOMS.forEach((r) => list.push(['climate', 'set_fan_mode', { fan_mode: '2' }, r.breezer.climate]));
      ROOMS.forEach((r) => {
        const cl = r.breezer.climate;
        list.push(['climate', 'set_fan_mode', { fan_mode: allAuto ? '1' : 'auto' }, cl]);
      });
      await runCalls(list);
    } else if (a === 'push-on') {
      try { await P.enablePush(ha); toast('Уведомления включены'); }
      catch (err) { toast(err.message); }
      await refreshPush();
    } else if (a === 'push-off') {
      try { await P.disablePush(ha); toast('Уведомления выключены'); }
      catch (err) { toast(err.message); }
      await refreshPush();
    } else if (a === 'push-test') {
      try { const r = await P.testPush(ha); toast(r.sent ? `Отправлено: ${r.sent}` : 'Нет активных подписок'); }
      catch (err) { toast(err.message); }
    } else if (a === 'save-creds') {
      const url = document.getElementById('f-url').value.trim().replace(/\/+$/, '');
      const token = document.getElementById('f-token').value.trim();
      if (!url || !token) { setupError = 'Заполните адрес и токен.'; render(); return; }
      setupError = '';
      store.set('climate.url', url); store.set('climate.token', token);
      ha.setCreds(url, token); ha.status = 'idle'; ha.connect(); render();
    } else if (a === 'svc-save') {
      const raw = document.getElementById('f-url').value.trim();
      const token = document.getElementById('f-token').value.trim();
      let url;
      try { const u = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw); if (!/^https?:$/.test(u.protocol)) throw new Error('p'); url = u.origin + u.pathname.replace(/\/+$/, ''); }
      catch (err) { toast('Неверный адрес. Пример: https://ha.example.com:8443'); return; }
      store.set('climate.url', url);
      if (token) store.set('climate.token', token);
      ha.setCreds(url, token || store.get('climate.token')); ha.status = 'idle'; ha.connect();
      toast('Адрес сохранён, подключаюсь…'); render();
    } else if (a === 'logout') {
      if (DEMO) { toast('В демо токена нет'); return; }
      if (!(await askConfirm('Удалить токен с этого устройства?'))) return;
      ha.close(); store.del('climate.token'); store.del('climate.cache.v1'); ha.entities = {}; ha.status = 'idle';
      go('#/');
    } else if (a === 'reset-filter') {
      const r = roomById(act.dataset.room);
      if (!(await askConfirm('Сбросить счётчик фильтра? Делайте это только после замены фильтра.'))) return;
      try {
        await ha.call('switch', 'turn_on', {}, r.breezer.resetConfirm);
        await ha.call('button', 'press', {}, r.breezer.resetBtn);
        await ha.call('switch', 'turn_off', {}, r.breezer.resetConfirm);
        toast('Счётчик фильтра сброшен');
      } catch (err) { toast(err.message); }
    }
    return;
  }

  const svcEl = t.closest('[data-svc]');
  if (svcEl && !svcEl.matches('input')) {
    if (svcEl.dataset.confirm && !(await askConfirm(svcEl.dataset.confirm))) return;
    await callSvc(svcEl);
  }
});

/* ---------- запуск ---------- */
if (!DEMO && 'serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});

const token = DEMO ? 'good' : store.get('climate.token');
if (DEMO) { ha.entities = {}; ha.fromCache = false; ha.setCreds('http://demo.local', 'good'); ha.connect(); }
else if (token) { ha.setCreds(store.get('climate.url') || location.origin, token); ha.connect(); }
render();

// Клиент Home Assistant WebSocket API: авторизация по токену, subscribe_entities,
// call_service, переподключение (iOS рвёт сокеты в фоне), кэш последних значений.
const CACHE_KEY = 'climate.cache.v1';

export class HA extends EventTarget {
  constructor(entityIds) {
    super();
    this.entityIds = entityIds;
    this.entities = {};
    this.status = 'idle'; // idle | connecting | online | offline | auth_error
    this.fromCache = false;
    this.cacheTs = 0;
    this._id = 0;
    this._pending = new Map();
    this._retry = 0;
    this._loadCache();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.wake();
    });
    window.addEventListener('online', () => this.wake());
    window.addEventListener('pageshow', () => this.wake());
  }

  _loadCache() {
    try {
      const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (raw && raw.entities) {
        this.entities = raw.entities;
        this.cacheTs = raw.ts || 0;
        this.fromCache = true;
      }
    } catch (e) { /* кэш недоступен */ }
  }

  _saveCache() {
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), entities: this.entities }));
      } catch (e) { /* ignore */ }
    }, 1500);
  }

  setCreds(url, token) { this.url = url; this.token = token; }

  // REST-запросы к сервисам приложения (push, история) с токеном доступа.
  async api(path, opts = {}) {
    if (!this.url || !this.token) throw new Error('Нет адреса или токена Home Assistant');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000); // сервер не отвечает — не висим бесконечно
    try {
      const res = await fetch(new URL(path, this.url), {
        method: opts.method || 'GET',
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: ctrl.signal,
      });
      if (!res.ok) {
        let detail = '';
        try { detail = (await res.json()).message || ''; } catch (e) { /* тело не JSON */ }
        throw new Error(detail || `Ошибка ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('Сервер не ответил за 15 секунд');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  _setStatus(s) {
    if (this.status === s) return;
    this.status = s;
    this.dispatchEvent(new Event('status'));
  }

  connect() {
    if (!this.url || !this.token) return;
    this.close(true);
    this._setStatus('connecting');
    let ws;
    try {
      const u = new URL(this.url);
      ws = new WebSocket((u.protocol === 'https:' ? 'wss://' : 'ws://') + u.host + '/api/websocket');
    } catch (e) { this._setStatus('offline'); this._scheduleRetry(); return; }
    this.ws = ws;
    this._lastRx = Date.now();
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      this._lastRx = Date.now();
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; } // битое сообщение пропускаем, соединение не рвём
      this._onMsg(msg);
    };
    ws.onclose = () => { if (this.ws === ws) this._dropped(); };
    ws.onerror = () => { /* onclose последует */ };
  }

  close(silent) {
    clearInterval(this._ping); clearTimeout(this._retryT);
    if (this.ws) { const w = this.ws; this.ws = null; try { w.close(); } catch (e) { /* ignore */ } }
    for (const [, p] of this._pending) p.reject(new Error('Нет связи'));
    this._pending.clear();
    if (!silent) this._setStatus('offline');
  }

  _dropped() {
    this.ws = null;
    clearInterval(this._ping);
    for (const [, p] of this._pending) p.reject(new Error('Нет связи'));
    this._pending.clear();
    if (this.status !== 'auth_error') { this._setStatus('offline'); this._scheduleRetry(); }
  }

  _scheduleRetry() {
    clearTimeout(this._retryT);
    const d = Math.min(30000, 1000 * Math.pow(2, this._retry++));
    this._retryT = setTimeout(() => this.connect(), d);
  }

  // Вызывается при возврате приложения на экран.
  wake() {
    if (!this.token || this.status === 'auth_error') return;
    const alive = this.ws && this.ws.readyState === 1 && Date.now() - this._lastRx < 45000;
    if (!alive) { this._retry = 0; this.connect(); }
    else this._send({ type: 'ping' });
  }

  _send(obj) {
    if (!this.ws || this.ws.readyState !== 1) return null;
    obj.id = ++this._id;
    this.ws.send(JSON.stringify(obj));
    return obj.id;
  }

  _onMsg(m) {
    switch (m.type) {
      case 'auth_required':
        this.ws.send(JSON.stringify({ type: 'auth', access_token: this.token }));
        break;
      case 'auth_ok':
        this._retry = 0;
        this._subId = this._send({ type: 'subscribe_entities', entity_ids: this.entityIds });
        this._ping = setInterval(() => {
          if (Date.now() - this._lastRx > 60000) { try { this.ws && this.ws.close(); } catch (e) { /* ignore */ } }
          else this._send({ type: 'ping' });
        }, 25000);
        break;
      case 'auth_invalid':
        this._setStatus('auth_error');
        this.close(true);
        break;
      case 'event':
        if (m.id === this._subId) this._applyEvent(m.event);
        break;
      case 'result': {
        const p = this._pending.get(m.id);
        if (p) {
          this._pending.delete(m.id);
          if (m.success) p.resolve(m.result);
          else p.reject(new Error((m.error && m.error.message) || 'Ошибка команды'));
        } else if (m.id === this._subId && !m.success) {
          // отказ подписки на данные: приложение покажет баннер
          this.dispatchEvent(new CustomEvent('error', { detail: m.error }));
        }
        break;
      }
      default: break;
    }
  }

  _applyEvent(ev) {
    let fresh = false;
    if (this.status !== 'online') {
      // после (пере)подключения удаляем устаревшие сущности: снимок придёт целиком в ev.a
      if (ev.a) { this.entities = {}; fresh = true; }
      this.fromCache = false;
      this._setStatus('online');
    }
    const E = this.entities;
    if (ev.a) for (const id in ev.a) {
      const e = ev.a[id];
      E[id] = { entity_id: id, state: e.s, attributes: e.a || {}, last_changed: e.lc, last_updated: e.lu || e.lc };
    }
    if (ev.r) for (const id of ev.r) delete E[id];
    if (ev.c) for (const id in ev.c) {
      const d = ev.c[id]; const cur = E[id];
      if (!cur) continue;
      const plus = d['+'];
      if (plus) {
        if ('s' in plus) cur.state = plus.s;
        if (plus.a) cur.attributes = { ...cur.attributes, ...plus.a };
        if (plus.lc) cur.last_changed = plus.lc;
        if (plus.lu) cur.last_updated = plus.lu;
      }
      const minus = d['-'];
      if (minus && minus.a) for (const k of minus.a) delete cur.attributes[k];
    }
    this.cacheTs = Date.now();
    this._saveCache();
    this.dispatchEvent(new Event('entities'));
    return fresh;
  }

  get(id) { return this.entities[id]; }

  call(domain, service, data, entityId) {
    return new Promise((resolve, reject) => {
      if (this.status !== 'online' || !this.ws) return reject(new Error('Нет связи с Home Assistant'));
      const msg = { type: 'call_service', domain, service, service_data: data || {} };
      if (!entityId) return reject(new Error('Не указана сущность'));
      msg.target = { entity_id: entityId };
      const id = this._send(msg);
      if (!id) return reject(new Error('Нет связи с Home Assistant'));
      const t = setTimeout(() => { this._pending.delete(id); reject(new Error('Нет ответа от Home Assistant')); }, 15000);
      this._pending.set(id, {
        resolve: (r) => { clearTimeout(t); resolve(r); },
        reject: (e) => { clearTimeout(t); reject(e); },
      });
    });
  }
}

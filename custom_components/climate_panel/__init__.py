"""Climate Panel: раздаёт PWA «Климат», шлёт Web Push при высоком CO₂ и отдаёт историю для графиков."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from pathlib import Path

import homeassistant.helpers.config_validation as cv
from homeassistant.components.http import HomeAssistantView, StaticPathConfig
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.event import async_call_later, async_track_state_change_event
from homeassistant.helpers.storage import Store
from homeassistant.helpers.typing import ConfigType
from homeassistant.util import dt as dt_util

from .devices import DEVICES
from .webpush import Vapid, build_request

_LOGGER = logging.getLogger(__name__)

DOMAIN = "climate_panel"
URL_BASE = "/climate_app"
STORE_VERSION = 1
STORE_KEY = "climate_panel.push"

CO2_LIMIT = 1000  # ppm
CO2_HOLD = 600    # секунд выше порога до уведомления (10 минут)

# Соответствие с app/rooms.js: комната → (название, датчик CO₂, датчик температуры).
# Идентификаторы устройств — в devices.py (локальный файл, не в репозитории).
NAMES = {"bedroom": "Спальня", "nursery": "Детская", "kitchen": "Кухня"}
ROOMS = {
    rid: (NAMES[rid], f"sensor.{d['co2']}_co2", f"sensor.{d['sensor']}_temperature")
    for rid, d in DEVICES.items()
}
# Датчики влажности комнат (для графика истории)
HUM_SENSORS = {rid: f"sensor.{d['sensor']}_humidity" for rid, d in DEVICES.items()}
CO2_ENTITIES = {v[1]: rid for rid, v in ROOMS.items()}

# Увлажнители: датчик уровня воды (только комнаты, где увлажнитель есть в app/rooms.js)
WATER_SENSORS = {
    rid: (NAMES[rid], f"sensor.{d['humidifier']}_water_level")
    for rid, d in DEVICES.items() if d["humidifier"]
}
WATER_ENTITIES = {v[1]: rid for rid, v in WATER_SENSORS.items()}

RANGES = {"6h": timedelta(hours=6), "24h": timedelta(hours=24), "7d": timedelta(days=7)}
POINTS = 120  # точек на график: значения усредняются по корзинам

CONFIG_SCHEMA = cv.empty_config_schema(DOMAIN)


class PushState:
    """Подписки и ключи VAPID хранятся в .storage; таймеры CO₂ — в памяти."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.store: Store = Store(hass, STORE_VERSION, STORE_KEY)
        self.data: dict = {"vapid": None, "subs": []}
        self.vapid: Vapid | None = None
        self.timers: dict[str, object] = {}
        self.alerted: dict[str, bool] = {}

    async def load(self) -> None:
        stored = await self.store.async_load()
        if stored:
            self.data = stored
        if not self.data.get("vapid"):
            self.vapid = Vapid.generate()
            self.data["vapid"] = {"private": self.vapid.private_value}
            await self.save()
        else:
            self.vapid = Vapid.from_private_value(self.data["vapid"]["private"])

    async def save(self) -> None:
        await self.store.async_save(self.data)

    @property
    def subject(self) -> str:
        """Контакт для поля sub в JWT: адрес Home Assistant (https)."""
        try:
            from homeassistant.helpers.network import get_url

            return get_url(self.hass, allow_internal=True, allow_ip=True, prefer_external=True)
        except Exception:  # noqa: BLE001
            return "https://homeassistant.local:8123"

    async def send_all(self, payload: dict) -> tuple[int, int]:
        """Отправляет уведомление всем подписчикам. Возвращает (отправлено, удалено)."""
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        session = async_get_clientsession(self.hass)
        sent = removed = 0
        for sub in list(self.data["subs"]):
            url, headers, data = build_request(
                sub["endpoint"], sub["keys"]["p256dh"], sub["keys"]["auth"], body, self.vapid, self.subject
            )
            try:
                async with session.post(url, data=data, headers=headers, timeout=15) as resp:
                    if resp.status in (404, 410):  # подписка больше не действует
                        self.data["subs"].remove(sub)
                        removed += 1
                    elif resp.status < 300:
                        sent += 1
                    else:
                        _LOGGER.warning("Push отклонён: %s %s", resp.status, await resp.text())
            except Exception as err:  # noqa: BLE001
                _LOGGER.warning("Push не отправлен: %s", err)
        if removed:
            await self.save()
        return sent, removed


async def _json_body(request) -> dict | None:
    """Тело запроса как словарь; при некорректном JSON возвращает None (ответ 400, а не 500)."""
    try:
        data = await request.json()
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def _water_low(state) -> bool | None:
    """True — воды мало, False — норма, None — состояние неизвестно (не уведомляем)."""
    if state is None or state.state in ("unknown", "unavailable", ""):
        return None
    if state.state == "low":
        return True
    if state.state == "normal":
        return False
    # Запасной вариант: атрибут протокола Xiaomi (1 — норма, 0 — нехватка воды).
    level = state.attributes.get("humidifier.water_level")
    try:
        return int(level) == 0
    except (TypeError, ValueError):
        return None


def _float(state) -> float | None:
    try:
        value = float(state.state)
    except (TypeError, ValueError, AttributeError):
        return None
    return value if value == value else None  # отсекаем NaN


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    app_dir = Path(__file__).parent / "app"
    await hass.http.async_register_static_paths(
        [StaticPathConfig(URL_BASE, str(app_dir), False)]
    )

    push = PushState(hass)
    await push.load()
    hass.data[DOMAIN] = push

    hass.http.register_view(PushKeyView())
    hass.http.register_view(PushSubscribeView())
    hass.http.register_view(PushUnsubscribeView())
    hass.http.register_view(PushTestView())
    hass.http.register_view(HistoryView())

    async def _fire(rid: str) -> None:
        """Через 10 минут выше порога: одно уведомление до снижения ниже порога."""
        push.timers.pop(rid, None)
        name, sensor, _ = ROOMS[rid]
        value = _float(hass.states.get(sensor))
        if value is None or value <= CO2_LIMIT or push.alerted.get(rid):
            return
        push.alerted[rid] = True
        await push.send_all({
            "title": f"Высокий CO₂: {name}",
            "body": f"{round(value)} ppm уже 10 минут (порог {CO2_LIMIT} ppm). Проветрите комнату.",
            "tag": f"co2-{rid}",
            "url": f"{URL_BASE}/index.html#/",
        })

    @callback
    def _co2_changed(event: Event) -> None:
        rid = CO2_ENTITIES[event.data["entity_id"]]
        value = _float(event.data.get("new_state"))
        if value is not None and value > CO2_LIMIT:
            if rid not in push.timers and not push.alerted.get(rid):
                push.timers[rid] = async_call_later(
                    hass, CO2_HOLD, lambda _now, r=rid: hass.async_create_task(_fire(r))
                )
        else:
            cancel = push.timers.pop(rid, None)
            if cancel:
                cancel()
            push.alerted[rid] = False

    @callback
    def _water_changed(event: Event) -> None:
        """Переход в «мало воды» — одно уведомление; сброс при возврате к норме."""
        rid = WATER_ENTITIES[event.data["entity_id"]]
        low = _water_low(event.data.get("new_state"))
        key = f"water-{rid}"
        if low is None:
            return
        if low and not push.alerted.get(key):
            push.alerted[key] = True
            name = WATER_SENSORS[rid][0]
            hass.async_create_task(push.send_all({
                "title": f"Мало воды в увлажнителе: {name}",
                "body": "Долейте воду в увлажнитель.",
                "tag": key,
                "url": f"{URL_BASE}/index.html#/",
            }))
        elif not low:
            push.alerted[key] = False

    async_track_state_change_event(hass, list(CO2_ENTITIES), _co2_changed)
    async_track_state_change_event(hass, list(WATER_ENTITIES), _water_changed)
    return True


class PushKeyView(HomeAssistantView):
    url = "/climate_api/push/key"
    name = "climate_panel:push:key"
    requires_auth = True

    async def get(self, request):
        push: PushState = request.app["hass"].data[DOMAIN]
        return self.json({"publicKey": push.vapid.public_b64})


class PushSubscribeView(HomeAssistantView):
    url = "/climate_api/push/subscribe"
    name = "climate_panel:push:subscribe"
    requires_auth = True

    async def post(self, request):
        push: PushState = request.app["hass"].data[DOMAIN]
        sub = await _json_body(request)
        if sub is None:
            return self.json_message("Некорректный запрос", 400)
        endpoint = sub.get("endpoint")
        keys = sub.get("keys") or {}
        if not endpoint or not keys.get("p256dh") or not keys.get("auth"):
            return self.json_message("Неполная подписка", 400)
        push.data["subs"] = [s for s in push.data["subs"] if s["endpoint"] != endpoint]
        push.data["subs"].append({"endpoint": endpoint, "keys": {"p256dh": keys["p256dh"], "auth": keys["auth"]}})
        await push.save()
        return self.json({"subscribed": len(push.data["subs"])})


class PushUnsubscribeView(HomeAssistantView):
    url = "/climate_api/push/unsubscribe"
    name = "climate_panel:push:unsubscribe"
    requires_auth = True

    async def post(self, request):
        push: PushState = request.app["hass"].data[DOMAIN]
        body = await _json_body(request)
        if body is None:
            return self.json_message("Некорректный запрос", 400)
        endpoint = body.get("endpoint")
        push.data["subs"] = [s for s in push.data["subs"] if s["endpoint"] != endpoint]
        await push.save()
        return self.json({"subscribed": len(push.data["subs"])})


class PushTestView(HomeAssistantView):
    url = "/climate_api/push/test"
    name = "climate_panel:push:test"
    requires_auth = True

    async def post(self, request):
        push: PushState = request.app["hass"].data[DOMAIN]
        sent, removed = await push.send_all({
            "title": "Климат: проверка",
            "body": "Уведомления работают.",
            "tag": "climate-test",
            "url": f"{URL_BASE}/index.html#/",
        })
        return self.json({"sent": sent, "removed": removed, "subscribed": len(push.data["subs"])})


class HistoryView(HomeAssistantView):
    url = "/climate_api/history"
    name = "climate_panel:history"
    requires_auth = True

    async def get(self, request):
        from homeassistant.components.recorder import get_instance
        from homeassistant.components.recorder.history import get_significant_states

        hass: HomeAssistant = request.app["hass"]
        rng = request.query.get("range", "24h")
        if rng not in RANGES:
            return self.json_message("Неизвестный диапазон", 400)
        end = dt_util.utcnow()
        start = end - RANGES[rng]
        entity_ids = [v[1] for v in ROOMS.values()] + [v[2] for v in ROOMS.values()] + list(HUM_SENSORS.values())
        states = await get_instance(hass).async_add_executor_job(
            lambda: get_significant_states(
                hass, start, end, entity_ids,
                include_start_time_state=True,
                significant_changes_only=True,
                minimal_response=False,
                no_attributes=True,
            )
        )
        span = (end - start).total_seconds()
        series: dict[str, dict[str, list]] = {"co2": {}, "temp": {}, "hum": {}}
        for rid, (_, co2, temp) in ROOMS.items():
            series["co2"][rid] = _bucket(states.get(co2, []), start, span)
            series["temp"][rid] = _bucket(states.get(temp, []), start, span)
        for rid, hum in HUM_SENSORS.items():
            series["hum"][rid] = _bucket(states.get(hum, []), start, span)
        return self.json({
            "range": rng,
            "from": int(start.timestamp() * 1000),
            "to": int(end.timestamp() * 1000),
            "series": series,
        })


def _bucket(states, start: datetime, span: float) -> list[list[float]]:
    """Усредняет значения по корзинам фиксированной ширины: [[миллисекунды, значение], ...]."""
    width = span / POINTS
    sums: dict[int, list[float]] = {}
    for st in states:
        value = _float(st)
        if value is None or st.last_changed is None:
            continue
        idx = int((st.last_changed - start).total_seconds() // width)
        if 0 <= idx < POINTS:
            sums.setdefault(idx, []).append(value)
    out = []
    for idx in sorted(sums):
        vals = sums[idx]
        mid = start + timedelta(seconds=(idx + 0.5) * width)
        out.append([int(mid.timestamp() * 1000), round(sum(vals) / len(vals), 1)])
    return out

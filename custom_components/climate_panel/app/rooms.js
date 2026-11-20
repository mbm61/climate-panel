// Соответствие «комната → сущности». Права пользователя не позволяют читать реестры HA,
// поэтому сопоставление задано здесь (источник: «Сущности и атрибуты для веб-приложения Климат»).

const bz = (p) => (p ? {
  p,
  climate: `climate.${p}_${p}`,
  setpoint: `number.${p}_auto_setpoint`,
  aggr: `number.${p}_auto_aggressiveness`,
  minFan: `number.${p}_auto_min_fan_speed`,
  maxFan: `number.${p}_auto_max_fan_speed`,
  minDelta: `number.${p}_auto_min_time_delta`,
  boostTime: `number.${p}_boost_time`,
  algo: `select.${p}_auto_algorithm`,
  ramping: `switch.${p}_auto_use_ramping`,
  boost: `switch.${p}_boost`,
  buzzer: `switch.${p}_buzzer`,
  led: `switch.${p}_led`,
  recirc: `switch.${p}_recirculation`,
  resetConfirm: `switch.${p}_reset_filter_confirm`,
  resetBtn: `button.${p}_reset_filter`,
  restartBtn: `button.${p}_restart`,
  outdoor: `sensor.${p}_outdoor_temperature`,
  boostLeft: `sensor.${p}_boost_time_left`,
  filterLeft: `sensor.${p}_filter_time_left`,
  heaterPower: `sensor.${p}_heater_power`,
  productivity: `sensor.${p}_productivity`,
  errors: `sensor.${p}_errors`,
  version: `sensor.${p}_version`,
  wifi: `sensor.${p}_wifi_signal`,
  uptime: `sensor.${p}_uptime`,
  espTemp: `sensor.${p}_esp_temperature`,
  filterWorn: `binary_sensor.${p}_filter_worn_out`,
  problem: `binary_sensor.${p}_state_problem`,
} : null);

const hum = (p) => (p ? {
  p,
  main: `humidifier.${p}_humidifier`,
  fan: `select.${p}_fan_level`,
  brightness: `select.${p}_brightness`,
  rh: `sensor.${p}_relative_humidity`,
  temp: `sensor.${p}_temperature`,
  water: `sensor.${p}_water_level`,
  speed: `sensor.${p}_actual_speed`,
  alarm: `switch.${p}_alarm`,
  clean: `switch.${p}_clean`,
  lock: `switch.${p}_physical_control_locked`,
} : null);

const sens = (th, co2) => (th && co2 ? {
  t: `sensor.${th}_temperature`,
  h: `sensor.${th}_humidity`,
  bat: `sensor.${th}_battery`,
  batLow: `binary_sensor.${th}_battery_plus_low`,
  co2: `sensor.${co2}_co2`,
} : null);

const head = (id) => (id ? {
  climate: `climate.${id}`,
  local: `sensor.${id}_local_temperature`,
  bat: `sensor.${id}_battery`,
  window: `binary_sensor.${id}_window_open`,
  lock: `switch.${id}_child_lock`,
} : null);

// Заполняется из devices.js (boot.js вызывает setDevices до запуска приложения).
export let ROOMS = [];
export let GENERAL = { valve: 'switch.krany_otopleniia' };

// Собирает комнаты из DEV. Обязательные ID проверяются здесь, чтобы ошибка была понятной.
export function setDevices(DEV) {
  const dev = (room) => {
    if (!DEV[room]) throw new Error(`в devices.js нет комнаты «${room}»`);
    return DEV[room];
  };
  const b = dev('bedroom'), n = dev('nursery'), k = dev('kitchen');
  for (const [room, d] of [['bedroom', b], ['nursery', n], ['kitchen', k]]) {
    if (!d.breezer) throw new Error(`в devices.js нет поля «breezer» для комнаты «${room}»`);
    if (!d.sensor) throw new Error(`в devices.js нет поля «sensor» для комнаты «${room}»`);
    if (!d.co2) throw new Error(`в devices.js нет поля «co2» для комнаты «${room}»`);
  }
  if (!n.head) throw new Error('в devices.js нет поля «head» для комнаты «nursery»');
  if (!k.head) throw new Error('в devices.js нет поля «head» для комнаты «kitchen»');
  if (!b.heatTemplate) throw new Error('в devices.js нет поля «heatTemplate» для комнаты «bedroom»');

  ROOMS = [
    {
      id: 'bedroom', name: 'Спальня',
      breezer: bz(b.breezer),
      humidifier: hum(b.humidifier),
      sensors: sens(b.sensor, b.co2),
      // Шаблонный «Термостат 2 комнаты»: current_temperature берётся с комнатного датчика.
      heat: { climate: `climate.${b.heatTemplate}`, template: true },
    },
    {
      id: 'nursery', name: 'Детская',
      breezer: bz(n.breezer),
      humidifier: hum(n.humidifier),
      sensors: sens(n.sensor, n.co2),
      heat: head(n.head),
    },
    {
      id: 'kitchen', name: 'Кухня',
      breezer: bz(k.breezer),
      humidifier: hum(k.humidifier),
      sensors: sens(k.sensor, k.co2),
      heat: head(k.head),
    },
  ];
  // Клапан отопления необязателен: без поля используется прежнее значение.
  GENERAL = { valve: DEV.valve || 'switch.krany_otopleniia' };
}

export function roomById(id) { return ROOMS.find((r) => r.id === id); }

// Все сущности, на которые подписывается приложение.
export function allEntityIds() {
  const ids = new Set([GENERAL.valve]);
  const add = (o) => { if (!o) return; for (const v of Object.values(o)) if (typeof v === 'string' && v.includes('.')) ids.add(v); };
  for (const r of ROOMS) { add(r.breezer); add(r.humidifier); add(r.sensors); add(r.heat); }
  return [...ids];
}

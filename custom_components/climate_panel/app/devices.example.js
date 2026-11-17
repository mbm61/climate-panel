// ШАБЛОН. Скопируйте в devices.js и замените значения на свои (ID из Home Assistant).
// Значения null — если в комнате нет увлажнителя.
export const DEV = {
  bedroom: { breezer: 'ВАШ_ID_БРИЗЕРА', humidifier: 'ВАШ_ID_УВЛАЖНИТЕЛЯ', sensor: 'ВАШ_ID_ДАТЧИКА', co2: 'ВАШ_ID_CO2', heatTemplate: 'ВАШ_ID_ТЕРМОСТАТА' },
  nursery: { breezer: 'ВАШ_ID_БРИЗЕРА', humidifier: 'ВАШ_ID_УВЛАЖНИТЕЛЯ', sensor: 'ВАШ_ID_ДАТЧИКА', co2: 'ВАШ_ID_CO2', head: 'ВАШ_ID_ТЕРМОГОЛОВКИ' },
  kitchen: { breezer: 'ВАШ_ID_БРИЗЕРА', humidifier: null, sensor: 'ВАШ_ID_ДАТЧИКА', co2: 'ВАШ_ID_CO2', head: 'ВАШ_ID_ТЕРМОГОЛОВКИ' },
};

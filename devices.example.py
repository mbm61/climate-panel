# ШАБЛОН. Скопируйте в devices.py и замените значения на свои (ID из Home Assistant).
# humidifier = None, если в комнате нет увлажнителя.
DEVICES = {
    "bedroom": {"humidifier": "ВАШ_ID_УВЛАЖНИТЕЛЯ", "sensor": "ВАШ_ID_ДАТЧИКА", "co2": "ВАШ_ID_CO2"},
    "nursery": {"humidifier": "ВАШ_ID_УВЛАЖНИТЕЛЯ", "sensor": "ВАШ_ID_ДАТЧИКА", "co2": "ВАШ_ID_CO2"},
    "kitchen": {"humidifier": None, "sensor": "ВАШ_ID_ДАТЧИКА", "co2": "ВАШ_ID_CO2"},
}

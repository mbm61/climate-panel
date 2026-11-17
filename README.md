# Climate Panel — PWA «Климат» для Home Assistant

## Установка

### Через HACS (пользовательский репозиторий)
1. В HACS: ⋮ → «Пользовательские репозитории» → адрес `https://github.com/mbm61/climate-panel`, тип «Интеграция». Установите «Климат».
2. Создайте локальные файлы с ID ваших устройств (их нет в репозитории). Положите их в `/config/custom_components/climate_panel/`:
   - `app/devices.example.js` скопируйте как `app/devices.js`;
   - `devices.example.py` скопируйте как `devices.py`;
   заполните оба файла ID из Home Assistant. Оба файла должны содержать одни и те же ID.
3. В `configuration.yaml` добавьте строку: `climate_panel:`
4. «Инструменты разработчика → YAML → Перезапустить Home Assistant» (полный перезапуск).
5. Откройте в Safari на iPhone: https://ваш-домен:8443/climate_app/index.html
6. Введите адрес (подставится сам) и долгосрочный токен отдельного пользователя.
7. Поделиться → «На экран Домой».

### Вручную
1. Скопируйте папку `custom_components/climate_panel` в `/config/custom_components/`.
2. Выполните шаги 2–7 из раздела «Через HACS».

## Где что менять
- `app/rooms.js` — сопоставление комнат и сущностей.
- Обновили файлы — перезагрузите приложение дважды (service worker обновляется в фоне).

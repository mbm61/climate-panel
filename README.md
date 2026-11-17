# Climate Panel — PWA «Климат» для Home Assistant

## Установка
1. Скопируйте папку `climate_panel` в `/config/custom_components/` (должно получиться `/config/custom_components/climate_panel/manifest.json`).
   Затем создайте два локальных файла с ID ваших устройств (их нет в репозитории):
   - `app/devices.example.js` скопируйте в `app/devices.js`;
   - `devices.example.py` скопируйте в `devices.py` (в той же папке `climate_panel`);
   заполните оба файла ID из Home Assistant. Оба файла должны содержать одни и те же ID.
2. В `configuration.yaml` добавьте строку:  `climate_panel:`
3. «Инструменты разработчика → YAML → Перезапустить Home Assistant» (полный перезапуск).
4. Откройте в Safari на iPhone: https://ваш-домен:8443/climate_app/index.html
5. Введите адрес (подставится сам) и долгосрочный токен отдельного пользователя.
6. Поделиться → «На экран Домой».

## Где что менять
- `app/rooms.js` — сопоставление комнат и сущностей.
- Обновили файлы — перезагрузите приложение дважды (service worker обновляется в фоне).

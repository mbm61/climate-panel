# Climate Panel — PWA «Климат» для Home Assistant

## Установка

### Через HACS (пользовательский репозиторий)
1. В HACS: ⋮ → «Пользовательские репозитории» → адрес `https://github.com/mbm61/climate-panel`, тип «Интеграция». Установите «Климат».
2. Создайте папку `/config/climate_panel_local/` (она вне компонента, HACS её не трогает) и положите в неё два файла с ID ваших устройств:
   - `custom_components/climate_panel/app/devices.example.js` из репозитория скопируйте как `/config/climate_panel_local/devices.js`;
   - `custom_components/climate_panel/devices.example.py` из репозитория скопируйте как `/config/climate_panel_local/devices.py`;
   заполните оба файла ID из Home Assistant. Оба файла должны содержать одни и те же ID.
   В `devices.js` поле `humidifier` — `null`, если в комнате нет увлажнителя. Поле `valve` — необязательное: кран отопления, если он не `switch.krany_otopleniia`.
   Если файлов нет или в них не хватает полей, Home Assistant не запустит интеграцию и покажет уведомление «Климат: нет ID устройств» с инструкцией. Приложение без `devices.js` показывает экран с той же инструкцией.
3. В `configuration.yaml` добавьте строку: `climate_panel:`
4. «Инструменты разработчика → YAML → Перезапустить Home Assistant» (полный перезапуск).
5. Откройте в Safari на iPhone: https://ваш-домен:8443/climate_app/index.html
6. Введите адрес (подставится сам) и долгосрочный токен отдельного пользователя.
7. Поделиться → «На экран Домой».

### Вручную
1. Скопируйте папку `custom_components/climate_panel` в `/config/custom_components/`.
2. Выполните шаги 2–7 из раздела «Через HACS».

## Обновление
1. В HACS откройте «Климат» и нажмите «Обновить» (если кнопка неактивна — «Перезагрузить информацию»).
2. Полностью перезапустите Home Assistant.
3. Закройте и заново откройте приложение на телефоне.

## Выпуск новой версии (для автора)
1. Повысьте версию в `custom_components/climate_panel/manifest.json` (поле `version`), в `app/views.js` (`APP_VERSION`) и имя кэша в `app/sw.js` (`CACHE`).
2. Закоммитьте и отправьте в `main`.
3. Создайте релиз с тегом той же версии (например, `v1.9.0`) в GitHub → «Releases» → «Draft a new release». HACS показывает версии по тегам релизов.

## Где что менять
- `app/rooms.js` — сопоставление комнат и сущностей (ID берутся из `devices.js`).
- `app/boot.js` — загрузка `devices.js` и экран ошибки, если файла нет.
- Обновили файлы — перезагрузите приложение дважды (service worker обновляется в фоне).

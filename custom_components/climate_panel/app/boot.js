// Загрузка ID устройств (devices.js) до основного приложения.
// Нет файла или он неполный — вместо белого экрана показывается инструкция.
import { setDevices } from './rooms.js';

const $app = document.getElementById('app');

function showError(title, detail) {
  $app.textContent = '';
  const card = document.createElement('section');
  card.className = 'card';
  const h = document.createElement('h2');
  h.textContent = title;
  const p1 = document.createElement('p');
  p1.textContent = 'Создайте в папке climate_panel_local файл devices.js по образцу devices.example.js '
    + '(он лежит в папке app компонента в репозитории) и заполните ID своих устройств. '
    + 'Затем перезапустите Home Assistant и откройте приложение заново.';
  const p2 = document.createElement('p');
  p2.className = 'status bad';
  p2.textContent = detail;
  card.append(h, p1, p2);
  $app.append(card);
}

async function boot() {
  let mod;
  try {
    mod = await import('./devices.js');
  } catch (err) {
    // отличаем сетевой сбой от отсутствующего файла: HEAD в сеть напрямую (мимо кэша SW)
    let offline = false;
    try { await fetch('./devices.js', { method: 'HEAD', cache: 'no-store' }); } catch (e) { offline = true; }
    if (offline) {
      showError('Нет сети, откройте приложение онлайн', 'Файл с ID устройств загрузится, когда появится связь.');
    } else {
      showError('Нет файла с ID устройств', `devices.js не загружен: ${err.message || err}`);
    }
    return;
  }
  try {
    setDevices(mod.DEV);
  } catch (err) {
    showError('Файл с ID устройств неполный', err.message);
    return;
  }
  await import('./app.js');
}

boot();

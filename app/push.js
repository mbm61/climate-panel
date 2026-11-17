// Web Push: разрешение, подписка браузера и регистрация подписки на сервере Home Assistant.

export const pushSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function keyBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const withTimeout = (promise, ms) => Promise.race([
  promise, new Promise((resolve) => setTimeout(() => resolve(null), ms)),
]);

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await withTimeout(navigator.serviceWorker.ready, 3000);
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

export async function enablePush(ha) {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Разрешение на уведомления не выдано. Включите его в настройках iPhone.');
  const { publicKey } = await ha.api('/climate_api/push/key');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  await ha.api('/climate_api/push/subscribe', { method: 'POST', body: sub.toJSON() });
  return sub;
}

export async function disablePush(ha) {
  const sub = await currentSubscription();
  if (!sub) return;
  await ha.api('/climate_api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } });
  await sub.unsubscribe();
}

export async function testPush(ha) {
  return ha.api('/climate_api/push/test', { method: 'POST' });
}

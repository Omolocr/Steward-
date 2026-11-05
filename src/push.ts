// Push notifications on the phone: ask permission, get this phone's Expo push token, tell the church server, and open the right screen when a notification is tapped.
// Everything here is best-effort: if permission is refused or anything fails, the app works exactly as before (it just polls every 20 s).
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api';

let current: string | null = null;

// Show notifications even while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
});

/** Returns true when this phone is now registered. */
export async function registerForPush(): Promise<boolean> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', { name: 'Church Connect', importance: Notifications.AndroidImportance.HIGH });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
    if (status !== 'granted') return false;
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
    const t = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    current = t.data;
    await api.post('/me/push-token', { token: t.data, platform: Platform.OS === 'ios' ? 'ios' : 'android' });
    return true;
  } catch { return false; }
}

/** Called just before signing out, while the sign-in is still valid: this phone stops receiving this person's notifications. */
export function unregisterPush() {
  if (!current) return;
  const t = current; current = null;
  api.post('/me/push-token/off', { token: t }).catch(() => {});
}

/** Calls `onOpen(screen)` when the person taps a notification (also when the app was closed). Returns a cleanup function. */
export function onNotificationTap(onOpen: (screen: string) => void): () => void {
  const handle = (r: { notification: { request: { content: { data?: Record<string, unknown> } } } } | null) => {
    const s = r?.notification.request.content.data?.screen;
    if (typeof s === 'string') onOpen(s);
  };
  Notifications.getLastNotificationResponseAsync().then(handle).catch(() => {});
  const sub = Notifications.addNotificationResponseReceivedListener(handle);
  return () => sub.remove();
}

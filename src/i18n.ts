import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert as RNAlert, AlertButton } from 'react-native';
import { SW } from './sw';

export type Lang = 'en' | 'sw';
let lang: Lang = 'en';
const KEY = 'church-connect-lang';

export const getLang = () => lang;
export const setLangValue = (l: Lang) => { lang = l; AsyncStorage.setItem(KEY, l).catch(() => {}); };
export const loadLang = async (): Promise<Lang> => {
  try { const v = await AsyncStorage.getItem(KEY); if (v === 'sw' || v === 'en') lang = v; } catch { /* keep English */ }
  return lang;
};

const fill = (s: string, args: (string | number)[]) => s.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? ''));

// Translate an exact English text. Unknown text stays as it is.
export const tr = (s: string): string => (lang === 'sw' && s in SW ? SW[s] : s);
// Translate a template such as 'Welcome, {0}' and fill in the values.
export const t = (key: string, ...args: (string | number)[]): string => fill(tr(key), args);

// Same as React Native's Alert, with the title, message and button names translated.
export const Alert = {
  alert: (title: string, message?: string, buttons?: AlertButton[]) =>
    RNAlert.alert(tr(title), message ? tr(message) : message, buttons?.map((b) => ({ ...b, text: b.text ? tr(b.text) : b.text }))),
};

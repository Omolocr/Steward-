import React, { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api';
import { Lang, getLang, loadLang, setLangValue } from './i18n';

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: 'en', setLang: () => {} });
export const useLang = () => useContext(Ctx);

// Holds the chosen language. The screens below are rebuilt when it changes, so every text switches at once.
export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setL] = useState<Lang>(getLang());
  const [ready, setReady] = useState(false);
  useEffect(() => { loadLang().then((l) => { setL(l); setReady(true); }); }, []);
  const setLang = (l: Lang) => { setLangValue(l); setL(l); api.post('/me/lang', { lang: l }).catch(() => {}); }; // tell the server too (ignored when not signed in)
  if (!ready) return null;
  return <Ctx.Provider value={{ lang, setLang }}>{children}</Ctx.Provider>;
}

export function LangKeyed({ children }: { children: React.ReactNode }) {
  const { lang } = useLang();
  return <React.Fragment key={lang}>{children}</React.Fragment>;
}

import React, { createContext, useContext, useState } from 'react';

export interface Route { name: string; params?: Record<string, string> }
interface NavCtx { route: Route; go: (name: string, params?: Record<string, string>) => void; back: () => void; reset: () => void; canBack: boolean }

const Ctx = createContext<NavCtx>(null as unknown as NavCtx);
export const useNav = () => useContext(Ctx);

export function NavProvider({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);
  const value: NavCtx = {
    route: stack[stack.length - 1],
    go: (name, params) => setStack((s) => [...s, { name, params }]),
    back: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
    reset: () => setStack([{ name: 'home' }]),
    canBack: stack.length > 1,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

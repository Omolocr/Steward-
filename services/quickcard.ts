// One-page quick-start card for a role: what the person does in the app, in a few lines they can print or send.
// Built from the same guide text as the first-run guide. The church number is not printed (only the Church Admin sees it).
export interface CardGuide { title: string; steps: { icon: string; title: string; body: string }[] }

export function composeQuickCard(g: CardGuide, churchName: string, tr: (s: string) => string, heading = 'Quick-start card'): string {
  const line = '─'.repeat(28);
  return [
    `${tr(heading).toUpperCase()}`, churchName, line, tr(g.title), '',
    ...g.steps.map((s, i) => `${i + 1}. ${s.icon} ${tr(s.title)}\n   ${tr(s.body)}`),
    line, tr('Nothing is ever deleted — records are archived and kept.'),
  ].join('\n');
}

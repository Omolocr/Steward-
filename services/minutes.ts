// Minutes and meeting notices written for the Secretary from a few fields. Pure functions (no screens, no network), so they are easy to test.
export interface MinutesInput {
  kind: string; date: string; time: string; venue: string; chair: string; secretary: string;
  present: string; apologies: string; agenda: string; resolutions: string; actions: string; nextDate: string; nextTime: string;
}
export const emptyMinutes = (): MinutesInput => ({ kind: '', date: '', time: '', venue: '', chair: '', secretary: '', present: '', apologies: '', agenda: '', resolutions: '', actions: '', nextDate: '', nextTime: '' });

/** Turns typed lines ("1. Opening", "- Budget", "• Camp") into clean items, dropping empty lines and list marks. */
export const lines = (s: string): string[] => String(s || '').split(/\r?\n/).map((x) => x.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean);

const W = {
  en: { minutes: 'MINUTES OF THE', notice: 'NOTICE OF', date: 'Date', time: 'Time', venue: 'Venue', chair: 'Chair', secretary: 'Secretary', present: 'Present', apologies: 'Apologies', agenda: 'AGENDA', resolutions: 'RESOLUTIONS', actions: 'ACTION ITEMS', next: 'NEXT MEETING', at: 'at', closing: 'The meeting closed with prayer.', will: 'will be held', on: 'on', all: 'All members of the board are asked to attend.', recorded: 'Minutes recorded by' },
  sw: { minutes: 'MUHTASARI WA', notice: 'TANGAZO LA', date: 'Tarehe', time: 'Saa', venue: 'Mahali', chair: 'Mwenyekiti', secretary: 'Katibu', present: 'Waliohudhuria', apologies: 'Waliotoa udhuru', agenda: 'AJENDA', resolutions: 'MAAZIMIO', actions: 'MAMBO YA KUTEKELEZA', next: 'KIKAO KIJACHO', at: 'saa', closing: 'Kikao kilifungwa kwa maombi.', will: 'kitafanyika', on: 'tarehe', all: 'Wajumbe wote wanaombwa kuhudhuria.', recorded: 'Muhtasari umeandikwa na' },
};
const numbered = (items: string[]) => items.map((x, i) => `  ${i + 1}. ${x}`);

export function composeMinutes(i: MinutesInput, sw = false): { title: string; body: string } {
  const w = sw ? W.sw : W.en; const kind = i.kind.trim() || (sw ? 'KIKAO' : 'MEETING');
  const out: string[] = [`${w.minutes} ${kind.toUpperCase()}`];
  const meta = [i.date && `${w.date}: ${i.date}`, i.time && `${w.time}: ${i.time}`, i.venue && `${w.venue}: ${i.venue}`].filter(Boolean).join('   '); if (meta) out.push(meta);
  const who = [i.chair && `${w.chair}: ${i.chair}`, i.secretary && `${w.secretary}: ${i.secretary}`].filter(Boolean).join('   '); if (who) out.push(who);
  const att = [i.present.trim() && `${w.present}: ${i.present.trim()}`, i.apologies.trim() && `${w.apologies}: ${i.apologies.trim()}`].filter(Boolean).join('   '); if (att) out.push(att);
  const ag = lines(i.agenda), rs = lines(i.resolutions), ac = lines(i.actions);
  if (ag.length) out.push('', w.agenda, ...numbered(ag));
  if (rs.length) out.push('', w.resolutions, ...numbered(rs));
  if (ac.length) out.push('', w.actions, ...numbered(ac));
  if (i.nextDate.trim()) out.push('', `${w.next}: ${i.nextDate.trim()}${i.nextTime.trim() ? ` ${w.at} ${i.nextTime.trim()}` : ''}`);
  out.push('', w.closing);
  if (i.secretary.trim()) out.push(`${w.recorded} ${i.secretary.trim()}.`);
  return { title: `${kind} – ${i.date.trim() || (sw ? 'tarehe haijaandikwa' : 'date not written')}`, body: out.join('\n') };
}

/** A notice of a meeting, ready to post on the church notice board. Uses the "next meeting" date when the minutes have one. */
export function composeNotice(i: MinutesInput, sw = false, useNext = false): { title: string; body: string } {
  const w = sw ? W.sw : W.en; const kind = i.kind.trim() || (sw ? 'Kikao' : 'Meeting');
  const date = (useNext ? i.nextDate : i.date).trim(), time = (useNext ? i.nextTime : i.time).trim(), venue = i.venue.trim();
  const when = [date && `${w.on} ${date}`, time && `${w.at} ${time}`].filter(Boolean).join(' ');
  const out = [`${kind} ${w.will}${when ? ' ' + when : ''}${venue ? ` (${venue})` : ''}.`];
  const ag = lines(useNext ? '' : i.agenda); if (ag.length) out.push('', w.agenda + ':', ...numbered(ag));
  out.push('', w.all);
  return { title: `${w.notice} ${kind.toUpperCase()}${date ? ' – ' + date : ''}`, body: out.join('\n') };
}

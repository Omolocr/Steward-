// Tools that save the Treasurer, the Secretary and the Church Clerk hours of work. Everything here is archive-only:
// nothing is deleted, status changes keep their history, and every action is written to the audit trail.
//   Treasurer: confirm all M-Pesa-verified payments in one tap; reconciliation and daily cash-up; every member's giving statement in one spreadsheet.
//   Secretary and Clerk: keep the membership roll (transferred out, deceased, inactive, back to active); roll export and statistics; baptism, membership and transfer letters.
import { csvLine } from './bulk.mjs';

const ROLL = ['active', 'inactive', 'transferred_out', 'deceased'];
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const LETTER = {
  en: {
    baptism: (c) => ['BAPTISM CERTIFICATE', c.church, '', `Ref: ${c.ref}`, `Date: ${c.today}`, '', `This is to certify that ${c.name} was baptised on ${c.baptismDate} and received into the membership of ${c.church}.`, c.memberNo ? `Membership number: ${c.memberNo}` : '', '', '________________________', 'Pastor', '', '________________________', 'Church Clerk'],
    membership: (c) => ['LETTER OF MEMBERSHIP', c.church, '', `Ref: ${c.ref}`, `Date: ${c.today}`, '', 'TO WHOM IT MAY CONCERN', '', `This is to confirm that ${c.name}${c.memberNo ? ' (membership number ' + c.memberNo + ')' : ''} is a member in good standing of ${c.church}.`, '', '________________________', 'Church Clerk'],
    transfer: (c) => ['LETTER OF TRANSFER', c.church, '', `Ref: ${c.ref}`, `Date: ${c.today}`, '', `To: The Clerk, ${c.destination}`, '', `${c.name}${c.memberNo ? ' (membership number ' + c.memberNo + ')' : ''}, a member of ${c.church}, is moving to your area. We recommend them to your fellowship and ask that you receive them into membership according to the usual procedure.`, '', 'Please confirm receipt so that our roll can be updated.', '', '________________________', 'Pastor', '', '________________________', 'Church Clerk'],
  },
  sw: {
    baptism: (c) => ['CHETI CHA UBATIZO', c.church, '', `Kumb: ${c.ref}`, `Tarehe: ${c.today}`, '', `Hii ni kuthibitisha kwamba ${c.name} alibatizwa tarehe ${c.baptismDate} na kupokelewa katika uanachama wa ${c.church}.`, c.memberNo ? `Nambari ya uanachama: ${c.memberNo}` : '', '', '________________________', 'Mchungaji', '', '________________________', 'Karani wa Kanisa'],
    membership: (c) => ['BARUA YA UANACHAMA', c.church, '', `Kumb: ${c.ref}`, `Tarehe: ${c.today}`, '', 'KWA ANAYEHUSIKA', '', `Hii ni kuthibitisha kwamba ${c.name}${c.memberNo ? ' (nambari ya uanachama ' + c.memberNo + ')' : ''} ni mshiriki mwenye hadhi nzuri wa ${c.church}.`, '', '________________________', 'Karani wa Kanisa'],
    transfer: (c) => ['BARUA YA UHAMISHO', c.church, '', `Kumb: ${c.ref}`, `Tarehe: ${c.today}`, '', `Kwa: Karani, ${c.destination}`, '', `${c.name}${c.memberNo ? ' (nambari ya uanachama ' + c.memberNo + ')' : ''}, mshiriki wa ${c.church}, anahamia eneo lenu. Tunampendekeza kwenu na tunaomba mumpokee katika uanachama kwa utaratibu wa kawaida.`, '', 'Tafadhali thibitisheni kupokea ili orodha yetu isasishwe.', '', '________________________', 'Mchungaji', '', '________________________', 'Karani wa Kanisa'],
  },
};

export function installClerkTools(k) {
  const { route, must, HttpError, q, q1, run, log, actor, isIn, getRec, setData, out, nextNo, receiptsOf, sumBy, round2, keDate, now, ctx, issueReceipt, mpesaOn } = k;
  const live = (col) => q('SELECT * FROM records WHERE col=? AND archived=0', col);

  // ================================================================ TREASURER
  // One tap for the payments that M-Pesa itself has already confirmed (same code, same amount).
  route('POST', '/payments/receive-verified', true, ({ me, body }) => {
    must(isIn(actor(me), 'treasurer'), 403, 'Only the Church Treasurer can confirm payments.');
    must(mpesaOn(), 409, 'M-Pesa checking is not switched on, so payments cannot be confirmed in bulk.');
    const only = Array.isArray(body.ids) ? new Set(body.ids.map(String)) : null;
    const isV = (p) => p.status === 'pending' && p.verification && p.verification.state === 'verified';
    const rows = live('payments').filter((r) => { const p = JSON.parse(r.data); return isV(p) && (!only || only.has(r.id)); }).sort((a, b) => (a.created_at < b.created_at ? -1 : 1)).slice(0, 200);
    let total = 0, received = 0; const failed = [];
    for (const r of rows) {
      try { const p = JSON.parse(r.data); issueReceipt(r, p, { id: me.id, name: me.name, church: me.church }); total += p.amount; received++; }
      catch (e) { failed.push({ id: r.id, error: e.message }); }
    }
    if (received) log(me.id, 'update', 'payments', '', `confirmed ${received} M-Pesa-verified payments in one go (KSh ${round2(total)})`);
    const left = live('payments').filter((r) => isV(JSON.parse(r.data))).length;
    return { received, total: round2(total), failed: failed.length, left };
  });

  // Reconciliation and cash-up: what was receipted, what reached the Pay Bill, what is still waiting.
  route('GET', '/finance/reconciliation', true, ({ me, query }) => {
    must(isIn(actor(me), 'treasurer', 'pastor'), 403, 'Only the Treasurer or Pastor can see this report.');
    const from = query.get('from') || '', to = query.get('to') || '';
    must(ISO_DAY.test(from) && ISO_DAY.test(to) && from <= to && (Date.parse(to) - Date.parse(from)) / 86400e3 <= 366, 400, 'Choose a valid date range.');
    const inR = (d) => d >= from && d <= to;
    const days = {}; const day = (d) => (days[d] ||= { date: d, receipts: 0, receipted: 0, mpesa: 0 });
    const rc = receiptsOf().filter((r) => inR(r.date));
    for (const r of rc) { const x = day(r.date); x.receipts++; x.receipted = round2(x.receipted + r.amount); }
    const receipted = { count: rc.length, total: round2(rc.reduce((t, r) => t + r.amount, 0)), byCategory: sumBy(rc) };
    const pend = live('payments').map((r) => JSON.parse(r.data)).filter((p) => p.status === 'pending');
    const waiting = { count: pend.length, total: round2(pend.reduce((t, p) => t + p.amount, 0)), verified: pend.filter((p) => p.verification && p.verification.state === 'verified').length, mismatched: pend.filter((p) => p.verification && p.verification.state === 'amount_mismatch').length };
    let mpesa = null;
    if (mpesaOn()) {
      const tx = q('SELECT trans_id, amount, trans_time, payment_id FROM mpesa_tx').map((t) => ({ ...t, date: /^\d{14}$/.test(t.trans_time || '') ? `${t.trans_time.slice(0, 4)}-${t.trans_time.slice(4, 6)}-${t.trans_time.slice(6, 8)}` : '' })).filter((t) => t.date && inR(t.date));
      for (const t of tx) { const x = day(t.date); x.mpesa = round2(x.mpesa + t.amount); }
      const un = tx.filter((t) => !t.payment_id);
      mpesa = { count: tx.length, total: round2(tx.reduce((t, x) => t + x.amount, 0)), unclaimedCount: un.length, unclaimedTotal: round2(un.reduce((t, x) => t + x.amount, 0)) };
    }
    const rows = Object.values(days).sort((a, b) => (a.date < b.date ? -1 : 1));
    const header = ['Date', 'Receipts', 'Receipted (KSh)', ...(mpesa ? ['M-Pesa Pay Bill (KSh)'] : [])];
    const lines = [csvLine(header), ...rows.map((r) => csvLine([r.date, r.receipts, r.receipted, ...(mpesa ? [r.mpesa] : [])])), csvLine(['TOTAL', receipted.count, receipted.total, ...(mpesa ? [mpesa.total] : [])])];
    log(me.id, 'report', 'reports', `${from}..${to}`, 'reconciliation');
    return { from, to, receipted, waiting, mpesa, difference: mpesa ? round2(mpesa.total - receipted.total) : null, days: rows, csv: '﻿' + lines.join('\r\n') + '\r\n' };
  });

  // Every member's giving for a year in one spreadsheet (so statements can be prepared or sent without opening them one by one).
  route('GET', '/statements/:year/all', true, ({ me, params }) => {
    must(isIn(actor(me), 'treasurer', 'pastor'), 403, 'Only the Treasurer or Pastor can see this report.');
    must(/^20\d\d$/.test(params.year), 400, 'Choose a valid year.');
    const rc = receiptsOf().filter((r) => r.date.startsWith(params.year));
    const cats = [...new Set(rc.flatMap((r) => (r.allocations || []).map((a) => a.category)))].sort();
    const by = new Map();
    for (const r of rc) { const m = by.get(r.memberId) || { name: r.memberName, items: [] }; m.items.push(r); by.set(r.memberId, m); }
    const people = [...by.entries()].map(([id, m]) => { const u = q1('SELECT phone FROM users WHERE id=?', id); const per = sumBy(m.items); return { name: m.name, phone: u ? u.phone : '', receipts: m.items.length, total: round2(m.items.reduce((t, r) => t + r.amount, 0)), per }; }).sort((a, b) => (a.name < b.name ? -1 : 1));
    const lines = [csvLine(['Member', 'Phone', 'Receipts', 'Total (KSh)', ...cats]), ...people.map((p) => csvLine([p.name, p.phone, p.receipts, p.total, ...cats.map((c) => p.per[c] || 0)])), csvLine(['TOTAL', '', rc.length, round2(rc.reduce((t, r) => t + r.amount, 0)), ...cats.map((c) => round2(people.reduce((t, p) => t + (p.per[c] || 0), 0)))])];
    log(me.id, 'export', 'receipts', params.year, `all statements (${people.length})`);
    return { year: params.year, members: people.length, total: round2(rc.reduce((t, r) => t + r.amount, 0)), csv: '﻿' + lines.join('\r\n') + '\r\n' };
  });

  // ================================================================ SECRETARY AND CLERK
  const canRoll = (a) => isIn(a, 'secretary', 'clerk');
  const canSeeRoll = (a) => isIn(a, 'secretary', 'clerk', 'pastor', 'elder1', 'elder2', 'elder3', 'elder4');

  route('POST', '/memberships/:id/status', true, ({ me, params, body }) => {
    must(canRoll(actor(me)), 403, 'Only the Secretary or Clerk keep the membership roll.');
    const r = getRec('memberships', params.id); must(r && !r.archived, 404, 'Member not found.');
    const d = JSON.parse(r.data);
    must(ROLL.includes(d.status), 409, 'Applications are decided by the Church Board.');
    const to = String(body.status || ''); must(ROLL.includes(to), 400, 'Choose a status.');
    must(to !== d.status, 409, 'Already that status.');
    const destination = String(body.destination || '').trim().slice(0, 150);
    must(to !== 'transferred_out' || destination, 400, 'Write the church they are moving to.');
    const date = ISO_DAY.test(String(body.date || '')) ? body.date : keDate(now());
    const note = String(body.note || '').trim().slice(0, 300);
    const history = [...(d.statusHistory || []), { from: d.status, to, date, by: me.name, note, destination }];
    setData(r.id, { ...d, status: to, statusDate: date, statusNote: note, statusDestination: to === 'transferred_out' ? destination : '', statusHistory: history }, me.id, `roll: ${d.status} -> ${to}`);
    return { record: out(getRec('memberships', r.id)) };
  });

  route('GET', '/membership/roll', true, ({ me }) => {
    must(canSeeRoll(actor(me)), 403, 'You are not allowed to see this.');
    const rows = live('memberships').map((r) => ({ id: r.id, createdAt: r.created_at, ...JSON.parse(r.data) })).filter((m) => ROLL.includes(m.status));
    const year = (d) => String(d || '').slice(0, 4);
    const count = (list, f) => { const m = {}; for (const x of list) { const y = f(x); if (/^\d{4}$/.test(y)) m[y] = (m[y] || 0) + 1; } return m; };
    const stats = {
      onRoll: rows.filter((m) => m.status === 'active').length,
      byStatus: Object.fromEntries(ROLL.map((s) => [s, rows.filter((m) => m.status === s).length])),
      baptismsByYear: count(rows.filter((m) => m.entry === 'baptism'), (m) => year(m.baptismDate || keDate(m.createdAt))),
      transfersInByYear: count(rows.filter((m) => m.entry === 'transfer'), (m) => year(keDate(m.createdAt))),
      transfersOutByYear: count(rows.filter((m) => m.status === 'transferred_out'), (m) => year(m.statusDate)),
      deathsByYear: count(rows.filter((m) => m.status === 'deceased'), (m) => year(m.statusDate)),
    };
    const lines = [csvLine(['Member no', 'Name', 'ID number', 'Phone', 'Entry', 'Baptism date', 'From church', 'Status', 'Status date', 'Moved to / note']),
      ...rows.sort((a, b) => String(a.memberNumber || '~').localeCompare(String(b.memberNumber || '~'))).map((m) => csvLine([m.memberNumber || '', m.fullName, m.idNumber || '', m.phone || '', m.entry, m.baptismDate || '', m.fromChurch || '', m.status, m.statusDate || '', m.statusDestination || m.statusNote || ''])) ];
    log(me.id, 'export', 'memberships', '', `roll (${rows.length})`);
    return { stats, count: rows.length, csv: '﻿' + lines.join('\r\n') + '\r\n' };
  });

  route('GET', '/membership/:id/letter', true, ({ me, params, query }) => {
    must(isIn(actor(me), 'secretary', 'clerk', 'pastor'), 403, 'Only the Secretary, Clerk or Pastor can issue letters.');
    const r = getRec('memberships', params.id); must(r && !r.archived, 404, 'Member not found.');
    const d = JSON.parse(r.data); const type = query.get('type');
    must(['baptism', 'membership', 'transfer'].includes(type), 400, 'Choose a letter type.');
    if (type === 'baptism') must(d.entry === 'baptism' && d.baptismDate, 409, 'This person has no baptism date on record.');
    if (type === 'membership') must(d.status === 'active', 409, 'Only a member on the roll can have a letter of membership.');
    let destination = '';
    if (type === 'transfer') {
      must(d.status === 'active' || d.status === 'transferred_out', 409, 'Only a member on the roll can be transferred.');
      destination = String(query.get('destination') || d.statusDestination || '').trim().slice(0, 150); must(destination, 400, 'Write the church they are moving to.');
    }
    const today = keDate(now());
    const ref = `LTR-${today.slice(0, 4)}-${String(nextNo('letter')).padStart(4, '0')}`;
    const L = LETTER[query.get('lang') === 'sw' ? 'sw' : 'en'][type];
    const text = L({ church: ctx().church.name, name: d.fullName, memberNo: d.memberNumber || '', baptismDate: d.baptismDate || '', destination, ref, today }).join('\n').replace(/\n{3,}/g, '\n\n');
    log(me.id, 'letter', 'memberships', r.id, `${type} ${ref}`);
    return { ref, type, text };
  });
}

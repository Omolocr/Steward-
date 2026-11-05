// Team quick entry ("sandbox access"). For the app developer and the development team to check, test and develop every console
// without SMS codes: each console has a reserved phone number, and tapping it signs in at once.
//
// SAFETY: this is a door with no lock, so it only exists on a SANDBOX server holding made-up data.
//   * It is off unless SANDBOX_ACCESS=yes.
//   * The server refuses to start with SANDBOX_ACCESS=yes together with PERSISTENT_STORAGE=yes (real church data).
//   * Only the reserved numbers below work (0700 000 xxx, a block no mobile operator has issued). Any other number still needs an SMS code.
//   * Every entry is written to the platform audit trail.
export const SANDBOX_PREFIX = '0700000';

export function sandboxNumbers(LEADER_ROLES) {
  const out = [];
  for (let i = 1; i <= 10; i++) out.push({ phone: SANDBOX_PREFIX + String(i).padStart(3, '0'), console: 'developer', role: 'developer', label: `App Developer console, team member ${i}` });
  out.push({ phone: SANDBOX_PREFIX + '101', console: 'church_admin', role: 'church_admin', label: 'Church App Admin console' });
  LEADER_ROLES.forEach((r, i) => out.push({ phone: SANDBOX_PREFIX + String(201 + i), console: 'leader', role: r, label: `Dashboard: ${r.replace(/_/g, ' ')}` }));
  for (let i = 1; i <= 5; i++) out.push({ phone: SANDBOX_PREFIX + String(300 + i), console: 'member', role: 'member', label: `Member ${i}` });
  return out;
}

export function installSandbox(k) {
  const { route, must, HttpError, sign, normPhone, pq1, prun, plog, uid, now, churchOf, inChurch, q1, run, joinChurch, memberToken, churchPublic, publicUser, LEADER_ROLES, getDefaultChurch, limited } = k;
  const NUMBERS = sandboxNumbers(LEADER_ROLES);

  // Anyone may see the list: a sandbox holds no real data, and the list is what the sign-in screens show as buttons.
  route('GET', '/sandbox/numbers', false, () => ({ numbers: NUMBERS }));

  route('POST', '/sandbox/enter', false, ({ body, ip }) => {
    must(!limited('sandbox:' + ip, 120, 3600e3), 429, 'Too many attempts. Please try again later.');
    const phone = normPhone(body.phone);
    const n = NUMBERS.find((x) => x.phone === phone);
    must(n, 403, 'That is not a team test number. Use the list on the sign-in screen.');
    // developer console
    if (n.console === 'developer') {
      let d = pq1('SELECT * FROM developers WHERE phone=?', phone);
      const name = 'Team developer ' + Number(phone.slice(-3));
      if (!d) { const id = uid(); prun('INSERT INTO developers(id,phone,name,status,created_by,created_at) VALUES(?,?,?,?,?,?)', id, phone, name, 'active', 'sandbox', now()); d = pq1('SELECT * FROM developers WHERE id=?', id); }
      else if (d.status !== 'active') { prun("UPDATE developers SET status='active', archived_at=NULL WHERE id=?", d.id); d = pq1('SELECT * FROM developers WHERE id=?', d.id); }
      plog(d.id, 'sandbox.enter', null, phone + ' developer console');
      return { token: sign({ dev: d.id, exp: Date.now() + 12 * 3600e3 }), developer: { id: d.id, name: d.name, phone: d.phone, status: d.status, createdAt: d.created_at, archivedAt: d.archived_at }, kind: 'developer' };
    }
    // church side: the church admin console, every leader's dashboard, and plain members (in the church the server was started with)
    const dc = getDefaultChurch();
    must(dc, 409, 'This server has no church yet. Start it with DEFAULT_CHURCH="Your Church Name".');
    const c = churchOf(dc.id);
    return inChurch(c, () => {
      const b = pq1("SELECT * FROM bindings WHERE phone=? AND status='active'", phone);
      let u = b && b.church_id === c.id ? q1('SELECT * FROM users WHERE id=?', b.user_id) : null;
      if (!u) {
        const nm = n.role === 'member' ? 'Test Member ' + phone.slice(-1) : 'Test ' + n.role.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
        u = joinChurch(c, phone, { name: nm, idNumber: '9' + phone.slice(-7), role: null });
      }
      // make sure this number really has the console's role, approved and active, every time
      run("UPDATE users SET role=?, requested_role=?, role_status='approved', join_status='approved', archived=0 WHERE id=?", n.role, n.role, u.id);
      u = q1('SELECT * FROM users WHERE id=?', u.id);
      plog(u.id, 'sandbox.enter', c.id, phone + ' ' + n.role);
      return { token: memberToken(c, u), user: publicUser(u), church: churchPublic(c), kind: n.console };
    });
  });
}

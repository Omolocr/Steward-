// Office tools: Sabbath School attendance register, Building Committee pledge tracker, and camp meeting registration.
// All of them are archive-only like the rest of the app: a mistaken entry is archived (and can be restored), never deleted.
import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { Alert, t as tt, tr } from '../i18n';
import { Badge, Btn, C, Card, Chips, Empty, Field, H, P, Row, Screen } from '../components/ui';
import { useNav } from '../nav';
import { ksh } from '../services/payments';
import { canKeepAttendance, canKeepPledges, canManageCamp, canReadAttendance, canReadPledges, canSeeAllCampRegistrations } from '../services/permissions';
import { useDB } from '../store/db';
import { CampRegistration, OfficeRecord } from '../types';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** The most recent Saturday (today, when today is a Saturday). */
const lastSabbath = () => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 1) % 7)); return iso(d); };
const num = (s: string) => (s.trim() === '' ? NaN : Number(s));
const Bar = ({ pct, color = C.ok }: { pct: number; color?: string }) => (
  <View style={{ height: 8, backgroundColor: '#E5E7EB', borderRadius: 4, overflow: 'hidden', marginVertical: 6 }}>
    <View style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: 8, backgroundColor: color }} />
  </View>
);

// ------------------------------------------------------------------ Sabbath School attendance register
const CLASSES = ['Adult', 'Youth', 'Juniors', 'Primary', 'Kindergarten', 'Cradle Roll'];
const sumPresent = (r: OfficeRecord) => (r.classes ?? []).reduce((s, c) => s + c.present, 0);
const sumRoll = (r: OfficeRecord) => (r.classes ?? []).reduce((s, c) => s + c.enrolled, 0);

export function AttendanceRegister() {
  const { me, db, add, archive } = useDB();
  const { back } = useNav();
  const list = useMemo(() => db.office.filter((o) => o.kind === 'attendance' && !o.archived).sort((a, b) => b.date.localeCompare(a.date)), [db.office]);
  const last = list[0];
  const [date, setDate] = useState(lastSabbath());
  const [rows, setRows] = useState<{ name: string; enrolled: string; present: string }[]>([]);
  const [visitors, setVisitors] = useState('0');
  const [lesson, setLesson] = useState('');
  if (!me || !canReadAttendance(me)) return null;
  const keep = canKeepAttendance(me);
  // Start from last Sabbath's classes and rolls, so only the "present" numbers need typing each week.
  const shown = rows.length ? rows : (last?.classes ?? [{ name: 'Adult', enrolled: 0, present: 0 }]).map((c) => ({ name: c.name, enrolled: String(c.enrolled), present: '' }));
  const setRow = (i: number, k: 'name' | 'enrolled' | 'present', v: string) => setRows(shown.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const recent = list.slice(0, 8);
  const avg = recent.length ? Math.round(recent.reduce((s, r) => s + sumPresent(r) + (r.visitors ?? 0), 0) / recent.length) : 0;

  const save = async () => {
    const classes = shown.map((r) => ({ name: r.name.trim(), enrolled: num(r.enrolled), present: num(r.present) }));
    if (classes.some((c) => !c.name || isNaN(c.enrolled) || isNaN(c.present))) return Alert.alert('Missing', 'Each class needs a name, the number on the roll and the number present.');
    if (classes.some((c) => c.present > c.enrolled)) return Alert.alert('Check the numbers', 'More people present than on the roll in a class.');
    const v = visitors.trim() === '' ? 0 : num(visitors);
    if (isNaN(v)) return Alert.alert('Missing', 'Visitors must be a number.');
    if (await add('office', { office: 'sabbath_school', kind: 'attendance', date, classes, visitors: v, lesson: lesson.trim() })) { setRows([]); setVisitors('0'); setLesson(''); }
  };

  return (
    <Screen title="Sabbath School Attendance" onBack={back}>
      <Card>
        <H>Last 8 Sabbaths</H>
        <P mute>{recent.length ? tt('Average attendance: {0} (members and visitors)', avg) : 'No attendance recorded yet.'}</P>
        {recent.slice().reverse().map((r) => { const tot = sumPresent(r) + (r.visitors ?? 0); const max = Math.max(1, ...recent.map((x) => sumPresent(x) + (x.visitors ?? 0))); return (
          <View key={r.id}><Text style={{ color: C.mute, fontSize: 12 }}>{r.date} · {tot}</Text><Bar pct={(tot / max) * 100} color={C.primary} /></View>
        ); })}
      </Card>
      {keep && (
        <Card>
          <H>Record this Sabbath</H>
          <Field label="Sabbath date (YYYY-MM-DD)" value={date} onChangeText={setDate} />
          {shown.map((r, i) => (
            <View key={i} style={{ marginBottom: 6 }}>
              <Field label="Class" value={r.name} onChangeText={(v) => setRow(i, 'name', v)} />
              <Row>
                <View style={{ flex: 1 }}><Field label="On the roll" value={r.enrolled} onChangeText={(v) => setRow(i, 'enrolled', v)} keyboardType="number-pad" /></View>
                <View style={{ flex: 1 }}><Field label="Present" value={r.present} onChangeText={(v) => setRow(i, 'present', v)} keyboardType="number-pad" /></View>
              </Row>
            </View>
          ))}
          <P mute>Add a class:</P>
          <Chips options={CLASSES.filter((c) => !shown.some((r) => r.name === c))} value={[]} onChange={(c) => setRows([...shown, { name: c, enrolled: '', present: '' }])} />
          <Field label="Visitors" value={visitors} onChangeText={setVisitors} keyboardType="number-pad" />
          <Field label="Lesson studied (optional)" value={lesson} onChangeText={setLesson} />
          <Btn label="Save attendance" onPress={save} />
        </Card>
      )}
      {list.length ? list.map((r) => { const roll = sumRoll(r), pr = sumPresent(r); return (
        <Card key={r.id}>
          <Badge text={r.date} /><H>{tt('{0} present of {1} on the roll', pr, roll)}</H>
          <Bar pct={roll ? (pr / roll) * 100 : 0} />
          {(r.classes ?? []).map((c) => <P key={c.name}>{tr(c.name)}: {c.present}/{c.enrolled}</P>)}
          <P mute>{tt('Visitors: {0}', r.visitors ?? 0)}{r.lesson ? ' · ' + r.lesson : ''}</P>
          {keep && <Btn kind="ghost" small label="Archive" onPress={() => archive('office', r.id)} />}
        </Card>
      ); }) : <Empty text="No attendance recorded yet." />}
    </Screen>
  );
}

// ------------------------------------------------------------------ Building pledges
export function Pledges() {
  const { me, db, add, archive } = useDB();
  const { back } = useNav();
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [amount, setAmount] = useState(''); const [due, setDue] = useState('');
  const [payFor, setPayFor] = useState<string | null>(null); const [pay, setPay] = useState('');
  const pledges = db.office.filter((o) => o.kind === 'pledge' && !o.archived).slice().reverse();
  const payments = db.office.filter((o) => o.kind === 'pledge_payment' && !o.archived);
  if (!me || !canReadPledges(me)) return null;
  const keep = canKeepPledges(me);
  const paidOf = (id: string) => payments.filter((p) => p.pledgeId === id).reduce((s, p) => s + (p.amount ?? 0), 0);
  const totalPledged = pledges.reduce((s, p) => s + (p.amount ?? 0), 0);
  const totalPaid = pledges.reduce((s, p) => s + paidOf(p.id), 0);
  const today = iso(new Date());
  return (
    <Screen title="Building Pledges" onBack={back}>
      <Card>
        <H>Total</H>
        <P>{tt('Pledged {0} · Paid {1} · Balance {2}', ksh(totalPledged), ksh(totalPaid), ksh(Math.max(0, totalPledged - totalPaid)))}</P>
        <Bar pct={totalPledged ? (totalPaid / totalPledged) * 100 : 0} />
        <P mute>Money given through the app to Church Building is already counted on the Building Project page. This list tracks promises and what has been paid toward each.</P>
      </Card>
      {keep && (
        <Card>
          <H>New pledge</H>
          <Field label="Name of the person or family" value={name} onChangeText={setName} />
          <Field label="Phone (optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          <Field label="Amount pledged (KSh)" value={amount} onChangeText={setAmount} keyboardType="number-pad" />
          <Field label="Promised by (YYYY-MM-DD, optional)" value={due} onChangeText={setDue} />
          <Btn label="Save pledge" onPress={async () => {
            if (!name.trim() || !(num(amount) > 0)) return Alert.alert('Missing', 'Write the name and the amount pledged.');
            if (await add('office', { office: 'building', kind: 'pledge', pledger: name.trim(), phone: phone.trim(), amount: num(amount), due: due.trim() })) { setName(''); setPhone(''); setAmount(''); setDue(''); }
          }} />
        </Card>
      )}
      {pledges.length ? pledges.map((p) => { const paid = paidOf(p.id), amt = p.amount ?? 0, left = Math.max(0, amt - paid); const late = !!p.due && p.due < today && left > 0; return (
        <Card key={p.id}>
          <Row><H>{p.pledger ?? p.title}</H>{left === 0 ? <Badge text="Fulfilled" color={C.ok} /> : late ? <Badge text="Overdue" color={C.warn} /> : null}</Row>
          <P>{tt('Pledged {0} · Paid {1} · Balance {2}', ksh(amt), ksh(paid), ksh(left))}</P>
          <Bar pct={amt ? (paid / amt) * 100 : 0} />
          {!!p.due && <P mute>{tt('Promised by {0}', p.due)}</P>}
          {payments.filter((x) => x.pledgeId === p.id).map((x) => <P key={x.id} mute>{x.date}: {ksh(x.amount ?? 0)}</P>)}
          {keep && (payFor === p.id ? (
            <View>
              <Field label="Amount paid (KSh)" value={pay} onChangeText={setPay} keyboardType="number-pad" />
              <Row>
                <Btn small label="Save payment" onPress={async () => { if (!(num(pay) > 0)) return Alert.alert('Missing', 'Enter the amount paid.'); if (await add('office', { office: 'building', kind: 'pledge_payment', pledgeId: p.id, amount: num(pay), date: today })) { setPay(''); setPayFor(null); } }} />
                <Btn small kind="ghost" label="Cancel" onPress={() => setPayFor(null)} />
              </Row>
            </View>
          ) : (
            <Row><Btn small label="Add payment" onPress={() => setPayFor(p.id)} /><Btn small kind="ghost" label="Archive" onPress={() => archive('office', p.id)} /></Row>
          ))}
        </Card>
      ); }) : <Empty text="No pledges yet." />}
    </Screen>
  );
}

// ------------------------------------------------------------------ Camp meeting registration
const CATEGORIES = ['adult', 'youth', 'child'] as const;
const STAYS = ['tent', 'dormitory', 'own', 'day'] as const;
const CAT_LABEL = { adult: 'Adult', youth: 'Youth', child: 'Child' };
const STAY_LABEL = { tent: 'Tent', dormitory: 'Dormitory', own: 'Own arrangements', day: 'Day visitor' };

function RegCard({ r, manage }: { r: CampRegistration; manage: boolean }) {
  const { campAction, archive } = useDB();
  const [fee, setFee] = useState(''); const [pay, setPay] = useState('');
  const balance = Math.max(0, r.fee - r.paid);
  return (
    <Card>
      <Row><H>{r.name}</H>{r.checkedIn ? <Badge text="Checked in" color={C.ok} /> : null}</Row>
      <P mute>{r.camp} · {tr(CAT_LABEL[r.category])} · {tr(STAY_LABEL[r.accommodation])} · {tt('{0} day(s)', r.days)}{r.church ? ' · ' + r.church : ''}</P>
      <P>{r.fee > 0 ? tt('Fee {0} · Paid {1} · Balance {2}', ksh(r.fee), ksh(r.paid), ksh(balance)) : 'The camp officers have not set the fee yet.'}</P>
      {r.fee > 0 && <Bar pct={(r.paid / r.fee) * 100} />}
      {manage && (
        <View>
          <Row>
            <View style={{ flex: 1 }}><Field label="Set fee (KSh)" value={fee} onChangeText={setFee} keyboardType="number-pad" /></View>
            <Btn small label="Set fee" onPress={async () => { if (isNaN(num(fee)) || num(fee) < 0) return Alert.alert('Missing', 'Enter the fee.'); if (await campAction(r.id, 'fee', num(fee))) setFee(''); }} />
          </Row>
          <Row>
            <View style={{ flex: 1 }}><Field label="Payment received (KSh)" value={pay} onChangeText={setPay} keyboardType="number-pad" /></View>
            <Btn small kind="ok" label="Add payment" onPress={async () => { if (!(num(pay) > 0)) return Alert.alert('Missing', 'Enter the amount paid.'); if (await campAction(r.id, 'payment', num(pay))) setPay(''); }} />
          </Row>
          <Row>
            <Btn small kind={r.checkedIn ? 'ghost' : 'primary'} label={r.checkedIn ? 'Undo check-in' : 'Check in'} onPress={() => campAction(r.id, r.checkedIn ? 'uncheck' : 'checkin')} />
            <Btn small kind="ghost" label="Archive" onPress={() => archive('campreg', r.id)} />
          </Row>
        </View>
      )}
    </Card>
  );
}

export function CampRegistrationScreen() {
  const { me, db, add } = useDB();
  const { back } = useNav();
  const [camp, setCamp] = useState('Camp Meeting');
  const [category, setCategory] = useState<CampRegistration['category']>('adult');
  const [stay, setStay] = useState<CampRegistration['accommodation']>('tent');
  const [days, setDays] = useState('4');
  const [other, setOther] = useState({ name: '', phone: '', church: '' });
  const [q, setQ] = useState('');
  if (!me) return null;
  const manage = canManageCamp(me), seeAll = canSeeAllCampRegistrations(me);
  const all = db.campreg.filter((r) => !r.archived).slice().reverse();
  const mine = all.filter((r) => r.memberId === me.id);
  const shown = (seeAll ? all : mine).filter((r) => !q.trim() || (r.name + r.phone + r.church).toLowerCase().includes(q.trim().toLowerCase()));
  const fees = all.reduce((s, r) => s + r.fee, 0), paid = all.reduce((s, r) => s + r.paid, 0);
  const form = (forOther: boolean) => (
    <Card>
      <H>{forOther ? 'Register someone else' : 'Register for the camp meeting'}</H>
      {forOther && <><Field label="Full name" value={other.name} onChangeText={(v) => setOther({ ...other, name: v })} /><Field label="Phone (optional)" value={other.phone} onChangeText={(v) => setOther({ ...other, phone: v })} keyboardType="phone-pad" /><Field label="Church (optional)" value={other.church} onChangeText={(v) => setOther({ ...other, church: v })} /></>}
      <Field label="Which camp meeting?" value={camp} onChangeText={setCamp} />
      <Chips options={CATEGORIES} value={category} onChange={setCategory} labels={CAT_LABEL} />
      <Chips options={STAYS} value={stay} onChange={setStay} labels={STAY_LABEL} />
      <Field label="Number of days" value={days} onChangeText={setDays} keyboardType="number-pad" />
      <Btn label="Register" onPress={async () => {
        const d = num(days); if (!(d >= 1 && d <= 30)) return Alert.alert('Missing', 'Days must be a number from 1 to 30.');
        if (forOther && !other.name.trim()) return Alert.alert('Missing', 'Write the name of the person registering.');
        const ok = await add('campreg', { camp: camp.trim(), category, accommodation: stay, days: d, ...(forOther ? { name: other.name.trim(), phone: other.phone.trim(), church: other.church.trim() } : {}) });
        if (ok && forOther) setOther({ name: '', phone: '', church: '' });
      }} />
    </Card>
  );
  return (
    <Screen title={manage || seeAll ? 'Camp Registrations' : 'Camp Meeting Registration'} onBack={back}>
      {seeAll && (
        <Card>
          <H>Summary</H>
          <P>{tt('Registered: {0} · Checked in: {1}', all.length, all.filter((r) => r.checkedIn).length)}</P>
          <P>{tt('Fees {0} · Paid {1} · Balance {2}', ksh(fees), ksh(paid), ksh(Math.max(0, fees - paid)))}</P>
        </Card>
      )}
      {manage ? form(true) : mine.length === 0 && form(false)}
      {seeAll && all.length > 4 && <Field label="Search by name, phone or church" value={q} onChangeText={setQ} />}
      {shown.length ? shown.map((r) => <RegCard key={r.id} r={r} manage={manage} />) : <Empty text={seeAll ? 'No one has registered yet.' : 'You are not registered yet.'} />}
      {!seeAll && mine.length > 0 && <P mute>To change or cancel your registration, ask the camp meeting secretary.</P>}
    </Screen>
  );
}

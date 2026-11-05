import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Alert, t as tt, tr } from '../i18n';
import { Badge, Btn, Card, Chips, Empty, Field, H, P, Row, Screen } from '../components/ui';
import { C } from '../components/ui';
import { PAYBILL, PAYMENT_CATEGORIES as DEFAULT_CATEGORIES } from '../data/constants';
import { useNav } from '../nav';
import { calculateSplit, isDuplicateCode, isValidMpesaCode, ksh } from '../services/payments';
import { canConfirmVerified, canReceivePayments } from '../services/permissions';
import { useDB } from '../store/db';
import { Payment } from '../types';

export function Give() {
  const { me, db, add, settings } = useDB();
  const { go, reset, back } = useNav();
  // Each church sets its own Pay Bill and giving categories (Church Admin > Church settings); the built-in ones are the fallback.
  const PAYMENT_CATEGORIES = settings?.categories?.length ? settings.categories : DEFAULT_CATEGORIES;
  const bill = settings?.paybill || PAYBILL.number;
  const account = settings?.accountHint || PAYBILL.account;
  const [code, setCode] = useState('');
  const [mname, setMname] = useState(me?.name ?? '');
  const [purpose, setPurpose] = useState('');
  const [amount, setAmount] = useState('');
  const [rows, setRows] = useState([{ category: 'Tithe', percent: '10' }, { category: 'Offering', percent: '20' }, { category: 'Church Budget', percent: '70' }]);

  const split = useMemo(
    () => calculateSplit(Number(amount), rows.map((r) => ({ category: r.category, percent: Number(r.percent) || 0 }))),
    [amount, rows],
  );
  if (!me) return null;

  const send = async () => {
    const c = code.trim().toUpperCase();
    if (!isValidMpesaCode(c)) return Alert.alert('Check the code', 'The M-Pesa code has 10 letters/digits, e.g. SGH7K2L9QX.');
    if (isDuplicateCode(db.payments, c)) return Alert.alert('Already sent', 'That M-Pesa code has already been submitted.');
    if (!purpose.trim()) return Alert.alert('Purpose needed', 'Please say what the payment is for.');
    if (split.error) return Alert.alert('Check the split', split.error);
    // The server re-checks the code and recalculates the split before saving.
    const ok = await add('payments', {
      mpesaCode: c, mpesaName: mname.trim() || me.name, purpose: purpose.trim(), amount: Number(amount),
      allocations: rows.map((r) => ({ category: r.category, percent: Number(r.percent) || 0 })),
    });
    if (!ok) return;
    Alert.alert('Sent', 'Your payment details were sent to the Church Treasurer. Your receipt will arrive here once it is confirmed.');
    reset(); go('receipts');
  };

  return (
    <Screen title="Give – Tithes & Offering" onBack={back}>
      <Card>
        <H>Step 1 – Pay with M-Pesa</H>
        <P>Lipa na M-Pesa → Pay Bill</P>
        <P bold>{tt('Business no: {0}', bill)}</P>
        <P bold>{tt('Account: {0}', account)}</P>
      </Card>
      <Card>
        <H>Step 2 – Tell the Treasurer</H>
        <Field label="M-Pesa confirmation code" value={code} onChangeText={(t) => setCode(t.toUpperCase())} autoCapitalize="characters" maxLength={10} placeholder="SGH7K2L9QX" />
        <Field label="Name shown on M-Pesa" value={mname} onChangeText={setMname} />
        <Field label="Purpose of payment" value={purpose} onChangeText={setPurpose} placeholder="e.g. Monthly tithe and offerings" />
        <Field label="Amount paid (KSh)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
        <Text style={{ fontSize: 12, fontWeight: '600', color: C.mute, marginBottom: 4 }}>{tr('How should it be divided?')}</Text>
        {rows.map((r, i) => (
          <View key={i} style={{ marginBottom: 6 }}>
            <Chips options={PAYMENT_CATEGORIES} value={r.category} onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, category: v } : x)))} />
            <Row>
              <View style={{ flex: 1 }}><Field label="Percent %" value={r.percent} keyboardType="decimal-pad" onChangeText={(t) => setRows(rows.map((x, j) => (j === i ? { ...x, percent: t } : x)))} /></View>
              <Pressable onPress={() => setRows(rows.filter((_, j) => j !== i))}><Text style={{ color: C.bad }}>{tr('Remove row')}</Text></Pressable>
            </Row>
          </View>
        ))}
        <Btn kind="ghost" small label="+ Add category" onPress={() => setRows([...rows, { category: 'Other', percent: '0' }])} />
        <View style={{ backgroundColor: C.primarySoft, borderRadius: 10, padding: 10, marginVertical: 8 }}>
          {split.error ? <Text style={{ color: C.bad }}>{tr(split.error)}</Text> : (
            <>
              {split.allocations.map((a) => (
                <Row key={a.category} style={{ justifyContent: 'space-between' }}><Text>{tr(a.category)} ({a.percent}%)</Text><Text style={{ fontWeight: '700' }}>{ksh(a.amount)}</Text></Row>
              ))}
              <Row style={{ justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#BCD', marginTop: 4, paddingTop: 4 }}><Text>{tr('Total')}</Text><Text style={{ fontWeight: '700' }}>{ksh(Number(amount))}</Text></Row>
            </>
          )}
        </View>
        <Btn label="Send to Treasurer" onPress={send} />
      </Card>
    </Screen>
  );
}

export function Receipts() {
  const { me, db } = useDB();
  const { back } = useNav();
  if (!me) return null;
  const pending = db.payments.filter((p) => p.memberId === me.id && p.status === 'pending' && !p.archived);
  const receipts = db.receipts.filter((r) => r.memberId === me.id && !r.archived).slice().reverse();
  return (
    <Screen title="My Receipts" onBack={back}>
      {pending.map((p) => (
        <Card key={p.id}>
          <Badge text="Awaiting Treasurer" color={C.warn} />
          <P bold>{ksh(p.amount)} · {p.mpesaCode}</P>
          <P mute>{p.purpose}</P>
          {p.verification?.state === 'verified' && <P mute>M-Pesa has confirmed your payment. Your receipt follows shortly.</P>}
          {p.verification?.state === 'amount_mismatch' && <P>The amount you entered does not match the M-Pesa record. The Treasurer will check it with you.</P>}
        </Card>
      ))}
      {receipts.length === 0 && pending.length === 0 && <Empty text="No receipts yet. They arrive here automatically once the Treasurer confirms your payment." />}
      {receipts.map((r) => (
        <Card key={r.id}><Badge text={r.receiptNo} color={C.ok} /><Text style={{ fontFamily: 'Courier', fontSize: 12, marginTop: 6 }}>{r.text}</Text></Card>
      ))}
    </Screen>
  );
}

export function PaymentsInbox() {
  const { me, db, receivePayment, receiveVerified, archive, outbox } = useDB();
  const { back } = useNav();
  if (!me) return null;
  const canReceive = canReceivePayments(me);
  const list = db.payments.filter((p) => !p.archived).slice().reverse();
  const pending = list.filter((p) => p.status === 'pending');
  const done = list.filter((p) => p.status === 'received');
  const verifiedPending = pending.filter((p) => p.verification?.state === 'verified');
  const verifiedTotal = verifiedPending.reduce((s, p) => s + p.amount, 0);
  const total = done.reduce((s, p) => s + p.amount, 0);
  const byCat: Record<string, number> = {};
  done.forEach((p) => p.allocations.forEach((a) => { byCat[a.category] = (byCat[a.category] ?? 0) + a.amount; }));

  const card = (p: Payment) => (
    <Card key={p.id}>
      <Badge text={p.status === 'pending' ? 'Pending' : tt('Received {0}', p.receiptNo ?? '')} color={p.status === 'pending' ? C.warn : C.ok} />
      <P bold>{p.memberName} · {ksh(p.amount)}</P>
      <P mute>M-Pesa {p.mpesaCode} ({p.mpesaName}) · {new Date(p.createdAt).toLocaleString()}</P>
      <P>{p.purpose}</P>
      {p.allocations.map((a) => <P key={a.category} mute>{a.category} {a.percent}% — {ksh(a.amount)}</P>)}
      {p.verification?.state === 'verified' && <Badge text={p.verification.mpesaName ? tt('✓ Verified by M-Pesa: {0}', p.verification.mpesaName) : tr('✓ Verified by M-Pesa')} color={C.ok} />}
      {p.verification?.state === 'amount_mismatch' && <Badge text={tt('⚠ M-Pesa shows {0}, member said {1}', ksh(p.verification.mpesaAmount ?? 0), ksh(p.amount))} color={C.bad} />}
      {p.verification?.state === 'waiting' && <Badge text="Not on the Pay Bill yet" color={C.warn} />}
      {p.status === 'pending' && canReceive && !outbox.queued.some((q) => q.path === `/payments/${p.id}/receive`) && <Btn kind="ok" small label="✓ Received – send receipt" onPress={() => receivePayment(p.id)} />}
      {p.status === 'pending' && outbox.queued.some((q) => q.path === `/payments/${p.id}/receive`) && <Badge text="Waiting to be sent" />}
      {p.status === 'received' && canReceive && <Btn kind="ghost" small label="Archive" onPress={() => archive('payments', p.id, 'Archived by treasurer')} />}
    </Card>
  );

  return (
    <Screen title="Payments" onBack={back}>
      {canConfirmVerified(me) && db.mpesaEnabled && verifiedPending.length > 0 && (
        <Card style={{ backgroundColor: '#E6F4EA' }}>
          <H>{tt('{0} payments are verified by M-Pesa', verifiedPending.length)}</H>
          <P>{tt('Together: {0}. M-Pesa has already shown each code and the same amount.', ksh(verifiedTotal))}</P>
          <Btn kind="ok" label="✓ Confirm all verified and send receipts" onPress={() => Alert.alert('Confirm all?', tt('{0} receipts will be sent, {1} in total.', verifiedPending.length, ksh(verifiedTotal)), [
            { text: tr('Cancel'), style: 'cancel' },
            { text: tr('Confirm all'), onPress: async () => { const n = await receiveVerified(); if (n >= 0) Alert.alert('Done', tt('{0} receipts sent.', n)); } },
          ])} />
        </Card>
      )}
      <Card><P mute>Received</P><H>{ksh(total)}</H>{Object.entries(byCat).map(([k, v]) => <P key={k} mute>{k}: {ksh(v)}</P>)}</Card>
      {db.mpesaEnabled && db.unclaimed.length > 0 && (
        <Card style={{ backgroundColor: C.primarySoft }}>
          <H>{tt('Unclaimed M-Pesa payments ({0})', db.unclaimed.length)}</H>
          <P mute>Money that reached the Pay Bill but that no member has reported yet.</P>
          {db.unclaimed.slice(0, 15).map((u) => (
            <P key={u.code}>{u.code} · {ksh(u.amount)}{u.name ? ' · ' + u.name : ''}{u.reference ? ' · ref ' + u.reference : ''}</P>
          ))}
        </Card>
      )}
      <H>{tt('Pending ({0})', pending.length)}</H>
      {pending.length ? pending.map(card) : <Empty text="Nothing waiting." />}
      <H>Received</H>
      {done.length ? done.map(card) : <Empty text="No received payments yet." />}
    </Screen>
  );
}

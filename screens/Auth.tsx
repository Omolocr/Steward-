import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Alert, t as tt, tr } from '../i18n';
import { Badge, Btn, Card, Chips, Field, H, P, Screen } from '../components/ui';
import { GROUPS, LEADER_ROLES } from '../data/constants';
import { Profile, useDB } from '../store/db';
import { API_IS_TEST_ADDRESS, API_URL } from '../config';

type Step = 'phone' | 'code' | 'church' | 'profile';
const label = { fontSize: 12, fontWeight: '600' as const, color: '#6B7280', marginBottom: 4 };
const roleLabels = Object.fromEntries(LEADER_ROLES.map((r) => [r.key, r.label]));

export default function SignIn() {
  const { requestOtp, verifyOtp, lookup, sandbox, enterSandbox } = useDB();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | undefined>();
  const [kind, setKind] = useState<'Member' | 'Leader'>('Member');
  const [role, setRole] = useState(LEADER_ROLES[0].key);
  const [old, setOld] = useState<string[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [churchNumber, setChurchNumber] = useState('');
  const [churchName, setChurchName] = useState('');
  const [f, setF] = useState({ name: '', idNumber: '', membershipNumber: '' });
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));
  const toggle = (list: string[], setList: (l: string[]) => void) => (k: string) => setList(list.includes(k) ? list.filter((x) => x !== k) : [...list, k]);

  const sendCode = async () => {
    const r = await requestOtp(phone.trim());
    if (r.ok) { setDevCode(r.devCode); setStep('code'); }
  };

  const checkCode = async () => {
    // A phone that already belongs to a church signs straight in. A new person says which church (church number), then who they are.
    const r = await verifyOtp(phone.trim(), code.trim());
    if (r === 'needs-church') setStep('church');
    if (r === 'needs-profile') setStep('profile');
  };

  const checkChurch = async () => {
    if (!churchNumber.trim()) return Alert.alert('Church number needed', 'Ask your church secretary or church admin for your church number.');
    const r = await lookup(phone.trim(), churchNumber.trim());
    if (!r) return;
    if (!r.church) return Alert.alert('Church not found', 'That church number was not found. Check it with your church secretary.');
    setChurchName(r.church.name); setStep('profile');
  };

  const createAccount = async () => {
    if (!f.name.trim() || !f.idNumber.trim()) return Alert.alert('Missing details', 'Please fill in your name and ID number.');
    const profile: Profile = {
      name: f.name.trim(), idNumber: f.idNumber.trim(), membershipNumber: f.membershipNumber.trim() || undefined,
      role: kind === 'Leader' ? role : undefined, formerRoles: old, groups,
    };
    const r = await verifyOtp(phone.trim(), code.trim(), profile, churchNumber.trim() || undefined);
    if (r === 'ok' && kind === 'Leader') {
      Alert.alert('Position requested', 'You can use the app now as a member. Your leader dashboard opens once the Church Secretary or Pastor verifies your position.');
    }
  };

  if (step === 'phone') {
    return (
      <Screen title="Church Connect">
        {API_IS_TEST_ADDRESS && !sandbox && (
          <Card style={{ backgroundColor: '#FDEBD3' }}><H>Test address</H><P>This copy of the app is pointing at {API_URL}, an address that only works on a developer's computer. If you are not a developer, ask your church for the latest version of the app.</P></Card>
        )}
        <Card><H>Welcome</H><P mute>Enter your phone number. We will send you a 6-digit code by SMS.</P></Card>
        <Field label="Phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="07XXXXXXXX" />
        <Btn label="Send me a code" onPress={sendCode} />
        {sandbox && (
          <Card style={{ backgroundColor: '#FFF7E0' }}>
            <H>Team quick entry (test server)</H>
            <P mute>For the developer and development team only. This server holds made-up data, so these numbers sign in with one tap and no code.</P>
            <P>Developer console (web): {API_URL}/console — team numbers 0700000001 to 0700000010.</P>
            {sandbox.filter((n) => n.console !== 'developer').map((n) => (
              <Btn key={n.phone} kind="ghost" small label={`${n.label} · ${n.phone}`} onPress={() => enterSandbox(n.phone)} />
            ))}
          </Card>
        )}
      </Screen>
    );
  }

  if (step === 'code') {
    return (
      <Screen title="Enter your code" onBack={() => setStep('phone')}>
        <Card><P mute>We sent a code to {phone}.</P>{devCode ? <P>Test mode code: {devCode}</P> : null}</Card>
        <Field label="6-digit code" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} />
        <Btn label="Continue" onPress={checkCode} />
      </Screen>
    );
  }

  if (step === 'church') {
    return (
      <Screen title="Your church" onBack={() => setStep('code')}>
        <Card><H>Which church do you belong to?</H><P mute>Every church has its own special church number, given by the app developer. Ask your church secretary or church admin. Once you join, everything you do in the app is linked only to that church.</P></Card>
        <Field label="Church number" value={churchNumber} onChangeText={setChurchNumber} keyboardType="number-pad" placeholder="482-7391" maxLength={8} />
        <Btn label="Find my church" onPress={checkChurch} />
      </Screen>
    );
  }

  return (
    <Screen title="Create your account" onBack={() => setStep(churchNumber ? 'church' : 'code')}>
      {!!churchName && <Card style={{ backgroundColor: '#E3EDF7' }}><P mute>You are joining</P><H>{churchName}</H><P mute>The church admin may need to approve you before you can use the church pages.</P></Card>}
      <Card><H>Tell us about you</H><P mute>Your dashboard is assigned strictly by your role. Leader positions are verified by the Church Secretary or Pastor.</P></Card>
      <Field label="Full name" value={f.name} onChangeText={set('name')} />
      <Text style={label}>{tr('I am a')}</Text>
      <Chips options={['Member', 'Leader'] as const} value={kind} onChange={setKind} />
      {kind === 'Leader' && (
        <>
          <Text style={label}>{tr('Position (select one)')}</Text>
          <Chips options={LEADER_ROLES.map((r) => r.key)} value={role} onChange={setRole} labels={roleLabels} />
        </>
      )}
      <Text style={label}>{tr('Old positions held previously (there is no absolute retirement)')}</Text>
      <Chips options={LEADER_ROLES.map((r) => r.key)} value={old} onChange={toggle(old, setOld)} labels={roleLabels} />
      {kind === 'Member' && old.length > 0 && <View style={{ marginBottom: 12 }}><Badge text="You will get the Former Leader (Advisor) dashboard" color="#2E7D4F" /></View>}
      <Text style={label}>{tr('Groups you belong to')}</Text>
      <Chips options={GROUPS.map((g) => g.key)} value={groups} onChange={toggle(groups, setGroups)} labels={Object.fromEntries(GROUPS.map((g) => [g.key, g.label]))} />
      <Field label="ID number" value={f.idNumber} onChangeText={set('idNumber')} keyboardType="number-pad" />
      <Field label="Church membership number (optional)" value={f.membershipNumber} onChangeText={set('membershipNumber')} />
      <Btn label="Create account" onPress={createAccount} />
    </Screen>
  );
}

// First-run guide: a short walkthrough of what this person's role does in the app. Shown once per role, and any time from "How this works".
import React, { useState } from 'react';
import { Share, Text, View } from 'react-native';
import { api } from '../api';
import { Btn, C, Card, H, P, Row, Screen } from '../components/ui';
import { guideFor, guideKeyFor } from '../data/guides';
import { t as tt, tr } from '../i18n';
import { useNav } from '../nav';
import { composeQuickCard } from '../services/quickcard';
import { useDB } from '../store/db';
import { User } from '../types';

/** The role whose guide this person should see: a leader whose position is not verified yet is still a member. */
export const guideRoleOf = (u: User): string => (u.roleStatus === 'approved' ? u.role : 'member');

export function Guide() {
  const { me, refresh, church } = useDB();
  const { back } = useNav();
  const [i, setI] = useState(0);
  if (!me) return null;
  const role = guideRoleOf(me);
  const g = guideFor(role);
  const last = i === g.steps.length - 1;
  const finish = async () => {
    try { await api.post('/me/guide-seen', { role }); await refresh(); } catch { /* the guide can simply be shown again next time */ }
    back();
  };
  const st = g.steps[i];
  return (
    <Screen title="How this works" onBack={finish}>
      <Card style={{ backgroundColor: C.primary }}>
        <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>{tr(g.title)}</Text>
        <Text style={{ color: '#DBE8F5', fontSize: 12, marginTop: 4 }}>{tt('Step {0} of {1}', i + 1, g.steps.length)}</Text>
      </Card>
      <Card>
        <Text style={{ fontSize: 40, textAlign: 'center' }}>{st.icon}</Text>
        <H>{st.title}</H>
        <P>{st.body}</P>
      </Card>
      <Row style={{ justifyContent: 'center', marginBottom: 12 }}>
        {g.steps.map((_, k) => <View key={k} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: k === i ? C.primary : C.line }} />)}
      </Row>
      <Btn label={last ? 'Got it' : 'Next'} onPress={() => (last ? finish() : setI(i + 1))} />
      <Row>
        {i > 0 && <Btn kind="ghost" label="Back" onPress={() => setI(i - 1)} />}
        {!last && <Btn kind="ghost" label="Skip" onPress={finish} />}
      </Row>
      <Btn kind="ghost" label="Share / print quick-start card" onPress={() => Share.share({ message: composeQuickCard(g, church?.name ?? me.church, tr, 'Quick-start card'), title: tr('Quick-start card') })} />
    </Screen>
  );
}
export { guideKeyFor };

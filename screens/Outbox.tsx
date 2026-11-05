// Things written without internet. They wait here and are sent automatically; the person can also send them now.
import React, { useState } from 'react';
import { Text } from 'react-native';
import { Badge, Btn, C, Card, Empty, H, P, Screen } from '../components/ui';
import { Alert, t as tt, tr } from '../i18n';
import { useDB } from '../store/db';

const when = (iso: string) => iso.slice(0, 16).replace('T', ' ');
const KIND: Record<string, string> = { minutes: 'Minutes', notices: 'Notice', activities: 'Activity', office: 'Office record', care: 'Pastoral Care message', payments: 'Payment confirmation' };

export default function Outbox() {
  const { outbox, sendOutbox, hideRejected, online } = useDB();
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    const n = await sendOutbox();
    setBusy(false);
    Alert.alert(n ? 'Sent' : 'Not sent yet', n ? tt('{0} item(s) sent.', String(n)) : 'Still no connection. They will be sent automatically when you are back online.');
  };
  return (
    <Screen title="Waiting to be sent">
      {!outbox.queued.length && !outbox.rejected.length && <Empty text="Nothing is waiting. Everything you wrote has been sent." />}
      {!!outbox.queued.length && (
        <Card>
          <H>Written without internet</H>
          <P mute>{online ? 'Connected. Sending now…' : 'No connection. These are saved on this phone and will be sent automatically.'}</P>
          {outbox.queued.map((q) => (
            <Text key={q.key} style={{ color: C.ink, marginTop: 6 }}>• {tr(KIND[q.col] ?? q.col)}: {q.title} <Text style={{ color: C.mute, fontSize: 12 }}>({when(q.at)})</Text></Text>
          ))}
          <Btn label={busy ? 'Sending…' : 'Send now'} onPress={send} />
        </Card>
      )}
      {outbox.rejected.map((r) => (
        <Card key={r.key} style={{ backgroundColor: '#FDEBD3' }}>
          <Badge text="Not accepted" />
          <H>{r.title}</H>
          <P>{r.reason}</P>
          <P mute>{tr(KIND[r.col] ?? r.col)} · {when(r.at)}</P>
          <Btn kind="ghost" label="Hide" onPress={() => hideRejected(r.key)} />
        </Card>
      ))}
    </Screen>
  );
}

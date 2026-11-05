import React, { useEffect, useState } from 'react';
import { Pressable, Share, Text } from 'react-native';
import { ApiError, api } from '../api';
import { Btn, C, Card, Chips, Empty, H, P, Screen } from '../components/ui';
import { Alert, getLang, t as tt, tr } from '../i18n';
import { useNav } from '../nav';
import { ksh } from '../services/payments';
import { useDB } from '../store/db';

interface StatementData { year: number; total: number; byCategory: Record<string, number>; items: unknown[]; text: string }
interface ReportData { month: string; count: number; total: number; byCategory: Record<string, number>; pendingNotReceipted: number; csv: string }

// Kenya time (UTC+3), so the "current" month and year match what the Treasurer sees on the calendar.
const kenyaNow = () => new Date(Date.now() + 3 * 3600e3);
const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Could not load.');

// A member's yearly giving statement. The Treasurer and Pastor can choose any member who has been receipted.
export function Statement() {
  const { me, db } = useDB();
  const { back } = useNav();
  const thisYear = kenyaNow().getUTCFullYear();
  const years = [String(thisYear), String(thisYear - 1), String(thisYear - 2)];
  const [year, setYear] = useState(years[0]);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [data, setData] = useState<StatementData | null>(null);
  const [busy, setBusy] = useState(false);
  const canPick = me?.role === 'treasurer' || me?.role === 'pastor';
  const givers = canPick ? Array.from(new Map(db.receipts.map((r) => [r.memberId, r.memberName])).entries()) : [];

  useEffect(() => {
    if (!me) return;
    let live = true;
    setBusy(true); setData(null);
    const who = canPick ? memberId ?? me.id : me.id;
    api.get<StatementData>(`/statements/${year}?lang=${getLang()}${who !== me.id ? '&memberId=' + encodeURIComponent(who) : ''}`)
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) Alert.alert('Not done', errText(e)); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [year, memberId, me?.id]);

  if (!me) return null;
  return (
    <Screen title="Giving Statement" onBack={back}>
      {canPick && (
        <Card>
          <H>Choose a member</H>
          {givers.length === 0 && <P mute>Nobody has given yet.</P>}
          {givers.map(([id, name]) => (
            <Pressable key={id} onPress={() => setMemberId(id)} style={{ paddingVertical: 6 }}>
              <Text style={{ color: (memberId ?? me.id) === id ? C.primary : C.ink, fontWeight: (memberId ?? me.id) === id ? '700' : '400' }}>{name}</Text>
            </Pressable>
          ))}
        </Card>
      )}
      <Text style={{ fontSize: 12, fontWeight: '600', color: C.mute, marginBottom: 4 }}>{tr('Year')}</Text>
      <Chips options={years} value={year} onChange={setYear} />
      {busy && <P mute>Loading…</P>}
      {data && (
        <>
          <Card>
            <H>{tt('Giving Statement {0}', data.year)}</H>
            <P mute>Only payments the Treasurer has receipted are counted.</P>
            {data.items.length === 0 ? <Empty text="No receipted giving in this year." /> : (
              <>
                <P bold>{tr('Total given')}: {ksh(data.total)}</P>
                <H>Totals by purpose</H>
                {Object.entries(data.byCategory).map(([k, v]) => <P key={k}>{tr(k)}: {ksh(v)}</P>)}
              </>
            )}
          </Card>
          <Text style={{ fontFamily: 'Courier', fontSize: 12, color: C.ink, marginBottom: 12 }}>{data.text}</Text>
          <Btn label="Share / print" onPress={() => Share.share({ message: data.text, title: tt('Giving Statement {0}', data.year) })} />
        </>
      )}
    </Screen>
  );
}

// The Treasurer's monthly report, shared as spreadsheet text (CSV) that opens in Excel or Google Sheets.
export function MonthlyReport() {
  const { me } = useDB();
  const { back } = useNav();
  const now = kenyaNow();
  const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)); return d.toISOString().slice(0, 7); });
  const [month, setMonth] = useState(months[0]);
  const [data, setData] = useState<ReportData | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setBusy(true); setData(null);
    api.get<ReportData>(`/reports/monthly/${month}`)
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) Alert.alert('Not done', errText(e)); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [month]);

  if (!me) return null;
  return (
    <Screen title="Treasurer Monthly Report" onBack={back}>
      <Text style={{ fontSize: 12, fontWeight: '600', color: C.mute, marginBottom: 4 }}>{tr('Month')}</Text>
      <Chips options={months} value={month} onChange={setMonth} />
      {busy && <P mute>Loading…</P>}
      {data && (
        <>
          <Card>
            <H>{month}</H>
            <P>{tt('Receipts issued: {0}', data.count)}</P>
            <P bold>{tt('Total receipted: {0}', ksh(data.total))}</P>
            {Object.entries(data.byCategory).map(([k, v]) => <P key={k} mute>{tr(k)}: {ksh(v)}</P>)}
            {data.pendingNotReceipted > 0 && <P>{tt('Payments still waiting to be receipted: {0}', data.pendingNotReceipted)}</P>}
          </Card>
          <Btn label="Share spreadsheet (CSV)" onPress={() => Share.share({ message: data.csv, title: `church-report-${month}.csv` })} />
          <Btn kind="ghost" label={tt('Every member\'s giving statement for {0} (spreadsheet)', month.slice(0, 4))} onPress={async () => { try { const r = await api.get<{ csv: string; members: number }>(`/statements/${month.slice(0, 4)}/all`); await Share.share({ message: r.csv, title: `giving-statements-${month.slice(0, 4)}.csv` }); } catch (e) { Alert.alert('Not done', errText(e)); } }} />
          <P mute>Tip: choose Share, then send to your email or save it in a file ending in .csv. It opens in Excel or Google Sheets.</P>
        </>
      )}
    </Screen>
  );
}

interface YearlyData { year: string; church: string; text: string; giving: { total: number }; membership: { onRoll: number }; }

/** Annual report for the Pastor and the Church Board: totals only, no individual's giving. */
export function YearlyReport() {
  const { me } = useDB();
  const { back } = useNav();
  const thisYear = kenyaNow().getUTCFullYear();
  const years = Array.from({ length: 4 }, (_, i) => String(thisYear - i));
  const [year, setYear] = useState(years[0]);
  const [data, setData] = useState<YearlyData | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setBusy(true); setData(null);
    api.get<YearlyData>(`/reports/yearly/${year}?lang=${getLang()}`)
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) Alert.alert('Not done', errText(e)); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [year]);

  if (!me) return null;
  return (
    <Screen title="Annual Church Report" onBack={back}>
      <Text style={{ fontSize: 12, fontWeight: '600', color: C.mute, marginBottom: 4 }}>{tr('Year')}</Text>
      <Chips options={years} value={year} onChange={setYear} />
      {busy && <P mute>Loading…</P>}
      {data && (
        <>
          <Card>
            {data.text.split('\n').map((line, i) => (line.trim() === '' ? <Text key={i}>{' '}</Text> : <P key={i} bold={!line.startsWith(' ') && i > 2}>{line}</P>))}
          </Card>
          <Btn label="Share / print" onPress={() => Share.share({ message: data.text, title: `church-report-${year}.txt` })} />
          <P mute>Totals only. No member's own giving is shown here.</P>
        </>
      )}
    </Screen>
  );
}

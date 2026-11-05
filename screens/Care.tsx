import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Alert, t as tt, tr } from '../i18n';
import { Badge, Btn, C, Card, Chips, Empty, Field, H, P, Screen } from '../components/ui';
import { useNav } from '../nav';
import { canArchiveCare, canPostCare, canRecordSermon } from '../services/permissions';
import { SermonJob, getJob, retryJob, speechRecordingOptions, startAudioJob, startTextJob } from '../services/sermon';
import { followJob } from '../services/sermonFollow';
import { PendingSermon, createSermonQueue } from '../services/sermonQueue';
import { dropRecording, keepRecording, recordingExists } from '../services/recordingStore';
import { useDB } from '../store/db';

export function Care() {
  const { me, db, add, archive } = useDB();
  const { back, go } = useNav();
  const [cadence, setCadence] = useState<'daily' | 'weekly'>('daily');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [waiting, setWaiting] = useState(0);
  useEffect(() => () => { Speech.stop(); }, []);
  useEffect(() => { if (me) createSermonQueue(AsyncStorage, me.id).list().then((l) => setWaiting(l.length)); }, [me?.id]);
  if (!me) return null;
  const messages = db.care.filter((c) => !c.archived).slice().reverse();
  const sermons = db.sermons.filter((s) => !s.archived).slice().reverse();
  const listen = (t: string) => { Speech.stop(); Speech.speak(t, { rate: 0.95 }); };

  return (
    <Screen title="Pastoral Care" onBack={back}>
      <Card style={{ backgroundColor: C.primarySoft }}>
        <H>Spiritual nourishment</H>
        <P mute>Daily and weekly motivation from the pastor and church leadership. Tap Listen to hear it read aloud.</P>
      </Card>
      {canPostCare(me) && (
        <Card>
          <H>Post a message</H>
          <Chips options={['daily', 'weekly'] as const} value={cadence} onChange={setCadence} />
          <Field label="Title" value={title} onChangeText={setTitle} />
          <Field label="Message" value={body} onChangeText={setBody} multiline />
          <Btn label="Post" onPress={async () => {
            if (!title.trim() || !body.trim()) return Alert.alert('Missing', 'Add a title and a message.');
            if (await add('care', { cadence, title: title.trim(), body: body.trim(), authorName: me.name })) { setTitle(''); setBody(''); }
          }} />
        </Card>
      )}
      {canRecordSermon(me) && waiting > 0 && <Card style={{ backgroundColor: '#FDEBD3' }}><H>{tt('{0} sermon recording(s) not finished', String(waiting))}</H><P>They are safe on this phone. Open the Sermon Recorder to send them or check progress.</P><Btn label="Open Sermon Recorder" onPress={() => go('sermon')} /></Card>}
      {canRecordSermon(me) && <Btn kind="danger" label="🎙️ Record sermon & create summary" onPress={() => go('sermon')} />}

      <H>Motivation</H>
      {messages.length ? messages.map((m) => (
        <Card key={m.id}>
          <Badge text={m.cadence === 'daily' ? 'Daily' : 'Weekly'} />
          <H>{m.title}</H>
          <P>{m.body}</P>
          <P mute>{m.authorName} · {new Date(m.createdAt).toLocaleDateString()}</P>
          <Btn small label="🔊 Listen" onPress={() => listen(m.title + '. ' + m.body)} />
          <Btn small kind="ghost" label="■ Stop" onPress={() => Speech.stop()} />
          {canArchiveCare(me) && <Btn small kind="ghost" label="Archive" onPress={() => archive('care', m.id)} />}
        </Card>
      )) : <Empty text="No messages yet." />}

      <H>Sermon summaries</H>
      {sermons.length ? sermons.map((s) => (
        <Card key={s.id}>
          <Badge text={s.audience === 'kids' ? "Kids' sermon" : s.audience === 'quick' ? 'Quick summary – key points' : 'Full sermon summary'} color={s.audience === 'quick' ? C.gold : C.ok} />
          <H>{s.title}</H>
          <P mute>{s.preacher} · {new Date(s.createdAt).toLocaleDateString()} · about {s.readingMinutes} min</P>
          <P>{s.summary}</P>
          <Btn small label="🔊 Listen" onPress={() => listen(s.summary)} />
          <Btn small kind="ghost" label="■ Stop" onPress={() => Speech.stop()} />
          {canArchiveCare(me) && <Btn small kind="ghost" label="Archive" onPress={() => archive('sermons', s.id)} />}
        </Card>
      )) : <Empty text="Sermon summaries appear here soon after the recording is stopped." />}
    </Screen>
  );
}

const clock = (t: number) => String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');

type Phase = 'idle' | 'recording' | 'uploading' | 'working' | 'done' | 'failed';
type Cur = { pid: string; uri: string; title: string; preacher: string; jobId?: string };

export function Sermon() {
  const { me, refresh } = useDB();
  const { back, reset, go } = useNav();
  const [title, setTitle] = useState('');
  const [preacher, setPreacher] = useState(me?.name ?? '');
  const [text, setText] = useState('');
  const [secs, setSecs] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [job, setJob] = useState<SermonJob | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<PendingSermon[]>([]);
  const rec = useRef<Audio.Recording | null>(null);
  const cur = useRef<Cur | null>(null);   // the recording being sent now. It stays on this phone, and in storage, until the summaries are made
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const alive = useRef(true);
  const box = useMemo(() => createSermonQueue(AsyncStorage, me?.id ?? ''), [me?.id]);
  const reload = useCallback(async () => setPending(await box.list()), [box]);
  useEffect(() => { alive.current = true; reload(); return () => { alive.current = false; if (timer.current) clearInterval(timer.current); }; }, [reload]);
  if (!me) return null;
  const meta = () => ({ title: title.trim() || 'Sabbath sermon', preacher: preacher.trim() || me.name });

  const fail = (msg: string) => { setError(msg); setPhase('failed'); };

  // Follow the job on the server: converting to text -> quick summary -> full and children's summaries.
  // Gives up waiting on screen (not on the job) when the server cannot be reached, or after a very long time.
  const follow = async (id: string) => {
    setPhase('working');
    try {
      const r = await followJob(id, { get: getJob, onUpdate: (j) => alive.current && setJob(j), alive: () => alive.current });
      if (r.kind === 'left') return;
      if (r.kind === 'done') {
        await refresh(); setPhase('done');
        if (cur.current) { await box.remove(cur.current.pid); await dropRecording(cur.current.uri); cur.current = null; await reload(); }
        return;
      }
      if (r.kind === 'failed') return fail(r.job.error ?? 'The summary could not be created.');
      if (r.kind === 'offline') return fail('No connection to the church server. Your sermon is safe. Tap Try again when you are online.');
      return fail('This is taking longer than usual. Your sermon is safe on the server. Tap Try again to check, or look in Pastoral Care later.');
    } catch (e) { fail(e instanceof Error ? e.message : 'Could not check the sermon.'); }
  };

  const upload = async (c: Cur) => {
    cur.current = c; setPhase('uploading'); setError('');
    try {
      if (!(await recordingExists(c.uri))) { await box.remove(c.pid); await reload(); return fail('This recording is no longer on the phone, so it cannot be sent. Record the sermon again or paste its text below.'); }
      await box.tried(c.pid);
      const j = await startAudioJob(c.uri, { title: c.title, preacher: c.preacher });
      c.jobId = j.id; await box.sent(c.pid, j.id); await reload();
      setJob(j); await follow(j.id);
    } catch (e) { fail((e instanceof Error ? e.message : 'Upload failed.') + ' ' + tr('Your recording is safe on this phone.')); }
  };

  const start = async () => {
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) return Alert.alert('Microphone needed', 'Allow microphone access to record the sermon.');
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: r } = await Audio.Recording.createAsync(speechRecordingOptions(Audio.RecordingOptionsPresets.HIGH_QUALITY));
      rec.current = r; setSecs(0); setPhase('recording'); setJob(null); setError('');
      timer.current = setInterval(() => setSecs((s) => s + 1), 1000);
    } catch (e) { Alert.alert('Could not start recording', String(e)); }
  };

  const stop = async () => {
    if (timer.current) clearInterval(timer.current);
    try {
      if (!rec.current) return;
      await rec.current.stopAndUnloadAsync();
      const uri = rec.current.getURI(); rec.current = null;
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      if (!uri) return fail('The recording could not be saved on this phone.');
      // Write it down BEFORE uploading: copy the file to safe storage and list it, so a crash or lost connection cannot lose it.
      const pid = 'sm-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const kept = await keepRecording(pid, uri);
      const m = meta();
      await box.add({ id: pid, uri: kept, title: m.title, preacher: m.preacher, seconds: secs });
      await reload();
      await upload({ pid, uri: kept, title: m.title, preacher: m.preacher });
    } catch (e) { fail(e instanceof Error ? e.message : 'Could not stop the recording.'); }
  };

  const sendText = async () => {
    setPhase('uploading'); setError('');
    try { const j = await startTextJob(text.trim(), meta()); cur.current = null; setJob(j); await follow(j.id); }
    catch (e) { fail(e instanceof Error ? e.message : 'Could not send the text.'); }
  };

  const retry = async () => {
    setError('');
    const c = cur.current;
    try {
      if (job && job.status === 'failed') { const j = await retryJob(job.id); setJob(j); await follow(j.id); }
      else if (c?.jobId) await follow(c.jobId);       // the upload worked: just ask the server again
      else if (job) await follow(job.id);
      else if (c) await upload(c);                      // not uploaded yet: send the saved recording again
    } catch (e) { fail(e instanceof Error ? e.message : 'Could not retry.'); }
  };

  // A recording left over from before (the app was closed, the phone restarted, the connection dropped).
  const resume = async (p: PendingSermon) => {
    const c: Cur = { pid: p.id, uri: p.uri, title: p.title, preacher: p.preacher, jobId: p.jobId };
    cur.current = c; setJob(null);
    try { if (p.jobId) await follow(p.jobId); else await upload(c); } catch (e) { fail(e instanceof Error ? e.message : 'Could not continue.'); }
  };

  const recording = phase === 'recording';
  const working = phase === 'uploading' || phase === 'working';
  const step = (label: string, on: boolean, done: boolean) => <Text style={{ color: done ? C.ok : on ? C.ink : C.mute, marginBottom: 2 }}>{done ? '✓ ' : on ? '… ' : '○ '}{tr(label)}</Text>;
  const st = job?.status;
  const others = pending.filter((p) => p.id !== cur.current?.pid);

  return (
    <Screen title="Sermon Recorder" onBack={back}>
      {others.length > 0 && !working && !recording && (
        <Card style={{ backgroundColor: '#FDEBD3' }}>
          <H>Unfinished sermons on this phone</H>
          <P mute>These recordings are safe. Send them, or check how far the server has got.</P>
          {others.map((p) => (
            <View key={p.id} style={{ marginTop: 6 }}>
              <P>{p.title} · {p.preacher} · {new Date(p.savedAt).toLocaleString()}</P>
              <P mute>{p.state === 'sent' ? 'Sent to the server' : 'Not sent yet'}</P>
              <Btn small label={p.state === 'sent' ? 'Check progress' : 'Send now'} onPress={() => resume(p)} />
            </View>
          ))}
        </Card>
      )}
      <Card>
        <H>How it works</H>
        <P mute>Tap Start when the sermon begins and Stop when it ends. The recording is sent to the church server, which turns it into text and writes a quick summary, a full summary for the church (up to about 30 minutes to listen to) and a children's version. They then appear in Pastoral Care.</P>
      </Card>
      <Card style={{ alignItems: 'center' }}>
        <Text style={{ fontSize: 36, fontWeight: '700', color: C.ink }}>{clock(secs)}</Text>
        <View style={{ alignSelf: 'stretch', marginTop: 8 }}>
          <Btn kind={recording ? 'danger' : 'ok'} disabled={working} label={recording ? '■ Stop & create summaries' : '● Start recording'} onPress={recording ? stop : start} />
        </View>
      </Card>

      {(working || phase === 'done' || phase === 'failed') && (
        <Card>
          <H>{phase === 'done' ? 'Summaries are ready' : phase === 'failed' ? 'Something went wrong' : 'Working on your sermon…'}</H>
          {step('Recording sent to the server', phase === 'uploading', phase !== 'uploading')}
          {step('Converting speech to text', st === 'transcribing', st === 'summarizing' || st === 'done')}
          {step('Writing the summaries', st === 'summarizing', st === 'done')}
          {job?.stage && working ? <P mute>{job.stage}</P> : null}
          {phase === 'working' ? <P mute>This can take several minutes for a long sermon. You can leave this screen; the summaries will appear in Pastoral Care.</P> : null}
          {phase === 'failed' && <><P>{error}</P><Btn label="Try again" onPress={retry} /></>}
          {phase === 'done' && <Btn label="Open Pastoral Care" onPress={() => { reset(); go('care'); }} />}
        </Card>
      )}

      <Card>
        <Field label="Sermon title" value={title} onChangeText={setTitle} />
        <Field label="Preacher" value={preacher} onChangeText={setPreacher} />
        <H>No recording? Paste the sermon text</H>
        <Field label="Sermon text" value={text} onChangeText={setText} multiline />
        <Btn kind="ghost" label="Create summaries from this text" disabled={working || recording || text.trim().split(/\s+/).length < 30} onPress={sendText} />
      </Card>
    </Screen>
  );
}

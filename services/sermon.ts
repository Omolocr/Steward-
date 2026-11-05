// Sermon summaries are made on the church server (speech-to-text, then AI summaries).
// The phone only records the sermon, uploads it, and shows progress. Nothing is summarised on the phone.
import { api } from '../api';

export type JobStatus = 'queued' | 'transcribing' | 'summarizing' | 'done' | 'failed';

export interface SermonJob {
  id: string;
  title: string;
  status: JobStatus;
  stage: string | null;
  error: string | null;
  quickReady: boolean;
  generalReady: boolean;
  kidsReady: boolean;
}

interface Meta { title: string; preacher: string }

/** Uploads the recording. Long sermons are fine: the server converts and cuts them up. */
export async function startAudioJob(audioUri: string, meta: Meta): Promise<SermonJob> {
  const blob = await (await fetch(audioUri)).blob();
  const r = await api.upload<{ job: SermonJob }>('/sermons/jobs', blob, 'audio/mp4', {
    'X-Title': encodeURIComponent(meta.title),
    'X-Preacher': encodeURIComponent(meta.preacher),
  });
  return r.job;
}

/** For when the sermon text already exists (pasted, or typed from notes). */
export async function startTextJob(transcript: string, meta: Meta): Promise<SermonJob> {
  const r = await api.post<{ job: SermonJob }>('/sermons/jobs', { ...meta, transcript });
  return r.job;
}

export const getJob = async (id: string) => (await api.get<{ job: SermonJob }>('/sermons/jobs/' + id)).job;
export const retryJob = async (id: string) => (await api.post<{ job: SermonJob }>(`/sermons/jobs/${id}/retry`)).job;

/** Speech needs little quality, so record small files (about 14 MB per hour) that upload quickly on mobile data. */
export function speechRecordingOptions(highQuality: { android: object; ios: object; web?: object }) {
  const small = { sampleRate: 16000, numberOfChannels: 1, bitRate: 32000 };
  return {
    ...highQuality,
    android: { ...highQuality.android, ...small },
    ios: { ...highQuality.ios, ...small },
  };
}

// The phone's own copy of a sermon recording. The recorder writes into a cache folder the phone may clear at any time,
// so the file is copied to the app's document folder, where it stays until the summaries have been made.
import * as FileSystem from 'expo-file-system';

const dir = () => (FileSystem.documentDirectory ?? '') + 'sermons/';

/** Copy the recording somewhere safe. If that fails, the original file is still used (better than nothing). */
export async function keepRecording(id: string, uri: string): Promise<string> {
  try {
    await FileSystem.makeDirectoryAsync(dir(), { intermediates: true });
    const to = dir() + id + '.m4a';
    await FileSystem.copyAsync({ from: uri, to });
    return to;
  } catch { return uri; }
}

export async function recordingExists(uri: string): Promise<boolean> {
  try { return (await FileSystem.getInfoAsync(uri)).exists; } catch { return false; }
}

/** Only the app's own copy is removed, and only after the server has made the summaries. */
export async function dropRecording(uri: string): Promise<void> {
  try { if (uri.startsWith(dir())) await FileSystem.deleteAsync(uri, { idempotent: true }); } catch { /* harmless */ }
}

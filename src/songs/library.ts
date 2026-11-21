import {
  BUNDLED_SONGS,
  bundledSongUrl,
  DEFAULT_SONG_ID,
  LOCAL_SONGS,
  type SongEntry,
} from './catalog';
import { addUserSong, getUserSongBlob, listUserSongs, removeUserSong } from './userSongs';

const LAST_SONG_KEY = 'midi.lastSong';

/** All songs: built-in (public repo), this device (git-ignored songs.local/), my songs (IndexedDB). */
export class SongLibrary {
  async list(): Promise<SongEntry[]> {
    let user: SongEntry[] = [];
    try {
      user = await listUserSongs();
    } catch (err) {
      console.warn('Could not read saved songs', err);
    }
    return [...BUNDLED_SONGS, ...LOCAL_SONGS, ...user];
  }

  /** Content for OSMD: a URL is fetched here so errors read nicely; files stay Blobs (MXL works). */
  async content(id: string): Promise<string | Blob> {
    const bundled = BUNDLED_SONGS.find((s) => s.id === id);
    const local = LOCAL_SONGS.find((s) => s.id === id);
    const url = bundled ? bundledSongUrl(bundled) : local?.url;
    if (url) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return response.blob();
    }
    if (id.startsWith('user:')) return getUserSongBlob(id);
    throw new Error('Unknown song');
  }

  add(file: File): Promise<SongEntry> {
    return addUserSong(file);
  }

  remove(id: string): Promise<void> {
    return removeUserSong(id);
  }

  lastSongId(): string {
    try {
      return localStorage.getItem(LAST_SONG_KEY) ?? DEFAULT_SONG_ID;
    } catch {
      return DEFAULT_SONG_ID;
    }
  }

  rememberSong(id: string): void {
    try {
      localStorage.setItem(LAST_SONG_KEY, id);
    } catch {
      // private mode etc.: not important
    }
  }
}

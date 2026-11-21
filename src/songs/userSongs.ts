import { type SongEntry, titleFromFileName, titleFromMusicXml } from './catalog';

/**
 * "My songs": files you add from your device, stored in this browser / app's IndexedDB.
 * They never leave the device — nothing is uploaded or committed.
 */

interface StoredSong {
  id: string;
  title: string;
  fileName: string;
  addedAt: number;
  data: ArrayBuffer;
}

const DB_NAME = 'midi';
const STORE = 'songs';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

function toEntry(s: StoredSong): SongEntry {
  return { id: s.id, title: s.title, group: 'my songs', credit: s.fileName };
}

export async function listUserSongs(): Promise<SongEntry[]> {
  if (typeof indexedDB === 'undefined') return [];
  const all = await withStore<StoredSong[]>('readonly', (s) => s.getAll());
  return all.sort((a, b) => a.title.localeCompare(b.title)).map(toEntry);
}

export async function getUserSongBlob(id: string): Promise<Blob> {
  const song = await withStore<StoredSong | undefined>('readonly', (s) => s.get(id));
  if (!song) throw new Error('That song is no longer on this device.');
  return new Blob([song.data]);
}

export async function addUserSong(file: File): Promise<SongEntry> {
  const data = await file.arrayBuffer();
  const isZip = new Uint8Array(data.slice(0, 2)).every((b, i) => b === [0x50, 0x4b][i]);
  const title =
    (!isZip && titleFromMusicXml(new TextDecoder().decode(data.slice(0, 64_000)))) ||
    titleFromFileName(file.name);
  const song: StoredSong = {
    id: `user:${newId()}`,
    title,
    fileName: file.name,
    addedAt: Date.now(),
    data,
  };
  await withStore('readwrite', (s) => s.put(song));
  return toEntry(song);
}

/** crypto.randomUUID is missing on iOS < 15.4. */
function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function removeUserSong(id: string): Promise<void> {
  await withStore('readwrite', (s) => s.delete(id));
}

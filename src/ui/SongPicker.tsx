import { useEffect, useRef, useState } from 'react';
import type { SongEntry, SongGroup } from '../songs/catalog';
import { useAppState, useServices } from './context';

const GROUP_LABELS: Record<SongGroup, string> = {
  'built-in': 'Built-in',
  'this device': 'This build only',
  'my songs': 'My songs (this device)',
};

export function SongPicker() {
  const { session } = useServices();
  const songs = useAppState((s) => s.songs);
  const currentId = useAppState((s) => s.currentSongId);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  // "Remove" needs a second tap within a few seconds (no blocking confirm dialogs).
  useEffect(() => {
    if (!confirmRemove) return;
    const t = setTimeout(() => setConfirmRemove(false), 4000);
    return () => clearTimeout(t);
  }, [confirmRemove]);

  const groups = (['built-in', 'this device', 'my songs'] as const)
    .map((group) => ({ group, items: songs.filter((s) => s.group === group) }))
    .filter((g) => g.items.length > 0);
  const current: SongEntry | undefined = songs.find((s) => s.id === currentId);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.(musicxml|xml|mxl)$/i.test(file.name)) {
      setError('Pick a MusicXML file (.musicxml, .xml or .mxl).');
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await session.addSong(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  return (
    <div className="song-picker">
      <select
        aria-label="Song"
        value={currentId ?? ''}
        onChange={(e) => void session.openSong(e.target.value)}
        data-testid="song-select"
      >
        {groups.map(({ group, items }) => (
          <optgroup key={group} label={GROUP_LABELS[group]}>
            {items.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <button
        type="button"
        className="ghost"
        disabled={busy}
        onClick={() => fileInput.current?.click()}
        title="Add a MusicXML (.musicxml, .xml) or compressed MusicXML (.mxl) file. It is stored only on this device."
      >
        {busy ? 'Adding…' : 'Add song'}
      </button>
      <input
        ref={fileInput}
        type="file"
        // No `accept`: iOS maps it to registered file types, and .musicxml/.mxl have none,
        // so they'd be greyed out in the Files picker. The name is checked after picking.
        hidden
        data-testid="song-file"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      {current?.group === 'my songs' && (
        <button
          type="button"
          className={confirmRemove ? 'danger' : 'ghost'}
          onClick={() => {
            if (!confirmRemove) return setConfirmRemove(true);
            setConfirmRemove(false);
            void session.removeSong(current.id);
          }}
        >
          {confirmRemove ? 'Tap again to remove' : 'Remove'}
        </button>
      )}
      {current?.credit && <span className="song-credit">{current.credit}</span>}
      {error && <span className="pill error">{error}</span>}
    </div>
  );
}

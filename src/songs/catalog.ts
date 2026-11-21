export type SongGroup = 'built-in' | 'this device' | 'my songs';

export interface SongEntry {
  /** `builtin:…`, `local:…` or `user:…` */
  id: string;
  title: string;
  group: SongGroup;
  credit?: string;
}

interface BundledSong extends SongEntry {
  file: string;
}

/**
 * Songs shipped in the public repo. Only public-domain music in arrangements written for
 * this project (CC0) — never copyrighted songs.
 */
export const BUNDLED_SONGS: readonly BundledSong[] = [
  {
    id: 'builtin:ode-to-joy',
    title: 'Ode to Joy',
    group: 'built-in',
    credit: 'Beethoven · arr. CC0',
    file: 'ode-to-joy.musicxml',
  },
  {
    id: 'builtin:gymnopedie-1',
    title: 'Gymnopédie No. 1',
    group: 'built-in',
    credit: 'Satie · one pass, final ending · arr. CC0',
    file: 'gymnopedie-1.musicxml',
  },
  {
    id: 'builtin:winter-lanterns',
    title: 'Winter Lanterns',
    group: 'built-in',
    credit: 'Original · CC0',
    file: 'winter-lanterns.musicxml',
  },
];

export const DEFAULT_SONG_ID = 'builtin:ode-to-joy';

export function bundledSongUrl(song: BundledSong): string {
  return `${import.meta.env.BASE_URL}songs/${song.file}`;
}

/**
 * Optional private folder for your own builds: drop MusicXML/MXL files into `songs.local/`
 * (git-ignored) and they are bundled into local builds only — e.g. the iPad app you build
 * on your Mac. The public GitHub Pages build never contains them.
 */
const LOCAL_FILES = import.meta.glob('/songs.local/*.{musicxml,xml,mxl}', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export interface LocalSong extends SongEntry {
  url: string;
}

export const LOCAL_SONGS: readonly LocalSong[] = Object.entries(LOCAL_FILES)
  .map(([path, url]) => {
    const file = path.split('/').pop() ?? path;
    return {
      id: `local:${file}`,
      title: titleFromFileName(file),
      group: 'this device' as const,
      url,
    };
  })
  .sort((a, b) => a.title.localeCompare(b.title));

export function titleFromFileName(fileName: string): string {
  return (
    fileName
      .replace(/\.(musicxml|xml|mxl)$/i, '')
      .replace(/[_-]+/g, ' ')
      .trim() || fileName
  );
}

/** Title from MusicXML text, without a full parse. */
export function titleFromMusicXml(text: string): string | null {
  const match =
    /<work-title>([^<]*)<\/work-title>/.exec(text) ??
    /<movement-title>([^<]*)<\/movement-title>/.exec(text);
  const title = match?.[1]?.trim();
  return title ? decodeEntities(title) : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

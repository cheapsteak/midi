export type OsmdLib = typeof import('opensheetmusicdisplay');

let cached: Promise<OsmdLib> | null = null;

/**
 * OSMD ships one ~1.5 MB UMD bundle. A dynamic import keeps it out of the first chunk.
 * Depending on the bundler/runtime its classes arrive as named exports or on `default`.
 */
export function loadOsmd(): Promise<OsmdLib> {
  cached ??= import('opensheetmusicdisplay').then((m) => {
    const mod = m as OsmdLib & { default?: OsmdLib };
    if (mod.OpenSheetMusicDisplay) return mod;
    if (mod.default?.OpenSheetMusicDisplay) return mod.default;
    throw new Error('Could not load OpenSheetMusicDisplay');
  });
  return cached;
}

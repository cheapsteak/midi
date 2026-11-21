import { describe, expect, it } from 'vitest';
import { titleFromFileName, titleFromMusicXml } from './catalog';

describe('song titles', () => {
  it('reads work-title, then movement-title, decoding entities', () => {
    expect(titleFromMusicXml('<work><work-title>Rock &amp; Roll</work-title></work>')).toBe(
      'Rock & Roll',
    );
    expect(titleFromMusicXml('<movement-title>Étude</movement-title>')).toBe('Étude');
    expect(titleFromMusicXml('<score-partwise/>')).toBeNull();
  });

  it('falls back to a tidy file name', () => {
    expect(titleFromFileName('My_Song-v2.mxl')).toBe('My Song v2');
    expect(titleFromFileName('Prelude.musicxml')).toBe('Prelude');
  });
});

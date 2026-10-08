import { Channel } from '@iptvnator/shared/interfaces';
import { isM3uMovieRow } from './m3u-movie-row.util';

const row = (url: string, name: string) => ({ url, name }) as Channel;

describe('isM3uMovieRow', () => {
    it('opens a film the Movies grid offers despite an episode-looking word', () => {
        // The catalog files this under Movies ("Bölüm 2" is "Part 2"); the
        // player's own gate alone would send its card to the live layout.
        expect(
            isM3uMovieRow(
                row('http://h.example/movie/u/p/7.mkv', 'KILL BILL: BÖLÜM 2')
            )
        ).toBe(true);
    });

    it('still opens what the player always treated as a film', () => {
        expect(
            isM3uMovieRow(row('http://h.example/films/Dune.mp4', 'Dune'))
        ).toBe(true);
    });

    it('leaves episodes and streams alone', () => {
        expect(
            isM3uMovieRow(
                row('http://h.example/series/u/p/1.mp4', 'Dark S01E01')
            )
        ).toBe(false);
        expect(
            isM3uMovieRow(row('http://h.example/live/u/p/1.m3u8', 'TRT 1'))
        ).toBe(false);
    });
});

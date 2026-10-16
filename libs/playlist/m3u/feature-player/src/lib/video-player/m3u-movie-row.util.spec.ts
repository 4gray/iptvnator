import { Channel } from '@iptvnator/shared/interfaces';
import { isM3uMovieRow } from './m3u-movie-row.util';

const row = (url: string, name: string) => ({ url, name }) as Channel;

const KILL_BILL = row('http://h.example/movie/u/p/7.mkv', 'KILL BILL: BÖLÜM 2');
const SERIAL = row('http://h.example/x/1.mp4', 'UZAK ŞEHİR 120.BÖLÜM');

describe('isM3uMovieRow', () => {
    describe('while the catalog split is in effect', () => {
        it('opens a film the Movies grid offers despite an episode-looking word', () => {
            // The catalog files this under Movies ("Bölüm 2" is "Part 2");
            // the original gate would send its card to the live layout.
            expect(isM3uMovieRow(KILL_BILL, true)).toBe(true);
        });

        it('does not open as a film a row the catalog files as an episode', () => {
            // A three-digit daily-serial number: the original gate misses
            // the marker and would look the episode up as a film.
            expect(isM3uMovieRow(SERIAL, true)).toBe(false);
        });

        it('leaves episodes and streams alone', () => {
            expect(
                isM3uMovieRow(
                    row('http://h.example/series/u/p/1.mp4', 'Dark S01E01'),
                    true
                )
            ).toBe(false);
            expect(
                isM3uMovieRow(
                    row('http://h.example/live/u/p/1.m3u8', 'TRT 1'),
                    true
                )
            ).toBe(false);
        });
    });

    describe('with the split off or a live-only playlist', () => {
        it('answers exactly as the original gate did', () => {
            expect(isM3uMovieRow(KILL_BILL, false)).toBe(false);
            expect(isM3uMovieRow(SERIAL, false)).toBe(true);
            expect(
                isM3uMovieRow(
                    row('http://h.example/films/Dune.mp4', 'Dune'),
                    false
                )
            ).toBe(true);
        });
    });
});

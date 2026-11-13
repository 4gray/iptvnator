import { ChannelActions } from '@iptvnator/m3u-state';
import { Channel } from '@iptvnator/shared/interfaces';
import { classifyM3uEntry } from '@iptvnator/shared/m3u-utils/catalog';
import { handoffAction, isM3uMovieRow } from './m3u-movie-row.util';

const row = (url: string, name: string) => ({ url, name }) as Channel;

const FILM_PART_TWO = row(
    'http://h.example/movie/u/p/7.mkv',
    'GECE AVCISI: BÖLÜM 2'
);
const SERIAL = row('http://h.example/x/1.mp4', 'SESSİZ VADİ 120.BÖLÜM');

describe('isM3uMovieRow', () => {
    describe('while the catalog split is in effect', () => {
        it('opens a film the Movies grid offers despite an episode-looking word', () => {
            // The catalog files this under Movies ("Bölüm 2" is "Part 2");
            // the original gate would send its card to the live layout.
            expect(isM3uMovieRow(FILM_PART_TWO, true)).toBe(true);
        });

        it('does not open as a film a row the catalog files as an episode', () => {
            // A three-digit daily-serial number: the original gate misses
            // the marker and would look the episode up as a film.
            expect(isM3uMovieRow(SERIAL, true)).toBe(false);
        });

        it('leaves episodes and streams alone', () => {
            expect(
                isM3uMovieRow(
                    row('http://h.example/series/u/p/1.mp4', 'Hollow S01E01'),
                    true
                )
            ).toBe(false);
            expect(
                isM3uMovieRow(
                    row('http://h.example/live/u/p/1.m3u8', 'KANAL ORNEK 1'),
                    true
                )
            ).toBe(false);
        });
    });

    describe('a row the classifier leaves in the live list', () => {
        it('keeps the detail view for a film without a year or a movie path', () => {
            const film = row('http://h.example/films/Sandline.mp4', 'Sandline');
            // The premise: another row split the playlist, this one stayed.
            expect(classifyM3uEntry(film)).toBe('live');
            expect(isM3uMovieRow(film, true)).toBe(true);
        });

        it('still refuses a file whose name carries an episode word', () => {
            const episode = row(
                'http://h.example/x/9.mp4',
                'CELIK KULE - BÖLÜM 1'
            );
            expect(classifyM3uEntry(episode)).toBe('live');
            expect(isM3uMovieRow(episode, true)).toBe(false);
        });
    });

    describe('with the split off or a live-only playlist', () => {
        it('answers exactly as the original gate did', () => {
            expect(isM3uMovieRow(FILM_PART_TWO, false)).toBe(false);
            expect(isM3uMovieRow(SERIAL, false)).toBe(true);
            expect(
                isM3uMovieRow(
                    row('http://h.example/films/Sandline.mp4', 'Sandline'),
                    false
                )
            ).toBe(true);
        });
    });
});

describe('handoffAction', () => {
    const split = { splitsCatalog: () => true };
    const unsplit = { splitsCatalog: () => false };
    const film = row('http://h.example/movie/u/p/7.mkv', 'Sandline (2019)');
    const live = row('http://h.example/live/u/p/1.m3u8', 'KANAL ORNEK 1');

    it('requests playback for a film or episode the live list does not show', () => {
        expect(handoffAction(film, 'all', split)).toEqual(
            ChannelActions.setActiveChannel({
                channel: film,
                startPlayback: true,
            })
        );
        expect(handoffAction(SERIAL, 'all', split).startPlayback).toBe(true);
    });

    it('only selects a row the landing view lists', () => {
        const select = (channel: Channel) =>
            ChannelActions.setActiveChannel({ channel });
        expect(handoffAction(live, 'all', split)).toEqual(select(live));
        expect(handoffAction(film, 'all', unsplit)).toEqual(select(film));
        expect(handoffAction(film, 'recent', split)).toEqual(select(film));
    });
});

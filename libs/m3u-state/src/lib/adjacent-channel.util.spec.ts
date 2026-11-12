import { Channel } from '@iptvnator/shared/interfaces';
import { resolveAdjacentChannel } from './adjacent-channel.util';

const channel = (id: string) => ({ id }) as Channel;

const RADIO_A = channel('radio-a');
const RADIO_B = channel('radio-b');
const FILM = channel('film');
const NEWS = channel('news');
// File order: a film sits between the stations and the next channel.
const ALL = [RADIO_A, RADIO_B, FILM, NEWS];
const LIVE = [RADIO_A, RADIO_B, NEWS];

describe('resolveAdjacentChannel', () => {
    it('steps over a film the split took out of the list', () => {
        expect(resolveAdjacentChannel('next', RADIO_B, ALL, LIVE)).toBe(NEWS);
        expect(resolveAdjacentChannel('previous', NEWS, ALL, LIVE)).toBe(
            RADIO_B
        );
    });

    it('walks the stored array when the list is not split', () => {
        expect(resolveAdjacentChannel('next', RADIO_B, ALL, ALL)).toBe(FILM);
    });

    it('keeps file neighbours for a row that is not in the live list', () => {
        expect(resolveAdjacentChannel('next', FILM, ALL, LIVE)).toBe(NEWS);
        expect(resolveAdjacentChannel('previous', FILM, ALL, LIVE)).toBe(
            RADIO_B
        );
    });

    it('has nothing past either end', () => {
        expect(resolveAdjacentChannel('next', NEWS, ALL, LIVE)).toBeUndefined();
        expect(
            resolveAdjacentChannel('previous', RADIO_A, ALL, LIVE)
        ).toBeUndefined();
    });
});

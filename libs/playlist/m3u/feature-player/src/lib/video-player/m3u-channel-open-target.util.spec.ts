import { Channel } from '@iptvnator/shared/interfaces';
import {
    findM3uChannelOpenTarget,
    isM3uChannelOpenTarget,
} from './m3u-channel-open-target.util';

const row = (id: string, url: string) => ({ id, url }) as Channel;

const URL_A = 'http://h.example/movie/u/p/1.mkv';
const FIRST = row('row-1', URL_A);
const SECOND = row('row-2', URL_A);
const OTHER = row('row-3', 'http://h.example/movie/u/p/2.mkv');

describe('findM3uChannelOpenTarget', () => {
    it('opens the named row, not the first one sharing its URL', () => {
        expect(
            findM3uChannelOpenTarget([FIRST, SECOND, OTHER], URL_A, 'row-2')
        ).toBe(SECOND);
    });

    it('selects by URL when the caller sent no id', () => {
        expect(findM3uChannelOpenTarget([FIRST, SECOND], URL_A, '')).toBe(
            FIRST
        );
    });

    it('falls back to the URL when the id no longer exists', () => {
        // A refresh between the click and the load can re-mint row ids.
        expect(
            findM3uChannelOpenTarget([FIRST, SECOND], URL_A, 'row-gone')
        ).toBe(FIRST);
    });

    it('never takes an id match whose URL differs', () => {
        expect(findM3uChannelOpenTarget([OTHER], URL_A, 'row-3')).toBe(
            undefined
        );
    });
});

describe('isM3uChannelOpenTarget', () => {
    it('does not treat a sibling row with the same URL as already open', () => {
        expect(isM3uChannelOpenTarget(FIRST, URL_A, 'row-2')).toBe(false);
        expect(isM3uChannelOpenTarget(SECOND, URL_A, 'row-2')).toBe(true);
    });

    it('matches by URL alone when no id was sent', () => {
        expect(isM3uChannelOpenTarget(FIRST, URL_A, '')).toBe(true);
        expect(isM3uChannelOpenTarget(null, URL_A, '')).toBe(false);
    });
});

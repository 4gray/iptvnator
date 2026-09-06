import { LiveChannelPlaybackQueue } from './live-channel-playback-queue';

interface Channel {
    id: string | number | null;
    name: string;
}
const alpha: Channel = { id: 1, name: 'Alpha' };
const beta: Channel = { id: 2, name: 'Beta' };
const gamma: Channel = { id: 3, name: 'Gamma' };

describe('LiveChannelPlaybackQueue', () => {
    let queue: LiveChannelPlaybackQueue<Channel>;
    beforeEach(() => {
        queue = new LiveChannelPlaybackQueue((item) => item.id);
    });

    it('captures the displayed order independently of subsequent browsing', () => {
        const displayed = [beta, alpha];
        queue.capture('source:itv', 'news:q:sort', displayed, alpha);
        displayed.reverse();
        queue.extend('source:itv', 'sports:q:sort', [gamma]);
        expect(queue.items('source:itv')).toEqual([beta, alpha]);
    });

    it('does not expose a different source or content type queue', () => {
        queue.capture('source:itv', 'news', [alpha, beta], alpha);
        expect(queue.items('source:radio')).toEqual([]);
        expect(queue.items('other:itv')).toEqual([]);
    });

    it('extends only the original loaded scope and retains channel numbers', () => {
        queue.capture('source:itv', 'news', [alpha, beta], alpha);
        queue.extend('source:itv', 'news', [gamma, beta, alpha]);
        expect(queue.items('source:itv')).toEqual([alpha, beta, gamma]);
    });

    it('ignores a late page from a previous owner', () => {
        queue.capture('source:radio', 'news', [alpha], alpha);
        queue.extend('source:itv', 'news', [alpha, beta]);
        expect(queue.items('source:radio')).toEqual([alpha]);
    });

    it('refreshes metadata without changing existing order', () => {
        queue.capture('source:itv', 'news', [alpha, beta], alpha);
        const updatedBeta = { ...beta, name: 'Beta HD' };
        queue.extend('source:itv', 'news', [alpha, updatedBeta]);
        expect(queue.items('source:itv')).toEqual([alpha, updatedBeta]);
    });

    it('does not lose a captured page when the browse resource temporarily clears', () => {
        queue.capture('source:itv', 'news', [alpha, beta], alpha);
        queue.extend('source:itv', 'news', []);
        expect(queue.items('source:itv')).toEqual([alpha, beta]);
    });

    it('deduplicates normalized IDs and excludes invalid IDs', () => {
        queue.capture(
            'source',
            'news',
            [alpha, { ...alpha, id: '1' }, { id: null, name: '?' }, beta],
            alpha
        );
        expect(queue.items('source')).toEqual([alpha, beta]);
    });

    it('falls back to the selected channel, never an unrelated list', () => {
        queue.capture('source', 'news', [alpha, beta], gamma);
        expect(queue.items('source')).toEqual([gamma]);
    });

    it('rejects invalid selected IDs', () => {
        queue.capture('source', 'news', [alpha], { id: null, name: '?' });
        expect(queue.items('source')).toEqual([]);
    });

    it('preserves snapshot identity when a page has not changed', () => {
        queue.capture('source', 'news', [alpha, beta], alpha);
        const previous = queue.items('source');
        queue.extend('source', 'news', [alpha, beta]);
        expect(queue.items('source')).toBe(previous);
    });

    it('replaces the queue on a new explicit channel selection and clears on teardown', () => {
        queue.capture('source', 'news', [alpha, beta], alpha);
        queue.capture('source', 'sports', [gamma], gamma);
        expect(queue.items('source')).toEqual([gamma]);
        queue.clear();
        expect(queue.items('source')).toEqual([]);
    });
});

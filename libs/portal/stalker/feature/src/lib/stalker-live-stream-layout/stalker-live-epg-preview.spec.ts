import type { EpgProgram } from '@iptvnator/shared/interfaces';
import {
    StalkerEpgPreviewQueue,
    mergeEpgProgramLists,
} from './stalker-live-epg-preview';

function buildProgram(
    channelId: string,
    title: string,
    startOffsetMinutes: number,
    durationMinutes = 30
): EpgProgram {
    const startTimestamp = Math.floor(
        (Date.now() + startOffsetMinutes * 60 * 1000) / 1000
    );
    const stopTimestamp = startTimestamp + durationMinutes * 60;

    return {
        start: new Date(startTimestamp * 1000).toISOString(),
        stop: new Date(stopTimestamp * 1000).toISOString(),
        channel: channelId,
        title,
        desc: null,
        category: null,
        startTimestamp,
        stopTimestamp,
    };
}

function flushQueue(ms = 600): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('mergeEpgProgramLists', () => {
    it('returns the other list when one side is empty', () => {
        const programs = [buildProgram('1', 'Now', -10)];

        expect(mergeEpgProgramLists(programs, [])).toEqual(programs);
        expect(mergeEpgProgramLists([], programs)).toEqual(programs);
    });

    it('fills the missing current programme from the fallback list', () => {
        // A bulk guide that only carries future programmes — the reported
        // portal shape — merged with a short EPG that starts at "now".
        const future = buildProgram('1', 'Later', 120);
        const current = buildProgram('1', 'Now', -10);

        const merged = mergeEpgProgramLists([future], [current]);

        expect(merged.map((program) => program.title)).toEqual([
            'Now',
            'Later',
        ]);
    });

    it('keeps the primary entry on an exact start-time collision', () => {
        const primary = buildProgram('1', 'Bulk title', -10);
        const duplicate = {
            ...buildProgram('1', 'Fallback title', -10),
            startTimestamp: primary.startTimestamp,
            start: primary.start,
        };

        const merged = mergeEpgProgramLists([primary], [duplicate]);

        expect(merged).toHaveLength(1);
        expect(merged[0].title).toBe('Bulk title');
    });
});

describe('StalkerEpgPreviewQueue', () => {
    it('drops cached windows when the display offset changes', async () => {
        let offset = 0;
        const fetchPrograms = jest.fn(async (channelId: string) => [
            buildProgram(channelId, `Now ${channelId}`, -10),
        ]);
        const queue = new StalkerEpgPreviewQueue({
            fetchPrograms,
            onPrograms: jest.fn(),
            epgOffsetMinutes: () => offset,
        });

        queue.sync(['1']);
        await flushQueue();
        expect(fetchPrograms).toHaveBeenCalledTimes(1);
        expect(queue.getCachedPrograms('1')).toHaveLength(1);

        // A different offset means a different window and a different "now".
        offset = -60;
        expect(queue.getCachedPrograms('1')).toBeNull();
        queue.sync(['1']);
        await flushQueue();
        expect(fetchPrograms).toHaveBeenCalledTimes(2);
        queue.destroy();
    });

    it('discards a window fetched for a previous offset and fetches again', async () => {
        let offset = 0;
        let resolveFirst!: (programs: EpgProgram[]) => void;
        const fetchPrograms = jest
            .fn<Promise<EpgProgram[]>, [string]>()
            .mockImplementationOnce(
                () =>
                    new Promise<EpgProgram[]>((resolve) => {
                        resolveFirst = resolve;
                    })
            )
            .mockImplementation(async (channelId: string) => [
                buildProgram(channelId, `Later ${channelId}`, 50),
            ]);
        const onPrograms = jest.fn();
        const queue = new StalkerEpgPreviewQueue({
            fetchPrograms,
            onPrograms,
            epgOffsetMinutes: () => offset,
        });

        queue.sync(['1']);
        await flushQueue(50);
        expect(fetchPrograms).toHaveBeenCalledTimes(1);

        // The setting changes while the request is on the wire; the sync it
        // triggers finds the channel in flight and skips it.
        offset = -60;
        queue.sync(['1']);
        resolveFirst([buildProgram('1', 'Now 1', -10)]);
        await flushQueue();

        // The stale window is neither reported nor cached; the channel was
        // fetched again for the new offset.
        expect(onPrograms).toHaveBeenCalledTimes(1);
        expect(onPrograms).toHaveBeenCalledWith('1', [
            expect.objectContaining({ title: 'Later 1' }),
        ]);
        expect(fetchPrograms).toHaveBeenCalledTimes(2);
        expect(queue.getCachedPrograms('1')).toHaveLength(1);
        queue.destroy();
    });

    it('fetches each synced channel once and reuses the cache afterwards', async () => {
        const fetchPrograms = jest.fn(async (channelId: string) => [
            buildProgram(channelId, `Now ${channelId}`, -10),
        ]);
        const onPrograms = jest.fn();
        const queue = new StalkerEpgPreviewQueue({ fetchPrograms, onPrograms });

        queue.sync(['1', '2']);
        await flushQueue();

        expect(fetchPrograms).toHaveBeenCalledTimes(2);
        expect(onPrograms).toHaveBeenCalledWith('1', [
            expect.objectContaining({ title: 'Now 1' }),
        ]);
        expect(onPrograms).toHaveBeenCalledWith('2', [
            expect.objectContaining({ title: 'Now 2' }),
        ]);
        expect(queue.getCachedPrograms('1')).toHaveLength(1);

        queue.sync(['1', '2']);
        await flushQueue(300);

        expect(fetchPrograms).toHaveBeenCalledTimes(2);
        queue.destroy();
    });

    it('caches empty results without reporting them', async () => {
        const fetchPrograms = jest.fn(async () => [] as EpgProgram[]);
        const onPrograms = jest.fn();
        const queue = new StalkerEpgPreviewQueue({ fetchPrograms, onPrograms });

        queue.sync(['1']);
        await flushQueue(300);
        queue.sync(['1']);
        await flushQueue(300);

        // The portal answered "no EPG" — remembered, not re-asked and not
        // surfaced as a preview.
        expect(fetchPrograms).toHaveBeenCalledTimes(1);
        expect(onPrograms).not.toHaveBeenCalled();
        expect(queue.getCachedPrograms('1')).toEqual([]);
        queue.destroy();
    });

    it('drops channels that were superseded before their fetch started', async () => {
        const fetchPrograms = jest.fn(async (channelId: string) => [
            buildProgram(channelId, `Now ${channelId}`, -10),
        ]);
        const onPrograms = jest.fn();
        const queue = new StalkerEpgPreviewQueue({ fetchPrograms, onPrograms });

        // '1' starts immediately; '2' and '3' wait behind the throttle
        // delay. The second sync (a re-render without '3') must supersede
        // the first work list before the throttle releases them.
        queue.sync(['1', '2', '3']);
        queue.sync(['1', '2']);
        await flushQueue();

        expect(fetchPrograms).toHaveBeenCalledWith('1');
        expect(fetchPrograms).toHaveBeenCalledWith('2');
        expect(fetchPrograms).not.toHaveBeenCalledWith('3');
        queue.destroy();
    });

    it('caps each sync at the per-sync backlog limit and refills on the next sync', async () => {
        const fetchPrograms = jest.fn(async (channelId: string) => [
            buildProgram(channelId, `Now ${channelId}`, -10),
        ]);
        const queue = new StalkerEpgPreviewQueue(
            { fetchPrograms, onPrograms: jest.fn() },
            { delayMs: 0, maxPerSync: 2 }
        );

        // Request count must track user engagement, not render size: only
        // the first slice is fetched per sync, the rest waits for the next
        // (scroll-driven) sync.
        queue.sync(['1', '2', '3', '4']);
        await flushQueue(50);

        expect(fetchPrograms).toHaveBeenCalledTimes(2);
        expect(fetchPrograms).not.toHaveBeenCalledWith('3');

        queue.sync(['1', '2', '3', '4']);
        await flushQueue(50);

        expect(fetchPrograms).toHaveBeenCalledTimes(4);
        expect(fetchPrograms).toHaveBeenCalledWith('3');
        expect(fetchPrograms).toHaveBeenCalledWith('4');
        queue.destroy();
    });

    it('discards in-flight results after a reset', async () => {
        let resolveFetch!: (programs: EpgProgram[]) => void;
        const fetchPrograms = jest.fn(
            () =>
                new Promise<EpgProgram[]>((resolve) => {
                    resolveFetch = resolve;
                })
        );
        const onPrograms = jest.fn();
        const queue = new StalkerEpgPreviewQueue({ fetchPrograms, onPrograms });

        queue.sync(['1']);
        expect(fetchPrograms).toHaveBeenCalledTimes(1);

        // Portal switch: the pending answer belongs to the old playlist.
        queue.reset();
        resolveFetch([buildProgram('1', 'Stale', -10)]);
        await flushQueue(50);

        expect(onPrograms).not.toHaveBeenCalled();
        expect(queue.getCachedPrograms('1')).toBeNull();
        queue.destroy();
    });
});

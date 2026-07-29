import { VodSourcePinService } from './vod-source-pin.service';

/**
 * The two listing methods differ in ONE way that matters: what a failed read
 * means. Backup depends on that difference — its `sourcePins` collection is
 * authoritative and restore clears the playlist's pins before applying it, so
 * a failure reported as "no pins" writes a backup that silently wipes them.
 */

const electronWindow = window as unknown as {
    electron?: Record<string, unknown>;
};

function withBridge(dbListVodSourcePins: unknown) {
    electronWindow.electron = {
        // `isAvailable` probes for this one.
        dbGetVodSourcePin: jest.fn(),
        dbListVodSourcePins,
    };
}

describe('VodSourcePinService listing', () => {
    let service: VodSourcePinService;
    let warn: jest.SpyInstance;

    beforeEach(() => {
        service = new VodSourcePinService();
        warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
        delete electronWindow.electron;
        warn.mockRestore();
    });

    it('returns the pins the bridge reports', async () => {
        const pin = {
            matchKey: 'tmdb:603',
            playlistId: 'p1',
            contentId: 501,
            portalType: 'xtream' as const,
        };
        withBridge(jest.fn().mockResolvedValue([pin]));

        await expect(service.listForPlaylist('p1')).resolves.toEqual([pin]);
        await expect(service.listForPlaylistOrThrow('p1')).resolves.toEqual([
            pin,
        ]);
    });

    it('reads a failure as "no pins" only for the lenient caller', async () => {
        withBridge(
            jest.fn().mockRejectedValue(new Error('database is locked'))
        );

        await expect(service.listForPlaylist('p1')).resolves.toEqual([]);
        // The whole point of the second method: backup must be able to tell a
        // failed read from an empty one, or it exports a wipe.
        await expect(service.listForPlaylistOrThrow('p1')).rejects.toThrow(
            'database is locked'
        );
    });

    it('reports no pins, without throwing, outside Electron', async () => {
        delete electronWindow.electron;

        // Not a failure — there is no pin store in the PWA at all, so an empty
        // list is the true answer and a backup built there is complete.
        await expect(service.listForPlaylistOrThrow('p1')).resolves.toEqual([]);
    });
});

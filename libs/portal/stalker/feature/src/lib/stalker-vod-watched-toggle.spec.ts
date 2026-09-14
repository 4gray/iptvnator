import { signal } from '@angular/core';
import type { MatSnackBar } from '@angular/material/snack-bar';
import type { TranslateService } from '@ngx-translate/core';
import type { PortalPlaybackPositions } from '@iptvnator/portal/shared/util';
import {
    PlaybackPositionData,
    createStalkerVodItem,
} from '@iptvnator/shared/interfaces';
import {
    StalkerVodWatchedOwner,
    createStalkerVodWatchedToggle,
} from './stalker-vod-watched-toggle';

describe('createStalkerVodWatchedToggle', () => {
    function setup(owner: StalkerVodWatchedOwner | null) {
        const ownerSignal = signal(owner);
        const position = signal<PlaybackPositionData | null>(null);
        const save = jest.fn().mockResolvedValue(undefined);
        const snackBar = { open: jest.fn() };
        const toggle = createStalkerVodWatchedToggle({
            owner: () => ownerSignal(),
            playbackPositions: {
                savePlaybackPositionOrThrow: save,
                clearPlaybackPositionOrThrow: jest
                    .fn()
                    .mockResolvedValue(undefined),
            } as unknown as PortalPlaybackPositions,
            position,
            applyPosition: (next) => position.set(next),
            playingNow: signal(false),
            positionReady: signal(true),
            snackBar: snackBar as unknown as MatSnackBar,
            translateService: {
                instant: (key: string) => key,
            } as unknown as TranslateService,
            logger: { error: jest.fn() } as never,
        });
        return { toggle, ownerSignal, position, save, snackBar };
    }

    const item = (id: string, playlistId = 'stalker-1') =>
        createStalkerVodItem(
            { id, cmd: `/media/${id}`, info: { name: 'Movie' } } as never,
            playlistId
        );

    it('toggles the item the host currently owns and announces it', async () => {
        const t = setup({ playlistId: 'stalker-1', vodId: 42 });

        await expect(t.toggle.toggleItem(item('42'))).resolves.toBe(true);

        expect(t.save).toHaveBeenCalledWith(
            'stalker-1',
            expect.objectContaining({ contentXtreamId: 42, contentType: 'vod' })
        );
        expect(t.toggle.isWatched()).toBe(true);
        expect(t.snackBar.open).toHaveBeenCalledWith(
            'XTREAM.MOVIE_MARKED_WATCHED',
            undefined,
            expect.anything()
        );
    });

    it('refuses an item that is not the owner on screen', async () => {
        const t = setup({ playlistId: 'stalker-1', vodId: 42 });

        // The input moved on to 42 while 41 is still rendered.
        await expect(t.toggle.toggleItem(item('41'))).resolves.toBe(false);
        // Same id from another playlist is a different row entirely.
        await expect(
            t.toggle.toggleItem(item('42', 'stalker-2'))
        ).resolves.toBe(false);
        t.ownerSignal.set(null);
        await expect(t.toggle.toggleItem(item('42'))).resolves.toBe(false);

        expect(t.save).not.toHaveBeenCalled();
    });

    it('does not patch the row after the owner changed mid-write', async () => {
        const t = setup({ playlistId: 'stalker-1', vodId: 42 });
        let release!: () => void;
        t.save.mockReturnValue(
            new Promise<void>((resolve) => {
                release = resolve;
            })
        );

        const pending = t.toggle.toggleItem(item('42'));
        t.ownerSignal.set({ playlistId: 'stalker-1', vodId: 43 });
        release();
        await expect(pending).resolves.toBe(true);

        expect(t.position()).toBeNull();
        expect(t.snackBar.open).not.toHaveBeenCalled();
    });
});

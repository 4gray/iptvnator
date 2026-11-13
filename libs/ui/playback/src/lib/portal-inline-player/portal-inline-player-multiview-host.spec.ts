import { signal } from '@angular/core';
import {
    type ResolvedPortalPlayback,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import { createPortalInlinePlayerMultiviewHost } from './portal-inline-player-multiview-host';

function episode(id: number): ResolvedPortalPlayback {
    return {
        streamUrl: `https://stream.example/series/${id}.mkv`,
        title: `Synthetic Episode ${id}`,
        isLive: false,
        contentInfo: {
            playlistId: 'playlist-1',
            contentXtreamId: id,
            contentType: 'episode',
        },
    };
}

describe('createPortalInlinePlayerMultiviewHost progress (R9)', () => {
    const playback = signal<ResolvedPortalPlayback | null>(episode(1));
    const persistPosition = jest.fn();
    const savePosition = jest.fn();
    const host = createPortalInlinePlayerMultiviewHost({
        playback,
        sessionKey: signal('episode-1'),
        isEpisode: () => true,
        engine: () => VideoPlayer.VideoJs,
        persistPosition,
        savePosition,
    });

    beforeEach(() => {
        playback.set(episode(1));
        persistPosition.mockClear();
        savePosition.mockClear();
    });

    it('saves through the page while the page shows the same title', () => {
        host.source()?.persistPosition?.({ currentTime: 30, duration: 1200 });

        expect(persistPosition).toHaveBeenCalledWith({
            currentTime: 30,
            duration: 1200,
        });
        expect(savePosition).not.toHaveBeenCalled();
    });

    it('keeps saving under its own title after the page moved on', () => {
        const tileSource = host.source();
        playback.set(episode(2));

        tileSource?.persistPosition?.({ currentTime: 40, duration: 1200 });

        expect(persistPosition).not.toHaveBeenCalled();
        expect(savePosition).toHaveBeenCalledWith(
            'playlist-1',
            expect.objectContaining({ contentXtreamId: 1, positionSeconds: 40 })
        );
    });
});

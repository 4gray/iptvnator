import { signal } from '@angular/core';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import {
    type ResolvedPortalPlayback,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import type { UnifiedLiveTimeshift } from './unified-live-catchup';
import { createUnifiedLiveMultiviewHost } from './unified-live-multiview-host';
import { buildLiveItem } from './unified-live-tab.spec-data';

const PLAYBACK: ResolvedPortalPlayback = {
    streamUrl: 'https://example.com/xtream.m3u8',
    title: 'Xtream Live',
    isLive: true,
};

function setup() {
    const tab = {
        inlinePlayback: signal<ResolvedPortalPlayback | null>(PLAYBACK),
        playbackSessionKey: signal('live|pl-2|20'),
        activeItem: signal<UnifiedCollectionItem | null>(
            buildLiveItem('xtream')
        ),
        activeTimeshift: signal<UnifiedLiveTimeshift | null>(null),
        isRadioSelection: signal(false),
        inlinePlayer: signal(VideoPlayer.ArtPlayer),
        items: signal<UnifiedCollectionItem[]>([buildLiveItem('xtream')]),
        onChannelSelected: jest.fn(async () => undefined),
    };
    return { tab, host: createUnifiedLiveMultiviewHost(tab) };
}

describe('createUnifiedLiveMultiviewHost', () => {
    it('describes the playing row by its collection uid', () => {
        const { host } = setup();

        expect(host.source()).toEqual({
            playback: PLAYBACK,
            playbackSessionKey: 'live|pl-2|20',
            kind: 'live',
            playlistId: 'pl-2',
            contentId: 'xtream::pl-2::20',
            title: 'Xtream Live',
        });
        expect(host.engine()).toBe(VideoPlayer.ArtPlayer);
    });

    it('treats catch-up as its own VOD source', () => {
        const { tab, host } = setup();
        tab.activeTimeshift.set({} as UnifiedLiveTimeshift);
        tab.inlinePlayback.set({
            ...PLAYBACK,
            streamUrl: 'https://example.com/timeshift/20.ts',
        });

        expect(host.source()).toMatchObject({
            kind: 'vod',
            contentId: undefined,
            playbackSessionKey:
                'live|pl-2|20|catchup:https://example.com/timeshift/20.ts',
        });
    });

    it('marks radio so it never becomes a tile', () => {
        const { tab, host } = setup();
        tab.isRadioSelection.set(true);

        expect(host.source()?.radio).toBe(true);
    });

    it('has no source without an active row', () => {
        const { tab, host } = setup();
        tab.activeItem.set(null);

        expect(host.source()).toBeNull();
    });

    it('ignores a survivor that is not a row of the list', () => {
        const { tab, host } = setup();
        host.adopt?.({
            ...(host.source() as NonNullable<ReturnType<typeof host.source>>),
            contentId: 'stalker::pl-3::30',
            id: 'tile-2',
            engine: VideoPlayer.Html5Player,
            status: 'playing',
            lastPosition: 0,
        });

        expect(tab.onChannelSelected).not.toHaveBeenCalled();
    });
});

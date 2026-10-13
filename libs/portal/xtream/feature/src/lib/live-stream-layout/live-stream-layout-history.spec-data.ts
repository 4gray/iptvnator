import { TestBed } from '@angular/core/testing';
import { PlaybackHistoryGate } from '@iptvnator/playback/data-access';
import { LiveStreamLayoutComponent } from './live-stream-layout.component';
import { playlist, sampleChannel } from './live-stream-layout-stubs.spec-data';

interface LiveHistoryContext {
    component: LiveStreamLayoutComponent;
    xtreamStore: {
        constructStreamUrl: jest.Mock<string, []>;
        addRecentItem: jest.Mock;
    };
    portalPlayer: { isEmbeddedPlayer: jest.Mock };
}

/** Collection-history cases share the main live host's component fixture. */
export function liveHistoryTestCases(context: () => LiveHistoryContext): void {
    it('records typed live history only after its own playback session confirms', () => {
        const { component, xtreamStore } = context();
        component.playLive(sampleChannel, true);
        const gate = TestBed.inject(PlaybackHistoryGate);
        expect(xtreamStore.addRecentItem).not.toHaveBeenCalled();
        gate.confirm({
            sessionKey: 'other-playlist',
            streamUrls: ['https://example.com/live.ts'],
        });
        expect(xtreamStore.addRecentItem).not.toHaveBeenCalled();
        gate.confirm({ sessionKey: component.playbackSessionKey() });
        expect(xtreamStore.addRecentItem).toHaveBeenCalledWith(
            expect.objectContaining({
                xtreamId: 101,
                contentType: 'live',
            })
        );
        expect(xtreamStore.addRecentItem.mock.calls[0][0].playlist()).toEqual(
            playlist
        );
    });

    it('records external live playback after URL confirmation', () => {
        const { component, xtreamStore, portalPlayer } = context();
        portalPlayer.isEmbeddedPlayer.mockReturnValue(false);
        component.playLive(sampleChannel, true);
        expect(xtreamStore.addRecentItem).not.toHaveBeenCalled();
        TestBed.inject(PlaybackHistoryGate).confirm({
            streamUrls: ['https://example.com/live.ts'],
        });
        expect(xtreamStore.addRecentItem).toHaveBeenCalledWith(
            expect.objectContaining({
                xtreamId: 101,
                contentType: 'live',
            })
        );
    });

    it('does not record a live start when no stream URL can be resolved', () => {
        const { component, xtreamStore } = context();
        xtreamStore.constructStreamUrl.mockReturnValueOnce('');
        component.playLive(sampleChannel, true);
        expect(xtreamStore.addRecentItem).not.toHaveBeenCalled();
    });

    it('does not record a live channel selected without starting playback', () => {
        const { component, xtreamStore } = context();
        component.playLive(sampleChannel, false);
        TestBed.inject(PlaybackHistoryGate).confirm({
            sessionKey: component.playbackSessionKey(),
        });
        expect(xtreamStore.addRecentItem).not.toHaveBeenCalled();
    });
}

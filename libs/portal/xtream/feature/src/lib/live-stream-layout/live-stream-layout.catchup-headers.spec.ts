import { TestBed } from '@angular/core/testing';
import { XtreamUrlService } from '@iptvnator/portal/xtream/data-access';
import { LiveStreamLayoutComponent } from './live-stream-layout.component';
import { setupLiveStreamLayoutNativeFixture } from './live-stream-layout-native.test-fixture';
import {
    epgItem,
    playlist,
    sampleChannel,
} from './live-stream-layout-stubs.spec-data';

/**
 * The archive is served by the same panel as the live stream, with the same
 * header requirements. Split from `live-stream-layout.component.spec.ts`,
 * which sits at the spec line cap.
 */
describe('LiveStreamLayoutComponent catch-up request headers', () => {
    const { emptyList, epgItems, restoreElectron, xtreamStore } =
        setupLiveStreamLayoutNativeFixture();
    const headers = {
        userAgent: 'SyntheticPlayer/1.0',
        referrer: 'http://referrer.example.test/',
        origin: 'http://origin.example.test',
    };

    afterEach(restoreElectron);

    it("plays an archived programme inline with the playlist's headers", async () => {
        const archiveChannel = { ...sampleChannel, category_id: 1 };
        emptyList.set([archiveChannel]);
        xtreamStore.selectedItem.set(archiveChannel);
        epgItems.set([epgItem('Synthetic Archive', 0, 1)]);
        xtreamStore.currentPlaylist.set({ ...playlist, ...headers });
        const fixture = TestBed.createComponent(LiveStreamLayoutComponent);
        const component = fixture.componentInstance;
        fixture.detectChanges();

        await component.onProgramActivated({
            type: 'timeshift',
            program: component.controlledEpgPrograms()[0],
        });

        expect(
            TestBed.inject(XtreamUrlService).resolveCatchupUrl
        ).toHaveBeenCalledWith(
            playlist.id,
            expect.objectContaining(headers),
            archiveChannel.xtream_id,
            expect.any(Number),
            expect.any(Number),
            undefined
        );
        expect(component.activePlayback()).toEqual(
            expect.objectContaining({
                streamUrl: 'https://example.com/timeshift.ts',
                isLive: false,
                userAgent: headers.userAgent,
                referer: headers.referrer,
                origin: headers.origin,
            })
        );
        fixture.destroy();
    });
});

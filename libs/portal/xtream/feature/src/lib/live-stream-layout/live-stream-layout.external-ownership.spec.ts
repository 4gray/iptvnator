import { TestBed } from '@angular/core/testing';
import { LiveStreamLayoutComponent } from './live-stream-layout.component';
import { setupLiveStreamLayoutNativeFixture } from './live-stream-layout-native.test-fixture';
import { playlist, sampleChannel } from './live-stream-layout-stubs.spec-data';
import { XtreamEpgGuideSourceService } from './xtream-epg-guide-source.service';

describe('LiveStreamLayoutComponent external playlist ownership', () => {
    const {
        emptyList,
        portalPlayer,
        publishExternalSession,
        restoreElectron,
        xtreamStore,
    } = setupLiveStreamLayoutNativeFixture();

    afterEach(restoreElectron);

    it('opens the selected channel when another playlist has the same stream ID pending', () => {
        const fixture = TestBed.createComponent(LiveStreamLayoutComponent);
        const component = fixture.componentInstance;
        portalPlayer.isEmbeddedPlayer.set(false);
        fixture.detectChanges();
        component.playLive(sampleChannel, true);
        publishExternalSession({
            id: 'synthetic-original',
            player: 'mpv',
            status: 'opened',
            title: 'Synthetic Channel',
            streamUrl: component.activeStreamUrl(),
            canClose: true,
            startedAt: '2026-04-04T10:00:00Z',
            updatedAt: '2026-04-04T10:00:00Z',
        });
        fixture.detectChanges();

        xtreamStore.currentPlaylist.set({ ...playlist, id: 'synthetic-other' });
        fixture.detectChanges();
        const other = { ...sampleChannel, xtream_id: 202, category_id: 1 };
        xtreamStore.openPlayer.mockReturnValueOnce(
            new Promise(() => undefined)
        );
        component.playLive(other, true);
        fixture.detectChanges();

        const local = { ...other, category_id: 2 };
        xtreamStore.currentPlaylist.set(playlist);
        xtreamStore.getCategoriesBySelectedType.update((categories) => [
            ...categories,
            { category_id: 2, category_name: 'Synthetic Group' },
        ]);
        emptyList.set([sampleChannel, local]);
        fixture.detectChanges();
        component.guide.open();
        fixture.detectChanges();
        expect(component.guide.isOpen()).toBe(true);
        const source = fixture.debugElement.injector.get(
            XtreamEpgGuideSourceService
        );
        source.setScope('all');
        source.activate(String(local.xtream_id));

        expect(xtreamStore.constructStreamUrl).toHaveBeenLastCalledWith(
            local,
            expect.any(Function)
        );
        expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(3);
    });
});

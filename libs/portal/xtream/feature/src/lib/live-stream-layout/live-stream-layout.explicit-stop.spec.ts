import { TestBed } from '@angular/core/testing';
import { LiveStreamLayoutComponent } from './live-stream-layout.component';
import { setupLiveStreamLayoutNativeFixture } from './live-stream-layout-native.test-fixture';
import { sampleChannel } from './live-stream-layout-stubs.spec-data';
import { XtreamEpgGuideSourceService } from './xtream-epg-guide-source.service';

describe('Xtream guide Stop during a detached handoff', () => {
    const {
        emptyList,
        portalPlayer,
        publishExternalSession,
        restoreElectron,
        stopRequested,
        xtreamStore,
    } = setupLiveStreamLayoutNativeFixture();

    afterEach(restoreElectron);

    it.each([false, true])(
        'cancels the waiting tune only for an explicit Stop (%s)',
        async (userStopped) => {
            const first = { ...sampleChannel, category_id: 1 };
            const second = { ...first, xtream_id: first.xtream_id + 1 };
            emptyList.set([first, second]);
            portalPlayer.isEmbeddedPlayer.set(false);
            const fixture = TestBed.createComponent(LiveStreamLayoutComponent);
            const component = fixture.componentInstance;
            fixture.detectChanges();
            component.playLive(first, true);
            const current = {
                id: 'synthetic-detached',
                player: 'mpv',
                status: 'playing',
                title: 'Synthetic Channel',
                streamUrl: component.activeStreamUrl(),
                canClose: true,
                reuseAvailable: false,
                startedAt: '2026-04-04T10:00:00Z',
                updatedAt: '2026-04-04T10:00:00Z',
            } as const;
            publishExternalSession(current);
            fixture.detectChanges();
            component.guide.open();
            fixture.detectChanges();
            let finish!: () => void;
            const stopping = new Promise<void>((resolve) => {
                finish = resolve;
            });
            const close = jest.fn(() => stopping);
            Object.defineProperty(
                window.electron,
                'closeExternalPlayerSession',
                { value: close, configurable: true }
            );
            const source = fixture.debugElement.injector.get(
                XtreamEpgGuideSourceService
            );
            xtreamStore.constructStreamUrl.mockReturnValueOnce(
                'https://example.test/synthetic-next.ts'
            );
            source.activate(String(second.xtream_id));
            expect(close).toHaveBeenCalledWith(current.id, true);
            expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(1);
            if (userStopped) stopRequested.next(current.id);
            publishExternalSession({
                ...current,
                status: 'closed',
                canClose: false,
                closedByRequest: true,
            });
            finish();
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            expect(xtreamStore.openPlayer).toHaveBeenCalledTimes(
                userStopped ? 1 : 2
            );
        }
    );
});

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SourceActivityService } from '@iptvnator/services';
import type { ExternalPlayerSession } from '@iptvnator/shared/interfaces';
import { LiveStreamLayoutComponent } from './live-stream-layout.component';
import { setupLiveStreamLayoutNativeFixture } from './live-stream-layout-native.test-fixture';
import { playlist, sampleChannel } from './live-stream-layout-stubs.spec-data';
import { XtreamExternalLiveSessions } from './xtream-external-live-sessions.service';

describe('Xtream live playback through a startup refresh', () => {
    const {
        closeSession,
        databaseService,
        parentalLock,
        portalPlayer,
        publishExternalSession,
        restoreElectron,
        runtime,
    } = setupLiveStreamLayoutNativeFixture();
    let fixture: ComponentFixture<LiveStreamLayoutComponent>;
    let component: LiveStreamLayoutComponent;
    const original = { ...sampleChannel, category_id: 1 };
    const refreshed = { ...original, category_id: 4 };

    beforeEach(() => {
        runtime.supportsXtreamSqliteDataSource = true;
        databaseService.getAllXtreamCategories
            .mockReset()
            .mockResolvedValue([{ id: 4, xtream_id: 600 }]);
        databaseService.getContentByXtreamId
            .mockReset()
            .mockResolvedValue(refreshed);
        fixture = TestBed.createComponent(LiveStreamLayoutComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    afterEach(() => {
        fixture.destroy();
        restoreElectron();
    });

    it.each([true, false])(
        'keeps the stream playing during a move, then applies the new category lock (inline: %s)',
        async (inline) => {
            portalPlayer.isEmbeddedPlayer.set(inline);
            component.playLive(original, true);
            const session: ExternalPlayerSession = {
                id: 'synthetic-playing-session',
                player: 'mpv',
                status: 'playing',
                title: 'Synthetic playing channel',
                streamUrl: component.activeStreamUrl(),
                canClose: true,
                startedAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-01-01T00:00:00Z',
            };
            if (!inline) publishExternalSession(session);
            fixture.detectChanges();
            const external = TestBed.inject(XtreamExternalLiveSessions);
            if (!inline)
                expect(external.state(session.id)?.source.categoryId).toBe(1);
            const playing = component.activePlayback();
            expect(playing).not.toBeNull();

            TestBed.inject(SourceActivityService).notifyLiveCatalogReplacement(
                playlist.id
            );
            await new Promise((resolve) => setTimeout(resolve, 0));
            fixture.detectChanges();
            expect(component.activePlayback()).toBe(playing);
            if (!inline)
                expect(external.state(session.id)?.source.categoryId).toBe(600);

            parentalLock.isXtreamCategoryLocked.mockImplementation(
                (_source, _type, category) => category === 600
            );
            parentalLock.active.set(true);
            parentalLock.version.update((version) => version + 1);
            fixture.detectChanges();

            if (inline) expect(component.activePlayback()).toBeNull();
            if (!inline)
                expect(closeSession).toHaveBeenCalledWith(
                    expect.objectContaining(session)
                );
        }
    );

    it('stops playing when the refreshed channel is already locked', async () => {
        parentalLock.isXtreamCategoryLocked.mockImplementation(
            (_source, _type, category) => category === 600
        );
        parentalLock.active.set(true);
        component.playLive(original, true);
        fixture.detectChanges();
        expect(component.activePlayback()).not.toBeNull();

        TestBed.inject(SourceActivityService).notifyLiveCatalogReplacement(
            playlist.id
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        fixture.detectChanges();

        expect(component.activePlayback()).toBeNull();
    });

    it('discards a refresh result after the viewer tunes another channel', async () => {
        let finish!: (row: typeof refreshed) => void;
        databaseService.getContentByXtreamId.mockReturnValueOnce(
            new Promise((resolve) => {
                finish = resolve;
            })
        );
        component.playLive(original, true);
        fixture.detectChanges();
        const activity = TestBed.inject(SourceActivityService);
        activity.notifyLiveCatalogReplacement('unrelated-source');
        expect(databaseService.getContentByXtreamId).not.toHaveBeenCalled();
        activity.notifyLiveCatalogReplacement(playlist.id);
        expect(databaseService.getContentByXtreamId).toHaveBeenCalledTimes(1);

        component.playLive({ ...original, xtream_id: 202 }, true);
        fixture.detectChanges();
        const playing = component.activePlayback();
        finish(refreshed);
        await new Promise((resolve) => setTimeout(resolve, 0));

        parentalLock.isXtreamCategoryLocked.mockImplementation(
            (_source, _type, category) => category === 600
        );
        parentalLock.active.set(true);
        parentalLock.version.update((version) => version + 1);
        fixture.detectChanges();
        expect(playing).not.toBeNull();
        expect(component.activePlayback()).toBe(playing);
    });
});

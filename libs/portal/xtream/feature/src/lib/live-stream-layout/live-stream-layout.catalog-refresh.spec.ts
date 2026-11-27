import { ComponentFixture, TestBed } from '@angular/core/testing';
import { XtreamUrlService } from '@iptvnator/portal/xtream/data-access';
import { SourceActivityService } from '@iptvnator/services';
import type { ExternalPlayerSession } from '@iptvnator/shared/interfaces';
import { LiveStreamLayoutComponent } from './live-stream-layout.component';
import { setupLiveStreamLayoutNativeFixture } from './live-stream-layout-native.test-fixture';
import {
    epgItem,
    playlist,
    sampleChannel,
} from './live-stream-layout-stubs.spec-data';
import { XtreamExternalLiveSessions } from './xtream-external-live-sessions.service';

describe('Xtream live playback through a startup refresh', () => {
    const {
        closeSession,
        databaseService,
        epgItems,
        parentalLock,
        portalPlayer,
        publishExternalSession,
        restoreElectron,
        runtime,
        xtreamStore,
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
        const next = { ...original, xtream_id: 202 };
        databaseService.getContentByXtreamId
            .mockReturnValueOnce(
                new Promise((resolve) => {
                    finish = resolve;
                })
            )
            .mockResolvedValueOnce(next);
        databaseService.getAllXtreamCategories.mockResolvedValue([
            { id: 1, xtream_id: 1 },
            { id: 4, xtream_id: 600 },
        ]);
        component.playLive(original, true);
        fixture.detectChanges();
        const activity = TestBed.inject(SourceActivityService);
        activity.notifyLiveCatalogReplacement('unrelated-source');
        expect(databaseService.getContentByXtreamId).not.toHaveBeenCalled();
        activity.notifyLiveCatalogReplacement(playlist.id);
        expect(databaseService.getContentByXtreamId).toHaveBeenCalledTimes(1);

        component.playLive(next, true);
        await new Promise((resolve) => setTimeout(resolve, 0));
        fixture.detectChanges();
        const playing = component.activePlayback();
        expect(playing?.catalogIdentity?.id).toBe(next.xtream_id);
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

    it('revalidates a cached tune while the previous channel is being rebound', async () => {
        const next = {
            ...original,
            xtream_id: 202,
            title: 'Synthetic next channel',
        };
        let finish!: (row: typeof original) => void;
        databaseService.getContentByXtreamId
            .mockReturnValueOnce(
                new Promise((resolve) => {
                    finish = resolve;
                })
            )
            .mockResolvedValueOnce({ ...next, category_id: 4 });
        databaseService.getAllXtreamCategories.mockResolvedValue([
            { id: 1, xtream_id: 1 },
            { id: 4, xtream_id: 600 },
        ]);
        component.playLive(original, true);
        fixture.detectChanges();

        TestBed.inject(SourceActivityService).notifyLiveCatalogReplacement(
            playlist.id
        );
        component.playLive(next, true);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(component.activePlayback()?.title).toBe(next.title);
        finish(original);
        await fixture.whenStable();

        parentalLock.isXtreamCategoryLocked.mockImplementation(
            (_source, _type, category) => category === 600
        );
        parentalLock.active.set(true);
        parentalLock.version.update((version) => version + 1);
        fixture.detectChanges();
        expect(component.activePlayback()).toBeNull();
    });

    it('withholds a cached tune moved to a locked category even before any channel is playing', async () => {
        parentalLock.isXtreamCategoryLocked.mockImplementation(
            (_source, _type, category) => category === 600
        );
        parentalLock.active.set(true);
        TestBed.inject(SourceActivityService).notifyLiveCatalogReplacement(
            playlist.id
        );
        const confirmed = jest.fn();

        component.playLive(original, true, undefined, false, confirmed);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(component.activePlayback()).toBeNull();
        expect(confirmed).not.toHaveBeenCalled();
    });

    it('keeps an open stream but rejects a cached tune removed by the refresh', async () => {
        const removed = { ...original, xtream_id: 203 };
        databaseService.getContentByXtreamId.mockResolvedValue(null);
        component.playLive(original, true);
        const playing = component.activePlayback();
        expect(playing).not.toBeNull();

        TestBed.inject(SourceActivityService).notifyLiveCatalogReplacement(
            playlist.id
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(component.activePlayback()).toBe(playing);

        const confirmed = jest.fn();
        component.playLive(removed, true, undefined, false, confirmed);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(component.activePlayback()).toBe(playing);
        expect(confirmed).not.toHaveBeenCalled();
    });

    it('withholds a stale archive selection whose channel moved to a locked category', async () => {
        xtreamStore.selectedItem.set(original);
        epgItems.set([epgItem('Synthetic archived program', 0, 1)]);
        parentalLock.isXtreamCategoryLocked.mockImplementation(
            (_source, _type, category) => category === 600
        );
        parentalLock.active.set(true);
        TestBed.inject(SourceActivityService).notifyLiveCatalogReplacement(
            playlist.id
        );

        await component.onProgramActivated({
            type: 'timeshift',
            program: component.controlledEpgPrograms()[0],
        });

        expect(
            TestBed.inject(XtreamUrlService).resolveCatchupUrl
        ).not.toHaveBeenCalled();
        expect(component.activePlayback()).toBeNull();
    });

    it('drops an archive request if its catalog changes while resolving the URL', async () => {
        xtreamStore.selectedItem.set(original);
        epgItems.set([epgItem('Synthetic archived program', 0, 1)]);
        const resolveUrl = jest.mocked(
            TestBed.inject(XtreamUrlService).resolveCatchupUrl
        );
        let finish!: (url: string) => void;
        resolveUrl.mockReturnValueOnce(
            new Promise((resolve) => {
                finish = resolve;
            })
        );
        const opening = component.onProgramActivated({
            type: 'timeshift',
            program: component.controlledEpgPrograms()[0],
        });
        expect(resolveUrl).toHaveBeenCalled();
        TestBed.inject(SourceActivityService).notifyLiveCatalogReplacement(
            playlist.id
        );
        finish('https://media.example.test/archived-program.ts');
        await opening;

        expect(component.activePlayback()).toBeNull();
    });

    it.each([true, false])(
        'confirms a pending external launch after its category is refreshed (session registered: %s)',
        async (registered) => {
            portalPlayer.isEmbeddedPlayer.set(false);
            const confirmed = jest.fn();
            let finish!: (session: ExternalPlayerSession) => void;
            xtreamStore.openPlayer.mockReturnValueOnce(
                new Promise((resolve) => {
                    finish = resolve;
                })
            );
            component.playLive(original, true, undefined, false, confirmed);
            const opening: ExternalPlayerSession = {
                id: 'synthetic-opening-session',
                streamUrl: component.activeStreamUrl(),
                title: 'Synthetic channel',
                player: 'mpv',
                status: 'launching',
                canClose: false,
                startedAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-01-01T00:00:00Z',
            };
            if (registered) publishExternalSession(opening);
            fixture.detectChanges();
            TestBed.inject(SourceActivityService).notifyLiveCatalogReplacement(
                playlist.id
            );
            await new Promise((resolve) => setTimeout(resolve, 0));
            fixture.detectChanges();
            expect(confirmed).not.toHaveBeenCalled();

            const playing = {
                ...opening,
                status: 'playing' as const,
                canClose: true,
            };
            publishExternalSession(playing);
            fixture.detectChanges();
            expect(
                TestBed.inject(XtreamExternalLiveSessions).state(opening.id)
                    ?.source.categoryId
            ).toBe(600);
            finish(playing);
            await fixture.whenStable();
            expect(confirmed).toHaveBeenCalledTimes(1);
        }
    );
});

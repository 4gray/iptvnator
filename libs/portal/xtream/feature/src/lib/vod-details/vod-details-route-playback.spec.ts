import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VideoPlayer } from '@iptvnator/shared/interfaces';
import { VodDetailsPlaybackService } from './vod-details-playback.service';
import { VodDetailsRouteComponent } from './vod-details-route.component';
import {
    configureVodDetailsRouteTestBed,
    createVodDetailsRouteStubs,
    resetVodDetailsRouteStubs,
    silenceRouteLogging,
} from './vod-details-route.harness';

/**
 * What the primary button and the resume point do, as opposed to what the
 * page renders. Split from the rendering spec to keep both inside the
 * repository's file-size rule.
 */
describe('VodDetailsRouteComponent — playback actions', () => {
    let fixture: ComponentFixture<VodDetailsRouteComponent>;
    let restoreLogging: (() => void) | undefined;
    const stubs = createVodDetailsRouteStubs();
    const {
        currentPlaylist,
        activeSession,
        addRecentItem,
        closeSession,
        getPlaybackPosition,
        selectedItem,
        selectedPlayer,
        snackBarOpen,
        updateSettings,
    } = stubs;

    beforeEach(async () => {
        restoreLogging = silenceRouteLogging();
        resetVodDetailsRouteStubs(stubs);
        await configureVodDetailsRouteTestBed(stubs);

        fixture = TestBed.createComponent(VodDetailsRouteComponent);
    });

    afterEach(() => {
        restoreLogging?.();
    });

    /**
     * Stand in for a discovered source list.
     *
     * The real one comes from a worker-backed discovery the route spec cannot
     * reach, and every test here only needs "this row is the active one".
     */
    function withActiveSource(playlistId: string, contentId: number): void {
        Object.defineProperty(
            fixture.componentInstance.multiSource,
            'sources',
            {
                configurable: true,
                value: () => [
                    {
                        id: `${playlistId}:xtream:${contentId}`,
                        playlistId,
                        playlistName: 'Portal One',
                        portalType: 'xtream',
                        contentId,
                        rawTitle: 'Example',
                        matchConfidence: 'exact',
                        year: null,
                        isActive: true,
                        isPinned: false,
                        isTried: true,
                        probe: { status: 'idle' },
                    },
                ],
            }
        );
    }

    it('owns an external session for a copy in its own playlist', () => {
        currentPlaylist.set({ id: 'playlist-1' });
        const component = fixture.componentInstance;
        const playback = fixture.debugElement.injector.get(
            VodDetailsPlaybackService
        );

        // A pinned copy can now live in the route's OWN playlist. Comparing
        // playlists alone would call this "the route source", and the page
        // would disown the session it started for it.
        withActiveSource('playlist-1', 4242);
        activeSession.set({
            player: 'mpv',
            status: 'playing',
            contentInfo: {
                playlistId: 'playlist-1',
                contentXtreamId: 4242,
                contentType: 'vod',
            },
        });

        expect(playback.matchedExternalPlayback()).not.toBeNull();
        expect(component.isExternalStopAction()).toBe(true);
    });

    it('drops the carried position when Restart starts from the beginning', () => {
        const component = fixture.componentInstance;
        const reported = jest.spyOn(component.multiSource, 'reportPosition');

        component.playVod({} as XtreamVodDetails);

        // The controller still holds whatever this page was seeded with, and
        // a failure before the first timeupdate would resolve the next source
        // back at it instead of honouring the restart.
        expect(reported).toHaveBeenCalledWith(0);
    });

    it('stops the external player when the button says Stop', async () => {
        currentPlaylist.set({ id: 'playlist-1' });
        activeSession.set({
            player: 'mpv',
            status: 'playing',
            contentInfo: {
                playlistId: 'playlist-1',
                contentXtreamId: 650020,
                contentType: 'vod',
            },
        });

        const component = fixture.componentInstance;
        const playPinned = jest.spyOn(
            component.multiSource,
            'playPinnedSource'
        );
        expect(component.isExternalStopAction()).toBe(true);

        await component.onPrimaryAction({} as XtreamVodDetails);

        // Consulting the pin first would launch a second player while the
        // first keeps running — the control doing the opposite of its label.
        expect(playPinned).not.toHaveBeenCalled();
        expect(closeSession).toHaveBeenCalled();
    });

    it('follows external playback progress, which has no timeupdate', () => {
        const component = fixture.componentInstance;
        const playback = fixture.debugElement.injector.get(
            VodDetailsPlaybackService
        );
        const reported = jest.spyOn(component.multiSource, 'reportPosition');

        // MPV/VLC report only through the polled position, so this IS their
        // live timecode. Treating it as a one-shot seed would freeze the
        // resume point at the start and rewind a later source switch by
        // however long the user had been watching.
        playback.vodPlaybackPosition.set({
            playlistId: 'playlist-1',
            contentXtreamId: 650020,
            contentType: 'vod',
            positionSeconds: 120,
            durationSeconds: 7744,
        });
        fixture.detectChanges();
        expect(reported).toHaveBeenLastCalledWith(120);

        playback.vodPlaybackPosition.set({
            playlistId: 'playlist-1',
            contentXtreamId: 650020,
            contentType: 'vod',
            positionSeconds: 3600,
            durationSeconds: 7744,
        });
        fixture.detectChanges();
        expect(reported).toHaveBeenLastCalledWith(3600);
    });

    it('holds the resume point until the engine has seeked to it', () => {
        const component = fixture.componentInstance;
        const playback = fixture.debugElement.injector.get(
            VodDetailsPlaybackService
        );
        playback.inlinePlayback.set({
            streamUrl: 'http://example.com/movie/650020.mp4',
            title: 'City of McFarland',
            startTime: 2538,
            contentInfo: {
                playlistId: 'playlist-1',
                contentXtreamId: 650020,
                contentType: 'vod',
            },
        });
        const reported = jest.spyOn(component.multiSource, 'reportPosition');

        // A resuming engine emits timeupdates at ~0 on its way to 2538. That
        // is not where the film is, and multi-source must not switch or fail
        // over back to the beginning because of it.
        component.handleInlineTimeUpdate({ currentTime: 0.2, duration: 7744 });
        expect(reported).toHaveBeenLastCalledWith(2538);

        component.handleInlineTimeUpdate({ currentTime: 2540, duration: 7744 });
        expect(reported).toHaveBeenLastCalledWith(2540);

        // One-shot latch, not a filter: a deliberate seek backwards counts.
        component.handleInlineTimeUpdate({ currentTime: 12, duration: 7744 });
        expect(reported).toHaveBeenLastCalledWith(12);
    });

    it('drops the previous movie’s resume point on a reused route', () => {
        currentPlaylist.set({ id: 'playlist-1' });
        const playback = fixture.debugElement.injector.get(
            VodDetailsPlaybackService
        );
        fixture.detectChanges();
        playback.routePlaybackPosition.set({
            playlistId: 'playlist-1',
            contentXtreamId: 650020,
            contentType: 'vod',
            positionSeconds: 2538,
            durationSeconds: 7744,
        });

        // The Similar rail reuses this component. Until the new lookup lands
        // the button would offer the PREVIOUS movie's "Resume 42:18" — and
        // start the new stream there.
        currentPlaylist.set({ id: 'playlist-2' });
        fixture.detectChanges();

        expect(playback.routePlaybackPosition()).toBeNull();
        expect(playback.hasPlaybackPosition()).toBe(false);
    });

    it('downloads the movie the route currently shows', async () => {
        currentPlaylist.set({ id: 'playlist-1' });
        fixture.detectChanges();

        await fixture.componentInstance.downloadVod({
            // A DIFFERENT id in the payload: the route's id must win.
            movie_data: {
                stream_id: 111,
                name: 'Example',
                container_extension: 'mp4',
            },
        } as never);

        // The id comes from the route params SIGNAL, not `snapshot.params`:
        // the router reuses this component for detail-to-detail navigation
        // (the Similar rail), and the snapshot still names the film the user
        // came from — so the download would fetch the wrong movie.
        expect(stubs.startDownload).toHaveBeenCalledWith(
            expect.objectContaining({ xtreamId: 650020 })
        );
    });

    it('replaces an alternative’s timecode when Resume starts the route copy', async () => {
        currentPlaylist.set({ id: 'playlist-1' });
        const component = fixture.componentInstance;
        const playback = fixture.debugElement.injector.get(
            VodDetailsPlaybackService
        );
        withActiveSource('playlist-1', 650020);
        playback.routePlaybackPosition.set({
            playlistId: 'playlist-1',
            contentXtreamId: 650020,
            contentType: 'vod',
            positionSeconds: 120,
            durationSeconds: 7744,
        });
        const reported = jest.spyOn(component.multiSource, 'reportPosition');

        // An alternative left its own timecode in the controller. Resuming the
        // ROUTE copy has to overwrite it, or a failure before the first
        // timeupdate resolves the next source at a position from another copy.
        component.multiSource.reportPosition(4200);
        component.resumeVod({
            movie_data: {
                stream_id: 650020,
                name: 'Example',
                container_extension: 'mp4',
            },
        } as never);

        expect(reported).toHaveBeenLastCalledWith(120);
    });

    it('does not start the route source when a newer action owns the screen', async () => {
        currentPlaylist.set({ id: 'playlist-1' });
        const component = fixture.componentInstance;
        withActiveSource('playlist-1', 650020);
        // Double-clicking Play while the pin is resolving: the second click
        // supersedes the first, and the first must not conclude "no usable
        // pin" and start the route source over what the second just began.
        jest.spyOn(component.multiSource, 'playPinnedSource').mockResolvedValue(
            'superseded'
        );
        const reported = jest.spyOn(component.multiSource, 'reportPosition');

        await component.onPrimaryAction({
            movie_data: {
                stream_id: 650020,
                name: 'Example',
                container_extension: 'mp4',
            },
        } as never);

        expect(reported).not.toHaveBeenCalled();
    });

    it('takes the route wrappers when the primary button falls through', () => {
        currentPlaylist.set({ id: 'playlist-1' });
        const component = fixture.componentInstance;
        withActiveSource('playlist-1', 650020);
        jest.spyOn(component.multiSource, 'playPinnedSource').mockResolvedValue(
            'unavailable'
        );
        const reported = jest.spyOn(component.multiSource, 'reportPosition');

        // Reaching the service directly would skip the bookkeeping a route
        // start needs — the controller would keep an alternative's timecode.
        void component.onPrimaryAction({
            movie_data: {
                stream_id: 650020,
                name: 'Example',
                container_extension: 'mp4',
            },
        } as never);

        return Promise.resolve().then(() => {
            expect(reported).toHaveBeenCalledWith(0);
        });
    });

    it('offers no resume point for a pinned copy watched through', async () => {
        const component = fixture.componentInstance;
        const resumeSecondsFor = component['msUi'].resumeSecondsFor;

        getPlaybackPosition.mockResolvedValue({
            playlistId: 'playlist-2',
            contentXtreamId: 991,
            contentType: 'vod',
            positionSeconds: 6900,
            durationSeconds: 7200,
        });

        // The button reads Play at 95%, so the start must mean zero — not a
        // seek back to where the film ended.
        await expect(
            resumeSecondsFor({
                playlistId: 'playlist-2',
                contentId: 991,
            } as never)
        ).resolves.toBeNull();
    });

    it('still resumes a pinned copy left mid-film', async () => {
        const component = fixture.componentInstance;

        getPlaybackPosition.mockResolvedValue({
            playlistId: 'playlist-2',
            contentXtreamId: 991,
            contentType: 'vod',
            positionSeconds: 2538,
            durationSeconds: 7200,
        });

        await expect(
            component['msUi'].resumeSecondsFor({
                playlistId: 'playlist-2',
                contentId: 991,
            } as never)
        ).resolves.toBe(2538);
    });

    it('restarts the pinned copy, not the route copy', async () => {
        currentPlaylist.set({ id: 'playlist-1' });
        const component = fixture.componentInstance;
        withActiveSource('playlist-1', 650020);
        // Resume honours the pin, so the Restart beside it must too —
        // otherwise the button quietly switches the user's playlist.
        Object.defineProperty(component['msUi'], 'primaryIsPinnedCopy', {
            configurable: true,
            value: () => true,
        });
        const pinnedPlay = jest
            .spyOn(component.multiSource, 'playPinnedSource')
            .mockResolvedValue('played');

        await component.restartVod({
            movie_data: {
                stream_id: 650020,
                name: 'Example',
                container_extension: 'mp4',
            },
        } as never);

        expect(pinnedPlay).toHaveBeenCalled();
        // Restart means zero, whichever copy it starts.
        const resumeFor = pinnedPlay.mock.calls[0][0];
        await expect(resumeFor?.({} as never)).resolves.toBe(0);
    });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VodDetailsPlaybackService } from './vod-details-playback.service';
import { VodDetailsRouteComponent } from './vod-details-route.component';
import {
    configureVodDetailsRouteTestBed,
    createVodDetailsRouteStubs,
    resetVodDetailsRouteStubs,
    silenceRouteLogging,
} from './vod-details-route.harness';

/**
 * What the page CLAIMS is playing.
 *
 * "Playing from ..." is a statement of fact about the stream on screen, and
 * discovery marks a source active long before one exists — so the line has to
 * be gated on playback rather than on selection.
 */
describe('VodDetailsRouteComponent — source caption', () => {
    let fixture: ComponentFixture<VodDetailsRouteComponent>;
    let restoreLogging: (() => void) | undefined;
    const stubs = createVodDetailsRouteStubs();
    const {
        activeSession,
        addRecentItem,
        checkFavoriteStatus,
        closeSession,
        constructVodStreamUrl,
        currentPlaylist,
        detailsError,
        fetchVodDetailsWithMetadata,
        getPlaybackPosition,
        isFavorite,
        isLoadingDetails,
        selectedItem,
        setSelectedItem,
        toggleFavorite,
        vodCategories,
        vodStreams,
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

    it('claims to be playing only while something is', () => {
        currentPlaylist.set({ id: 'playlist-1' });
        const component = fixture.componentInstance;
        const playback = fixture.debugElement.injector.get(
            VodDetailsPlaybackService
        );
        withActiveSource('playlist-1', 650020);

        // Discovery marks a source active as soon as the page opens, so the
        // caption would otherwise say "Playing from ..." before Play is
        // pressed — and again after the player is closed.
        expect(component.activeSourceCaption()).toBeNull();

        playback.inlinePlayback.set({
            streamUrl: 'http://example.com/movie.mkv',
            title: 'Example',
        });
        expect(component.activeSourceCaption()).not.toBeNull();

        playback.inlinePlayback.set(null);
        expect(component.activeSourceCaption()).toBeNull();
    });

    it('stops claiming playback once the error screen is up', async () => {
        currentPlaylist.set({ id: 'playlist-1' });
        const component = fixture.componentInstance;
        const playback = fixture.debugElement.injector.get(
            VodDetailsPlaybackService
        );
        withActiveSource('playlist-1', 650020);
        playback.inlinePlayback.set({
            streamUrl: 'http://example.com/movie.mkv',
            title: 'Example',
        });
        expect(component.activeSourceCaption()).not.toBeNull();

        // The host stays mounted through a failure, so the caption would go on
        // naming a source while the diagnostic says it could not be played.
        await component.onPlaybackFailed();
        expect(component.activeSourceCaption()).toBeNull();

        // And comes back when the engine produces time again.
        component.handleInlineTimeUpdate({ currentTime: 3, duration: 90 });
        expect(component.activeSourceCaption()).not.toBeNull();
    });

    it('keeps the failure state when the chosen source will not resolve', async () => {
        currentPlaylist.set({ id: 'playlist-1' });
        const component = fixture.componentInstance;
        const playback = fixture.debugElement.injector.get(
            VodDetailsPlaybackService
        );
        withActiveSource('playlist-1', 650020);
        playback.inlinePlayback.set({
            streamUrl: 'http://example.com/movie.mkv',
            title: 'Example',
        });
        await component.onPlaybackFailed();
        expect(component.activeSourceCaption()).toBeNull();

        // Picking an alternative off the error screen that cannot be resolved
        // leaves the diagnostic up — so the caption must stay away too.
        jest.spyOn(component.multiSource, 'play').mockResolvedValue(false);
        component.playFromSource('playlist-2:xtream:991');
        await Promise.resolve();
        await Promise.resolve();

        expect(component.activeSourceCaption()).toBeNull();
    });
});

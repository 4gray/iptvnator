import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import { PlaylistsService } from '@iptvnator/services';
import { type Channel, type Playlist } from '@iptvnator/shared/interfaces';
import {
    RENDERER_PERFORMANCE_PHASE_HOOK_KEY,
    type RendererPerformancePhaseEvent,
} from '@iptvnator/shared/logging';
import { of, Subject } from 'rxjs';
import { M3uWorkspaceRouteSession } from './m3u-workspace-route-session.service';

const PLAYLIST_ID = 'performance-playlist';
const PRIMARY_CHANNEL = {
    id: 'channel-1',
    name: 'Sensitive channel',
    url: 'https://stream-secret.example.test/1',
} as Channel;
const NEXT_CHANNEL = {
    id: 'channel-2',
    name: 'Next sensitive channel',
    url: 'https://stream-secret.example.test/2',
} as Channel;

async function flushEffects(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

describe('M3uWorkspaceRouteSession performance phases', () => {
    const hookSymbol = Symbol.for(RENDERER_PERFORMANCE_PHASE_HOOK_KEY);
    const store = { dispatch: jest.fn() };

    beforeEach(() => {
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: { setUserAgent: jest.fn().mockResolvedValue(true) },
        });
        store.dispatch.mockReset();
        TestBed.configureTestingModule({
            providers: [
                M3uWorkspaceRouteSession,
                {
                    provide: PlaylistContextFacade,
                    useValue: {
                        syncFromUrl: jest.fn(() => ({
                            inWorkspace: true,
                            playlistId: PLAYLIST_ID,
                            provider: 'playlists',
                            section: 'all',
                        })),
                    },
                },
                {
                    provide: PlaylistsService,
                    useValue: {
                        getPlaylist: jest.fn(() =>
                            of({
                                playlist: {
                                    items: [PRIMARY_CHANNEL, NEXT_CHANNEL],
                                },
                                title: 'Sensitive title',
                                url: 'https://user:secret@example.test/list.m3u',
                            } as Playlist)
                        ),
                    },
                },
                {
                    provide: Router,
                    useValue: {
                        events: new Subject().asObservable(),
                        url: `/workspace/playlists/${PLAYLIST_ID}/all`,
                    },
                },
                { provide: Store, useValue: store },
            ],
        });
    });

    afterEach(() => {
        delete (globalThis as unknown as Record<symbol, unknown>)[hookSymbol];
        delete (window as unknown as { electron?: unknown }).electron;
    });

    it('marks channel publication with only the imported item count', async () => {
        const events: RendererPerformancePhaseEvent[] = [];
        (
            globalThis as unknown as Record<
                symbol,
                (event: RendererPerformancePhaseEvent) => void
            >
        )[hookSymbol] = (event) => events.push(event);

        TestBed.inject(M3uWorkspaceRouteSession);
        await flushEffects();

        expect(
            events.map(({ boundary, metadata, outcome, phase }) => ({
                boundary,
                metadata,
                outcome,
                phase,
            }))
        ).toEqual([
            {
                boundary: 'start',
                metadata: { items: 2 },
                outcome: undefined,
                phase: 'store.m3u-publish-channels',
            },
            {
                boundary: 'end',
                metadata: { items: 2 },
                outcome: 'success',
                phase: 'store.m3u-publish-channels',
            },
        ]);
        expect(JSON.stringify(events)).not.toContain('Sensitive');
        expect(JSON.stringify(events)).not.toContain('secret');
        expect(JSON.stringify(events)).not.toContain(PRIMARY_CHANNEL.url);
    });
});

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import {
    PlaylistActions,
    selectActivePlaylistId,
    selectAllPlaylistsMeta,
    selectPlaylistsLoadingFlag,
} from '@iptvnator/m3u-state';
import { Subject } from 'rxjs';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import {
    PlaylistContextFacade,
    PlaylistRouteContext,
} from './playlist-context.facade';

const LAST_SECTION_STORAGE_KEY = 'playlist-switcher:last-sections:v2';

function createPlaylist(
    overrides: Partial<PlaylistMeta> & { _id: string }
): PlaylistMeta {
    return {
        _id: overrides._id,
        title: overrides.title ?? overrides.filename ?? overrides._id,
        count: overrides.count ?? 0,
        importDate:
            overrides.importDate ?? new Date('2026-04-05T10:00:00.000Z').toISOString(),
        autoRefresh: overrides.autoRefresh ?? false,
        ...overrides,
    } as PlaylistMeta;
}

describe('PlaylistContextFacade', () => {
    let facade: PlaylistContextFacade;
    let routerEvents: Subject<NavigationEnd>;
    let router: {
        url: string;
        events: ReturnType<Subject<NavigationEnd>['asObservable']>;
        navigate: jest.Mock;
    };
    let dispatch: jest.Mock;
    let playlistsSignal: ReturnType<typeof signal<PlaylistMeta[]>>;
    let loadedSignal: ReturnType<typeof signal<boolean>>;
    let activePlaylistIdSignal: ReturnType<typeof signal<string | null>>;
    let originalElectron: unknown;

    const xtreamA = createPlaylist({
        _id: 'xtream-a',
        password: 'secret',
        serverUrl: 'http://127.0.0.1:3211',
        title: 'Xtream A',
        username: 'user-a',
    });
    const xtreamB = createPlaylist({
        _id: 'xtream-b',
        password: 'secret',
        serverUrl: 'http://127.0.0.1:3211',
        title: 'Xtream B',
        username: 'user-b',
    });
    const stalkerA = createPlaylist({
        _id: 'stalker-a',
        macAddress: '00:1A:79:00:00:01',
        portalUrl: 'http://127.0.0.1:3210/portal.php',
        title: 'Stalker A',
    });
    const stalkerB = createPlaylist({
        _id: 'stalker-b',
        macAddress: '00:1A:79:00:00:02',
        portalUrl: 'http://127.0.0.1:3210/portal.php',
        title: 'Stalker B',
    });
    const m3uA = createPlaylist({
        _id: 'm3u-a',
        title: 'M3U A',
        url: 'http://example.test/a.m3u',
    });
    const m3uB = createPlaylist({
        _id: 'm3u-b',
        title: 'M3U B',
        url: 'http://example.test/b.m3u',
    });

    function setElectronAvailability(enabled: boolean): void {
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: enabled ? {} : undefined,
        });
    }

    function instantiateFacade(): PlaylistContextFacade {
        facade = TestBed.inject(PlaylistContextFacade);
        dispatch.mockClear();
        router.navigate.mockClear();
        return facade;
    }

    beforeEach(() => {
        localStorage.clear();
        originalElectron = (window as Window & { electron?: unknown }).electron;

        routerEvents = new Subject<NavigationEnd>();
        router = {
            url: '/workspace/xtreams/xtream-a/live',
            events: routerEvents.asObservable(),
            navigate: jest.fn().mockResolvedValue(true),
        };
        dispatch = jest.fn((action: unknown) => action);
        playlistsSignal = signal([
            xtreamA,
            xtreamB,
            stalkerA,
            stalkerB,
            m3uA,
            m3uB,
        ]);
        loadedSignal = signal(true);
        activePlaylistIdSignal = signal<string | null>(xtreamA._id);
        setElectronAvailability(true);

        TestBed.configureTestingModule({
            providers: [
                PlaylistContextFacade,
                {
                    provide: Router,
                    useValue: router,
                },
                {
                    provide: Store,
                    useValue: {
                        dispatch,
                        selectSignal: jest.fn((selector: unknown) => {
                            if (selector === selectAllPlaylistsMeta) {
                                return playlistsSignal;
                            }
                            if (selector === selectPlaylistsLoadingFlag) {
                                return loadedSignal;
                            }
                            if (selector === selectActivePlaylistId) {
                                return activePlaylistIdSignal;
                            }

                            throw new Error(
                                `Unexpected selector: ${String(selector)}`
                            );
                        }),
                    },
                },
            ],
        });
    });

    afterEach(() => {
        localStorage.clear();
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: originalElectron,
        });
        routerEvents.complete();
        jest.restoreAllMocks();
    });

    it('preserves same-provider Xtream sections when switching through selectPlaylist', () => {
        router.url = '/workspace/xtreams/xtream-a/live';
        const service = instantiateFacade();

        service.selectPlaylist(xtreamB);

        expect(dispatch).toHaveBeenCalledWith(
            PlaylistActions.setActivePlaylist({ playlistId: xtreamB._id })
        );
        expect(router.navigate).toHaveBeenCalledWith([
            'workspace',
            'xtreams',
            xtreamB._id,
            'live',
        ]);
    });

    it('preserves same-provider Stalker sections when resolving target commands', () => {
        const service = instantiateFacade();

        expect(
            service.resolveTargetCommands('stalker', stalkerB._id, {
                inWorkspace: true,
                provider: 'stalker',
                playlistId: stalkerA._id,
                section: 'downloads',
            })
        ).toEqual(['workspace', 'stalker', stalkerB._id, 'downloads']);
    });

    it('preserves same-provider M3U sections when resolving target commands', () => {
        const service = instantiateFacade();

        expect(
            service.resolveTargetCommands('playlists', m3uB._id, {
                inWorkspace: true,
                provider: 'playlists',
                playlistId: m3uA._id,
                section: 'groups',
            })
        ).toEqual(['workspace', 'playlists', m3uB._id, 'groups']);
    });

    it('maps Stalker ITV routes to Xtream live routes', () => {
        const service = instantiateFacade();

        expect(
            service.resolveTargetCommands('xtreams', xtreamA._id, {
                inWorkspace: true,
                provider: 'stalker',
                playlistId: stalkerA._id,
                section: 'itv',
            })
        ).toEqual(['workspace', 'xtreams', xtreamA._id, 'live']);
    });

    it('maps Xtream live routes to Stalker ITV routes', () => {
        const service = instantiateFacade();

        expect(
            service.resolveTargetCommands('stalker', stalkerA._id, {
                inWorkspace: true,
                provider: 'xtreams',
                playlistId: xtreamA._id,
                section: 'live',
            })
        ).toEqual(['workspace', 'stalker', stalkerA._id, 'itv']);
    });

    it('maps Xtream recently-added routes to Stalker recent routes', () => {
        const service = instantiateFacade();

        expect(
            service.resolveTargetCommands('stalker', stalkerA._id, {
                inWorkspace: true,
                provider: 'xtreams',
                playlistId: xtreamA._id,
                section: 'recently-added',
            })
        ).toEqual(['workspace', 'stalker', stalkerA._id, 'recent']);
    });

    it('preserves recent and favorites sections across provider changes when both providers support them', () => {
        const service = instantiateFacade();

        expect(
            service.resolveTargetCommands('xtreams', xtreamA._id, {
                inWorkspace: true,
                provider: 'playlists',
                playlistId: m3uA._id,
                section: 'recent',
            })
        ).toEqual(['workspace', 'xtreams', xtreamA._id, 'recent']);
        expect(
            service.resolveTargetCommands('stalker', stalkerA._id, {
                inWorkspace: true,
                provider: 'playlists',
                playlistId: m3uA._id,
                section: 'favorites',
            })
        ).toEqual(['workspace', 'stalker', stalkerA._id, 'favorites']);
    });

    it('falls back to M3U all when the current section has no M3U equivalent', () => {
        const service = instantiateFacade();

        expect(
            service.resolveTargetCommands('playlists', m3uA._id, {
                inWorkspace: true,
                provider: 'xtreams',
                playlistId: xtreamA._id,
                section: 'live',
            })
        ).toEqual(['workspace', 'playlists', m3uA._id, 'all']);
    });

    it('does not let stale M3U memory override the fallback to all for portal-only sections', () => {
        localStorage.setItem(
            LAST_SECTION_STORAGE_KEY,
            JSON.stringify({
                providers: {
                    playlists: 'recent',
                },
                playlists: {
                    [m3uA._id]: {
                        provider: 'playlists',
                        section: 'recent',
                        updatedAt: 1,
                    },
                },
            })
        );
        const service = instantiateFacade();

        expect(
            service.resolveTargetCommands('playlists', m3uA._id, {
                inWorkspace: true,
                provider: 'xtreams',
                playlistId: xtreamA._id,
                section: 'live',
            })
        ).toEqual(['workspace', 'playlists', m3uA._id, 'all']);
    });

    it('uses playlist-specific section memory when the current route has no section', () => {
        localStorage.setItem(
            LAST_SECTION_STORAGE_KEY,
            JSON.stringify({
                providers: {},
                playlists: {
                    [xtreamB._id]: {
                        provider: 'xtreams',
                        section: 'series',
                        updatedAt: 1,
                    },
                },
            })
        );
        const service = instantiateFacade();

        expect(
            service.resolveTargetCommands('xtreams', xtreamB._id, {
                inWorkspace: true,
                provider: 'xtreams',
                playlistId: xtreamA._id,
                section: null,
            })
        ).toEqual(['workspace', 'xtreams', xtreamB._id, 'series']);
    });

    it('uses provider-level section memory when no route section or playlist memory exists', () => {
        localStorage.setItem(
            LAST_SECTION_STORAGE_KEY,
            JSON.stringify({
                providers: {
                    stalker: 'search',
                },
                playlists: {},
            })
        );
        const service = instantiateFacade();

        expect(
            service.resolveTargetCommands('stalker', stalkerB._id, {
                inWorkspace: true,
                provider: 'xtreams',
                playlistId: xtreamA._id,
                section: null,
            })
        ).toEqual(['workspace', 'stalker', stalkerB._id, 'search']);
    });

    it('omits Xtream sections outside Electron where section navigation is unsupported', () => {
        setElectronAvailability(false);
        const service = instantiateFacade();

        expect(
            service.resolveTargetCommands('xtreams', xtreamB._id, {
                inWorkspace: true,
                provider: 'xtreams',
                playlistId: xtreamA._id,
                section: 'live',
            })
        ).toEqual(['workspace', 'xtreams', xtreamB._id]);
    });

    it('returns null when switching from the workspace root before a provider route is selected', () => {
        const service = instantiateFacade();

        expect(
            service.resolveTargetCommands('playlists', m3uA._id, {
                inWorkspace: true,
                provider: null,
                playlistId: null,
                section: null,
            })
        ).toBeNull();
    });

    it('syncs section memory from router navigation events', () => {
        router.url = '/workspace/playlists/m3u-a/favorites';
        const service = instantiateFacade();

        router.url = '/workspace/xtreams/xtream-a/recently-added';
        routerEvents.next(
            new NavigationEnd(
                1,
                '/workspace/xtreams/xtream-a/recently-added',
                '/workspace/xtreams/xtream-a/recently-added'
            )
        );

        expect(service.routeContext()).toEqual<PlaylistRouteContext>({
            inWorkspace: true,
            provider: 'xtreams',
            playlistId: xtreamA._id,
            section: 'recently-added',
        });
        expect(JSON.parse(localStorage.getItem(LAST_SECTION_STORAGE_KEY) ?? '{}'))
            .toEqual({
                playlists: {
                    [m3uA._id]: {
                        provider: 'playlists',
                        section: 'favorites',
                        updatedAt: expect.any(Number),
                    },
                    [xtreamA._id]: {
                        provider: 'xtreams',
                        section: 'recently-added',
                        updatedAt: expect.any(Number),
                    },
                },
                providers: {
                    playlists: 'favorites',
                    xtreams: 'recently-added',
                },
            });
    });
});

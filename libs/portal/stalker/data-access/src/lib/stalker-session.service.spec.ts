/* eslint-disable max-lines -- facade boundary matrix covers all typed outcomes and controls */
import { TestBed } from '@angular/core/testing';
import {
    STALKER_SESSION_APPLICATION_OPERATIONS,
    type Playlist,
    type StalkerSessionConnectionOutcome,
    type StalkerSessionControlOutcome,
    type StalkerSessionRequestOutcome,
} from '@iptvnator/shared/interfaces';
import {
    STALKER_SESSION_BRIDGE,
    type StalkerSessionBridge,
    StalkerSessionOutcomeError,
    StalkerSessionService,
} from './stalker-session.service';

const PLAYLIST: Playlist = {
    _id: 'playlist-1',
    autoRefresh: false,
    count: 0,
    importDate: '2026-07-27T00:00:00.000Z',
    isFullStalkerPortal: true,
    lastUsage: '2026-07-27T00:00:00.000Z',
    macAddress: '00-1a-79-aa-bb-cc',
    password: 'saved-password-must-not-cross',
    portalUrl: 'https://portal.example/stalker_portal/server/load.php',
    stalkerSourceUrl: 'https://portal.example/c/',
    stalkerToken: 'legacy-token-must-not-cross',
    title: 'Portal',
    username: 'saved-user-must-not-cross',
};

const READY: StalkerSessionConnectionOutcome = {
    capabilities: {
        authenticatedSession: true,
        playbackContext: true,
    },
    connectionMode: 'persisted-open',
    endpoint: 'https://portal.example/stalker_portal/server/load.php',
    kind: 'ready',
    landingUrl: 'https://portal.example/c/',
    leaseRef: 'opaque-lease-1',
    persistenceDraft: {
        isFullStalkerPortal: true,
        portalUrl: 'https://portal.example/stalker_portal/server/load.php',
        stalkerLandingUrl: 'https://portal.example/c/',
        stalkerRecipeClassifierVersion: 1,
        stalkerRequestRecipe: 'full-session',
    },
    recipe: 'full-session',
    requestId: 'request-open-1',
};

const PROVISIONAL_READY: StalkerSessionConnectionOutcome = {
    ...READY,
    attemptRef: 'opaque-attempt-1',
    connectionMode: 'provisional',
    provisionalReason: 'edit',
    requestId: 'request-provisional-1',
};

const RECONNECTED_READY: StalkerSessionConnectionOutcome = {
    ...READY,
    leaseRef: 'opaque-lease-2',
    requestId: 'request-reconnected-1',
};

function createBridge(): jest.Mocked<StalkerSessionBridge> {
    return {
        stalkerSessionContinue: jest.fn(),
        stalkerSessionControl: jest.fn(),
        stalkerSessionOpen: jest.fn(),
        stalkerSessionRequest: jest.fn(),
    };
}

describe('StalkerSessionService', () => {
    let bridge: jest.Mocked<StalkerSessionBridge>;
    let service: StalkerSessionService;

    beforeEach(() => {
        bridge = createBridge();
        TestBed.configureTestingModule({
            providers: [
                StalkerSessionService,
                {
                    provide: STALKER_SESSION_BRIDGE,
                    useValue: bridge,
                },
            ],
        });
        service = TestBed.inject(StalkerSessionService);
    });

    it('opens a typed connection descriptor without forwarding legacy tokens or credentials', async () => {
        bridge.stalkerSessionOpen.mockResolvedValue(READY);

        await expect(service.open(PLAYLIST)).resolves.toBe(READY);

        expect(bridge.stalkerSessionOpen).toHaveBeenCalledWith({
            descriptor: {
                connectionMode: 'persisted-open',
                learnedEndpointHint:
                    'https://portal.example/stalker_portal/server/load.php',
                macAddress: '00:1A:79:AA:BB:CC',
                playlistRef: 'playlist-1',
                profilePreset: {
                    id: 'mag250-public-5_1-minimal-v1',
                    version: 1,
                },
                sourceUrl: 'https://portal.example/c/',
            },
        });
        expect(
            JSON.stringify(bridge.stalkerSessionOpen.mock.calls[0])
        ).not.toContain('legacy-token-must-not-cross');
        expect(
            JSON.stringify(bridge.stalkerSessionOpen.mock.calls[0])
        ).not.toContain('saved-password-must-not-cross');
        expect(
            JSON.stringify(bridge.stalkerSessionOpen.mock.calls[0])
        ).not.toContain('saved-user-must-not-cross');
        expect(service.getLeaseRef('playlist-1')).toBe('opaque-lease-1');
    });

    it('continues a challenge through the typed bridge and associates its ready lease with the playlist', async () => {
        bridge.stalkerSessionContinue.mockResolvedValue(READY);

        await expect(
            service.continue('playlist-1', {
                challengeRef: 'opaque-challenge-1',
                response: {
                    kind: 'credentials',
                    password: 'portal-password',
                    username: 'portal-user',
                },
            })
        ).resolves.toBe(READY);

        expect(bridge.stalkerSessionContinue).toHaveBeenCalledWith({
            challengeRef: 'opaque-challenge-1',
            response: {
                kind: 'credentials',
                password: 'portal-password',
                username: 'portal-user',
            },
        });
        expect(service.getLeaseRef('playlist-1')).toBe('opaque-lease-1');
    });

    it('submits saved credentials only through continue after Electron requests them', async () => {
        bridge.stalkerSessionOpen.mockResolvedValue({
            attemptNumber: 1,
            challengeRef: 'opaque-credentials-challenge',
            kind: 'credentials-required',
            requestId: 'request-credentials-1',
        });
        bridge.stalkerSessionContinue.mockResolvedValue(READY);

        await expect(service.open(PLAYLIST)).resolves.toBe(READY);

        expect(bridge.stalkerSessionContinue).toHaveBeenCalledWith({
            challengeRef: 'opaque-credentials-challenge',
            response: {
                kind: 'credentials',
                password: 'saved-password-must-not-cross',
                username: 'saved-user-must-not-cross',
            },
        });
        expect(service.getLeaseRef('playlist-1')).toBe('opaque-lease-1');
    });

    it('returns a fresh challenge instead of resubmitting rejected saved credentials', async () => {
        const rejectedChallenge: StalkerSessionConnectionOutcome = {
            attemptNumber: 2,
            challengeRef: 'opaque-fresh-challenge',
            kind: 'credentials-required',
            requestId: 'request-credentials-2',
            savedCredentialsRejected: true,
        };
        bridge.stalkerSessionOpen.mockResolvedValue(rejectedChallenge);

        await expect(service.open(PLAYLIST)).resolves.toBe(rejectedChallenge);

        expect(bridge.stalkerSessionContinue).not.toHaveBeenCalled();
    });

    it('keeps a provisional lease separate until commit and drops it on discard', async () => {
        bridge.stalkerSessionOpen.mockResolvedValue(PROVISIONAL_READY);
        bridge.stalkerSessionControl.mockResolvedValue({
            action: 'commit',
            kind: 'success',
            requestId: 'request-commit-1',
        });

        await service.open(PLAYLIST, {
            connectionMode: 'provisional',
            provisionalReason: 'edit',
        });

        expect(service.getLeaseRef('playlist-1')).toBeUndefined();

        await service.commit('opaque-attempt-1');

        expect(service.getLeaseRef('playlist-1')).toBe('opaque-lease-1');

        bridge.stalkerSessionOpen.mockResolvedValue({
            ...PROVISIONAL_READY,
            attemptRef: 'opaque-attempt-2',
            leaseRef: 'opaque-lease-2',
        });
        bridge.stalkerSessionControl.mockResolvedValue({
            action: 'discard',
            kind: 'success',
            requestId: 'request-discard-2',
        });

        await service.open(PLAYLIST, {
            connectionMode: 'provisional',
            provisionalReason: 'edit',
        });
        await service.discard('opaque-attempt-2');

        expect(service.getLeaseRef('playlist-1')).toBe('opaque-lease-1');
    });

    it('passes an operation-specific typed request through unchanged', async () => {
        const outcome: StalkerSessionRequestOutcome<'get-short-epg'> = {
            kind: 'success',
            operation: STALKER_SESSION_APPLICATION_OPERATIONS.ShortEpg,
            payload: {
                programs: [],
            },
            requestId: 'request-epg-1',
        };
        bridge.stalkerSessionRequest.mockResolvedValue(outcome);

        await expect(
            service.request({
                leaseRef: 'opaque-lease-1',
                operation: STALKER_SESSION_APPLICATION_OPERATIONS.ShortEpg,
                parameters: {
                    channelId: '42',
                    limit: 10,
                },
            })
        ).resolves.toBe(outcome);

        expect(bridge.stalkerSessionRequest).toHaveBeenCalledWith({
            leaseRef: 'opaque-lease-1',
            operation: STALKER_SESSION_APPLICATION_OPERATIONS.ShortEpg,
            parameters: {
                channelId: '42',
                limit: 10,
            },
        });
    });

    it.each([
        {
            call: (target: StalkerSessionService) =>
                target.activate('opaque-lease-1'),
            request: {
                action: 'activate',
                leaseRef: 'opaque-lease-1',
            },
        },
        {
            call: (target: StalkerSessionService) =>
                target.deactivate('opaque-lease-1'),
            request: {
                action: 'deactivate',
                leaseRef: 'opaque-lease-1',
            },
        },
        {
            call: (target: StalkerSessionService) =>
                target.close('opaque-lease-1'),
            request: {
                action: 'close',
                leaseRef: 'opaque-lease-1',
            },
        },
        {
            call: (target: StalkerSessionService) =>
                target.forceRedetect('opaque-lease-1'),
            request: {
                action: 'force-redetect',
                leaseRef: 'opaque-lease-1',
            },
        },
        {
            call: (target: StalkerSessionService) =>
                target.commit('opaque-attempt-1'),
            request: {
                action: 'commit',
                attemptRef: 'opaque-attempt-1',
            },
        },
        {
            call: (target: StalkerSessionService) =>
                target.discard('opaque-attempt-1'),
            request: {
                action: 'discard',
                attemptRef: 'opaque-attempt-1',
            },
        },
    ] as const)(
        'routes $request.action through session control',
        async ({ call, request }) => {
            const outcome: StalkerSessionControlOutcome = {
                action: request.action,
                kind: 'success',
                requestId: `request-${request.action}`,
            };
            bridge.stalkerSessionControl.mockResolvedValue(outcome);

            await expect(call(service)).resolves.toBe(outcome);

            expect(bridge.stalkerSessionControl).toHaveBeenCalledWith(request);
        }
    );

    it('adapts a current raw application call to a typed lease request and maps the result back to the legacy response shape', async () => {
        bridge.stalkerSessionOpen.mockResolvedValue(READY);
        bridge.stalkerSessionRequest.mockResolvedValue({
            kind: 'success',
            operation: STALKER_SESSION_APPLICATION_OPERATIONS.CatalogCategories,
            payload: {
                items: [
                    {
                        censored: true,
                        id: '7',
                        name: 'Movies',
                    },
                ],
            },
            requestId: 'request-categories-1',
        });

        await expect(
            service.makeAuthenticatedRequest(PLAYLIST, {
                action: 'get_categories',
                type: 'vod',
            })
        ).resolves.toEqual({
            js: [
                {
                    censored: 1,
                    id: '7',
                    title: 'Movies',
                },
            ],
        });

        expect(bridge.stalkerSessionRequest).toHaveBeenCalledWith({
            leaseRef: 'opaque-lease-1',
            operation: STALKER_SESSION_APPLICATION_OPERATIONS.CatalogCategories,
            parameters: {
                contentType: 'vod',
            },
        });
    });

    it('surfaces non-success outcomes without attempting renderer-side authentication', async () => {
        const failure: StalkerSessionConnectionOutcome = {
            kind: 'failure',
            reason: 'account-access-denied',
            requestId: 'request-open-failure',
            retryable: false,
            stage: 'profile-first',
        };
        bridge.stalkerSessionOpen.mockResolvedValue(failure);

        await expect(
            service.makeAuthenticatedRequest(PLAYLIST, {
                action: 'get_categories',
                type: 'vod',
            })
        ).rejects.toEqual(new StalkerSessionOutcomeError(failure));
        expect(bridge.stalkerSessionRequest).not.toHaveBeenCalled();
    });

    it('lets the route recover a principal transition and reissues the original operation exactly once', async () => {
        const transition: StalkerSessionRequestOutcome = {
            kind: 'failure',
            reason: 'principal-transition-required',
            requestId: 'request-transition-1',
            retryable: false,
            stage: 'refreshing',
        };
        bridge.stalkerSessionOpen
            .mockResolvedValueOnce(READY)
            .mockResolvedValueOnce(RECONNECTED_READY);
        bridge.stalkerSessionRequest
            .mockResolvedValueOnce(transition)
            .mockResolvedValueOnce({
                kind: 'success',
                operation:
                    STALKER_SESSION_APPLICATION_OPERATIONS.CatalogCategories,
                payload: {
                    items: [{ id: '7', name: 'Movies' }],
                },
                requestId: 'request-categories-retried',
            });
        const recover = jest.fn(async () => {
            await service.open(PLAYLIST, {
                connectionMode: 'provisional',
                provisionalReason: 'migration',
            });
            return true;
        });
        service.registerRecoveryHandler(recover);

        await expect(
            service.makeAuthenticatedRequest(PLAYLIST, {
                action: 'get_categories',
                type: 'vod',
            })
        ).resolves.toEqual({
            js: [{ id: '7', title: 'Movies' }],
        });

        expect(recover).toHaveBeenCalledWith({
            outcome: transition,
            playlist: PLAYLIST,
            trigger: 'request',
        });
        expect(bridge.stalkerSessionRequest).toHaveBeenCalledTimes(2);
        expect(bridge.stalkerSessionRequest.mock.calls[1][0]).toMatchObject({
            leaseRef: 'opaque-lease-2',
            operation:
                STALKER_SESSION_APPLICATION_OPERATIONS.CatalogCategories,
        });
    });

    it('joins concurrent route recovery while preserving one retry per original operation', async () => {
        const transition: StalkerSessionRequestOutcome = {
            kind: 'failure',
            reason: 'principal-transition-required',
            requestId: 'request-transition-concurrent',
            retryable: false,
            stage: 'refreshing',
        };
        bridge.stalkerSessionOpen.mockResolvedValue(READY);
        bridge.stalkerSessionRequest
            .mockResolvedValueOnce(transition)
            .mockResolvedValueOnce(transition)
            .mockResolvedValue({
                kind: 'success',
                operation:
                    STALKER_SESSION_APPLICATION_OPERATIONS.CatalogCategories,
                payload: { items: [] },
                requestId: 'request-categories-retried',
            });
        let resolveRecovery!: (value: boolean) => void;
        const recovery = new Promise<boolean>((resolve) => {
            resolveRecovery = resolve;
        });
        const recover = jest.fn(() => recovery);
        service.registerRecoveryHandler(recover);

        const first = service.makeAuthenticatedRequest(PLAYLIST, {
            action: 'get_categories',
            type: 'vod',
        });
        const second = service.makeAuthenticatedRequest(PLAYLIST, {
            action: 'get_categories',
            type: 'vod',
        });
        await Promise.resolve();
        await Promise.resolve();
        resolveRecovery(true);

        await expect(Promise.all([first, second])).resolves.toEqual([
            { js: [] },
            { js: [] },
        ]);
        expect(recover).toHaveBeenCalledTimes(1);
        expect(bridge.stalkerSessionRequest).toHaveBeenCalledTimes(4);
    });

    it('lets the route continue a first-open credential challenge before the application request', async () => {
        const challenge: StalkerSessionConnectionOutcome = {
            attemptNumber: 1,
            challengeRef: 'opaque-challenge-route-1',
            kind: 'credentials-required',
            requestId: 'request-open-challenge',
            savedCredentialsRejected: true,
        };
        bridge.stalkerSessionOpen.mockResolvedValue(challenge);
        bridge.stalkerSessionContinue.mockResolvedValue(READY);
        bridge.stalkerSessionRequest.mockResolvedValue({
            kind: 'success',
            operation:
                STALKER_SESSION_APPLICATION_OPERATIONS.CatalogCategories,
            payload: { items: [] },
            requestId: 'request-after-route-recovery',
        });
        const recover = jest.fn(async () => {
            await service.continue(PLAYLIST._id, {
                challengeRef: challenge.challengeRef,
                response: {
                    kind: 'credentials',
                    password: 'entered-password',
                    username: 'entered-user',
                },
            });
            return true;
        });
        service.registerRecoveryHandler(recover);

        await expect(
            service.makeAuthenticatedRequest(PLAYLIST, {
                action: 'get_categories',
                type: 'vod',
            })
        ).resolves.toEqual({ js: [] });

        expect(recover).toHaveBeenCalledWith({
            outcome: challenge,
            playlist: PLAYLIST,
            trigger: 'open',
        });
        expect(bridge.stalkerSessionRequest).toHaveBeenCalledTimes(1);
    });

    it('unregisters only the matching route recovery handler', async () => {
        const first = jest.fn(async () => true);
        const second = jest.fn(async () => true);
        const unregisterFirst = service.registerRecoveryHandler(first);
        service.registerRecoveryHandler(second);

        unregisterFirst();

        const failure: StalkerSessionConnectionOutcome = {
            attemptNumber: 1,
            challengeRef: 'opaque-challenge-active-handler',
            kind: 'credentials-required',
            requestId: 'request-active-handler',
            savedCredentialsRejected: true,
        };
        bridge.stalkerSessionOpen.mockResolvedValue(failure);

        await expect(
            service.makeAuthenticatedRequest(PLAYLIST, {
                action: 'get_categories',
                type: 'vod',
            })
        ).rejects.toEqual(new StalkerSessionOutcomeError(failure));
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('fails closed when the typed Electron bridge is unavailable', async () => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                StalkerSessionService,
                {
                    provide: STALKER_SESSION_BRIDGE,
                    useValue: undefined,
                },
            ],
        });
        service = TestBed.inject(StalkerSessionService);

        expect(service.supportsTypedSessions()).toBe(false);
        await expect(service.open(PLAYLIST)).rejects.toThrow(
            'stalker-session-bridge-unavailable'
        );
    });

    it('exposes no renderer token cache, raw auth steps, watchdog timers, or token getter', () => {
        const intervalSpy = jest.spyOn(globalThis, 'setInterval');
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                StalkerSessionService,
                {
                    provide: STALKER_SESSION_BRIDGE,
                    useValue: bridge,
                },
            ],
        });
        service = TestBed.inject(StalkerSessionService);
        const forbiddenSurface = [
            'authenticate',
            'clearCachedToken',
            'doAuth',
            'ensureToken',
            'getCachedToken',
            'getProfile',
            'performHandshake',
            'setActiveWatchdogPlaylist',
            'setCachedToken',
        ];

        for (const name of forbiddenSurface) {
            expect(name in service).toBe(false);
        }
        expect(intervalSpy).not.toHaveBeenCalled();
    });
});

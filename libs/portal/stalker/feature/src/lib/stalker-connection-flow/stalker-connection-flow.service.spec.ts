/* eslint-disable max-lines -- route connection state matrix is intentionally kept together */
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { PlaylistActions } from '@iptvnator/m3u-state';
import {
    StalkerSessionRecoveryHandler,
    StalkerSessionService,
} from '@iptvnator/portal/stalker/data-access';
import { PlaylistsService } from '@iptvnator/services';
import {
    Playlist,
    StalkerSessionConnectionOutcome,
    StalkerSessionFullReadyOutcome,
} from '@iptvnator/shared/interfaces';
import { EMPTY, Subject, of, throwError } from 'rxjs';
import { StalkerCredentialsDialogComponent } from './stalker-credentials-dialog.component';
import { StalkerConnectionFlowService } from './stalker-connection-flow.service';
import { StalkerOriginApprovalDialogComponent } from './stalker-origin-approval-dialog.component';

const LEGACY_PLAYLIST: Playlist = {
    _id: 'stalker-route-1',
    autoRefresh: false,
    count: 0,
    importDate: '2026-07-27T00:00:00.000Z',
    lastUsage: '2026-07-27T00:00:00.000Z',
    macAddress: '00:1A:79:12:34:56',
    portalUrl: 'https://source.example/c/',
    stalkerToken: 'legacy-token-must-be-removed',
    title: 'Living room',
};

const READY: StalkerSessionFullReadyOutcome = {
    attemptRef: 'attempt-route-1',
    capabilities: {
        authenticatedSession: true,
        playbackContext: true,
    },
    connectionMode: 'provisional',
    endpoint: 'https://portal.example/stalker_portal/server/load.php',
    kind: 'ready',
    landingUrl: 'https://portal.example/c/',
    leaseRef: 'lease-route-1',
    persistenceDraft: {
        isFullStalkerPortal: true,
        portalUrl: 'https://portal.example/stalker_portal/server/load.php',
        stalkerLandingUrl: 'https://portal.example/c/',
        stalkerLastVerifiedAt: '2026-07-27T12:00:00.000Z',
        stalkerRecipeClassifierVersion: 1,
        stalkerRequestRecipe: 'full-session',
        stalkerSourceUrl: 'https://source.example/c/',
    },
    provisionalReason: 'migration',
    recipe: 'full-session',
    requestId: 'request-ready-route-1',
};

const STATELESS_READY: StalkerSessionConnectionOutcome = {
    attemptRef: 'attempt-stateless-route-1',
    connectionMode: 'provisional',
    endpoint: 'https://portal.example/portal.php',
    kind: 'ready',
    landingUrl: 'https://portal.example/c/',
    persistenceDraft: {
        isFullStalkerPortal: false,
        portalUrl: 'https://portal.example/portal.php',
        stalkerLandingUrl: 'https://portal.example/c/',
        stalkerRecipeClassifierVersion: 1,
        stalkerRequestRecipe: 'stateless-mac',
    },
    provisionalReason: 'migration',
    recipe: 'stateless-mac',
    requestId: 'request-stateless-route-1',
};

const CONTROL_SUCCESS = {
    action: 'commit' as const,
    kind: 'success' as const,
    requestId: 'request-commit-route-1',
};

const PERSISTED_READY: StalkerSessionFullReadyOutcome = {
    capabilities: {
        authenticatedSession: true,
        playbackContext: true,
    },
    connectionMode: 'persisted-open',
    endpoint: 'https://portal.example/stalker_portal/server/load.php',
    kind: 'ready',
    landingUrl: 'https://portal.example/c/',
    leaseRef: 'lease-route-reopened',
    persistenceDraft: {
        isFullStalkerPortal: true,
        portalUrl: 'https://portal.example/stalker_portal/server/load.php',
        stalkerLandingUrl: 'https://portal.example/c/',
        stalkerLastVerifiedAt: '2026-07-27T12:00:00.000Z',
        stalkerRecipeClassifierVersion: 1,
        stalkerRequestRecipe: 'full-session',
        stalkerSourceUrl: 'https://source.example/c/',
    },
    recipe: 'full-session',
    requestId: 'request-ready-route-reopened',
};

function createDeferred<T>(): {
    readonly promise: Promise<T>;
    readonly resolve: (value: T) => void;
} {
    let resolve: (value: T) => void = () => undefined;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

async function flushPromises(): Promise<void> {
    for (let index = 0; index < 10; index += 1) {
        await Promise.resolve();
    }
}

function createClosableDialogRef() {
    const closed = new Subject<unknown>();
    return {
        afterClosed: () => closed.asObservable(),
        close: jest.fn(() => {
            closed.next(undefined);
            closed.complete();
        }),
    };
}

function createSessionMock() {
    let recoveryHandler: StalkerSessionRecoveryHandler | undefined;
    return {
        activate: jest.fn(),
        close: jest.fn().mockResolvedValue({
            action: 'close',
            kind: 'success',
            requestId: 'request-close-route-1',
        }),
        commit: jest.fn().mockResolvedValue(CONTROL_SUCCESS),
        continue: jest.fn(),
        discard: jest.fn().mockResolvedValue({
            action: 'discard',
            kind: 'success',
            requestId: 'request-discard-route-1',
        }),
        forceRedetect: jest.fn(),
        getLeaseRef: jest.fn().mockReturnValue('lease-route-1'),
        open: jest.fn(),
        registerRecoveryHandler: jest.fn(
            (handler: StalkerSessionRecoveryHandler) => {
                recoveryHandler = handler;
                return () => {
                    if (recoveryHandler === handler) {
                        recoveryHandler = undefined;
                    }
                };
            }
        ),
        supportsTypedSessions: jest.fn().mockReturnValue(true),
        recoveryHandler: () => recoveryHandler,
    };
}

describe('StalkerConnectionFlowService', () => {
    let service: StalkerConnectionFlowService;
    let session: ReturnType<typeof createSessionMock>;
    let playlists: {
        persistStalkerConnection: jest.Mock;
    };
    let store: {
        dispatch: jest.Mock;
    };
    let dialog: {
        open: jest.Mock;
    };
    let queuedDialogResults: unknown[];

    beforeEach(() => {
        session = createSessionMock();
        playlists = {
            persistStalkerConnection: jest.fn((playlist: Playlist) =>
                of(playlist)
            ),
        };
        store = {
            dispatch: jest.fn(),
        };
        queuedDialogResults = [];
        dialog = {
            open: jest.fn(() => ({
                afterClosed: () => of(queuedDialogResults.shift()),
                close: jest.fn(),
            })),
        };

        TestBed.configureTestingModule({
            providers: [
                StalkerConnectionFlowService,
                {
                    provide: StalkerSessionService,
                    useValue: session,
                },
                {
                    provide: PlaylistsService,
                    useValue: playlists,
                },
                {
                    provide: Store,
                    useValue: store,
                },
                {
                    provide: MatDialog,
                    useValue: dialog,
                },
                {
                    provide: MatSnackBar,
                    useValue: {
                        open: jest.fn(() => ({
                            onAction: () => EMPTY,
                        })),
                    },
                },
                {
                    provide: TranslateService,
                    useValue: {
                        instant: jest.fn((key: string) => key),
                    },
                },
            ],
        });
        service = TestBed.inject(StalkerConnectionFlowService);
    });

    it('classifies an ambiguous legacy full portal lazily and persists before commit', async () => {
        session.open.mockResolvedValue(READY);

        const connected = await service.ensureConnected(LEGACY_PLAYLIST);

        expect(session.open).toHaveBeenCalledWith(LEGACY_PLAYLIST, {
            connectionMode: 'provisional',
            provisionalReason: 'migration',
        });
        const persistedDraft = playlists.persistStalkerConnection.mock
            .calls[0][0] as Playlist;
        expect(persistedDraft).toMatchObject({
            isFullStalkerPortal: true,
            portalUrl: 'https://portal.example/stalker_portal/server/load.php',
            stalkerRequestRecipe: 'full-session',
            stalkerSourceUrl: 'https://source.example/c/',
        });
        expect(persistedDraft.stalkerToken).toBeUndefined();
        expect(
            playlists.persistStalkerConnection.mock.invocationCallOrder[0]
        ).toBeLessThan(session.commit.mock.invocationCallOrder[0]);
        expect(session.commit).toHaveBeenCalledWith('attempt-route-1');
        expect(store.dispatch).toHaveBeenCalledWith(
            PlaylistActions.stalkerConnectionPersisted({
                playlist: persistedDraft,
            })
        );
        expect(connected).toEqual(persistedDraft);
    });

    it('keeps an explicitly stateless record and PWA behavior unchanged', async () => {
        const simple = {
            ...LEGACY_PLAYLIST,
            isFullStalkerPortal: false,
            stalkerRecipeClassifierVersion: 1,
            stalkerRequestRecipe: 'stateless-mac' as const,
        };

        await expect(service.ensureConnected(simple)).resolves.toBe(simple);
        session.supportsTypedSessions.mockReturnValueOnce(false);
        await expect(service.ensureConnected(LEGACY_PLAYLIST)).resolves.toBe(
            LEGACY_PLAYLIST
        );

        expect(session.open).not.toHaveBeenCalled();
    });

    it('explicitly clears saved credentials when reclassification resolves to stateless', async () => {
        const playlist = {
            ...LEGACY_PLAYLIST,
            password: 'saved-password',
            username: 'saved-user',
        };
        session.open.mockResolvedValueOnce(STATELESS_READY);

        const connected = await service.ensureConnected(playlist);

        expect(connected).not.toHaveProperty('username');
        expect(connected).not.toHaveProperty('password');
        expect(playlists.persistStalkerConnection).toHaveBeenCalledWith(
            expect.not.objectContaining({
                password: expect.anything(),
                username: expect.anything(),
            }),
            { clearCredentials: true }
        );
    });

    it('preserves saved credentials for an untouched full-session ready outcome', async () => {
        const playlist = {
            ...LEGACY_PLAYLIST,
            password: 'saved-password',
            stalkerRecipeClassifierVersion: 1,
            stalkerRequestRecipe: 'full-session' as const,
            username: 'saved-user',
        };
        session.open.mockResolvedValueOnce(READY);

        await service.ensureConnected(playlist);

        expect(playlists.persistStalkerConnection).toHaveBeenCalledWith(
            expect.objectContaining({
                password: 'saved-password',
                username: 'saved-user',
            })
        );
        expect(
            playlists.persistStalkerConnection.mock.calls[0]
        ).toHaveLength(1);
    });

    it('lets a full-session recipe override a stale false legacy boolean', async () => {
        session.open.mockResolvedValueOnce(READY);
        const playlist = {
            ...LEGACY_PLAYLIST,
            isFullStalkerPortal: false,
            stalkerRecipeClassifierVersion: 1,
            stalkerRequestRecipe: 'full-session' as const,
        };

        await expect(service.ensureConnected(playlist)).resolves.toMatchObject({
            stalkerRequestRecipe: 'full-session',
        });

        expect(session.open).toHaveBeenCalledWith(playlist, {});
    });

    it('provisionally reclassifies a full-session recipe from a stale classifier', async () => {
        session.open.mockResolvedValueOnce(READY);
        const playlist = {
            ...LEGACY_PLAYLIST,
            isFullStalkerPortal: true,
            stalkerRecipeClassifierVersion: 0,
            stalkerRequestRecipe: 'full-session' as const,
        };

        await service.ensureConnected(playlist);

        expect(session.open).toHaveBeenCalledWith(playlist, {
            connectionMode: 'provisional',
            provisionalReason: 'migration',
        });
    });

    it('provisionally reclassifies a stateless recipe from a stale classifier', async () => {
        session.open.mockResolvedValueOnce(READY);
        const playlist = {
            ...LEGACY_PLAYLIST,
            isFullStalkerPortal: false,
            stalkerRecipeClassifierVersion: 0,
            stalkerRequestRecipe: 'stateless-mac' as const,
        };

        await service.ensureConnected(playlist);

        expect(session.open).toHaveBeenCalledWith(playlist, {
            connectionMode: 'provisional',
            provisionalReason: 'migration',
        });
    });

    it('lazily classifies a recipe-less record regardless of its legacy boolean', async () => {
        session.open.mockResolvedValueOnce(READY);
        const playlist = {
            ...LEGACY_PLAYLIST,
            isFullStalkerPortal: false,
        };

        await expect(service.ensureConnected(playlist)).resolves.toMatchObject({
            stalkerRequestRecipe: 'full-session',
        });

        expect(session.open).toHaveBeenCalledWith(playlist, {
            connectionMode: 'provisional',
            provisionalReason: 'migration',
        });
    });

    it('shows exact origin and credential challenges and persists only accepted credentials', async () => {
        const origin: StalkerSessionConnectionOutcome = {
            attemptRef: 'attempt-route-1',
            challengeRef: 'challenge-origin-route-1',
            finalOrigin: 'https://portal.example',
            kind: 'origin-approval-required',
            requestId: 'request-origin-route-1',
            sourceOrigin: 'https://source.example',
        };
        const credentials: StalkerSessionConnectionOutcome = {
            attemptNumber: 2,
            attemptRef: 'attempt-route-1',
            challengeRef: 'challenge-credentials-route-1',
            kind: 'credentials-required',
            requestId: 'request-credentials-route-1',
            savedCredentialsRejected: true,
        };
        session.open.mockResolvedValue(origin);
        session.continue
            .mockResolvedValueOnce(credentials)
            .mockResolvedValueOnce(READY);
        queuedDialogResults.push(true, {
            password: 'replacement-password',
            username: 'replacement-user',
        });

        const connected = await service.ensureConnected({
            ...LEGACY_PLAYLIST,
            password: 'old-password',
            username: 'old-user',
        });

        expect(dialog.open).toHaveBeenNthCalledWith(
            1,
            StalkerOriginApprovalDialogComponent,
            expect.objectContaining({
                data: {
                    finalOrigin: 'https://portal.example',
                    sourceOrigin: 'https://source.example',
                },
                disableClose: true,
            })
        );
        expect(dialog.open).toHaveBeenNthCalledWith(
            2,
            StalkerCredentialsDialogComponent,
            expect.objectContaining({
                data: {
                    savedCredentialsRejected: true,
                    username: 'old-user',
                },
                disableClose: true,
            })
        );
        expect(session.continue).toHaveBeenNthCalledWith(
            1,
            LEGACY_PLAYLIST._id,
            {
                challengeRef: 'challenge-origin-route-1',
                response: {
                    approved: true,
                    kind: 'origin-approval',
                },
            }
        );
        expect(session.continue).toHaveBeenNthCalledWith(
            2,
            LEGACY_PLAYLIST._id,
            {
                challengeRef: 'challenge-credentials-route-1',
                response: {
                    kind: 'credentials',
                    password: 'replacement-password',
                    username: 'replacement-user',
                },
            }
        );
        expect(connected).toMatchObject({
            password: 'replacement-password',
            username: 'replacement-user',
        });
    });

    it('does not persist credentials when an origin challenge intervenes before ready', async () => {
        const credentials: StalkerSessionConnectionOutcome = {
            attemptNumber: 1,
            attemptRef: 'attempt-credential-origin',
            challengeRef: 'challenge-credential-origin',
            kind: 'credentials-required',
            requestId: 'request-credential-origin',
        };
        const origin: StalkerSessionConnectionOutcome = {
            attemptRef: 'attempt-credential-origin',
            challengeRef: 'challenge-origin-after-credentials',
            finalOrigin: 'https://redirected.example',
            kind: 'origin-approval-required',
            requestId: 'request-origin-after-credentials',
            sourceOrigin: 'https://source.example',
        };
        session.open.mockResolvedValueOnce(credentials);
        session.continue
            .mockResolvedValueOnce(origin)
            .mockResolvedValueOnce(READY);
        queuedDialogResults.push(
            {
                password: 'candidate-password',
                username: 'candidate-user',
            },
            true
        );

        const connected = await service.ensureConnected(LEGACY_PLAYLIST);

        expect(connected?.username).toBeUndefined();
        expect(connected?.password).toBeUndefined();
        const persisted = playlists.persistStalkerConnection.mock
            .calls[0][0] as Playlist;
        expect(persisted.username).toBeUndefined();
        expect(persisted.password).toBeUndefined();
        expect(
            playlists.persistStalkerConnection.mock.calls[0][1]
        ).toEqual({ clearCredentials: true });
    });

    it('invalidates saved credentials when open redirects before the target becomes ready', async () => {
        const origin: StalkerSessionConnectionOutcome = {
            attemptRef: 'attempt-saved-credential-origin',
            challengeRef: 'challenge-saved-credential-origin',
            finalOrigin: 'https://redirected.example',
            kind: 'origin-approval-required',
            requestId: 'request-saved-credential-origin',
            sourceOrigin: 'https://source.example',
        };
        session.open.mockResolvedValueOnce(origin);
        session.continue.mockResolvedValueOnce(READY);
        queuedDialogResults.push(true);

        const connected = await service.ensureConnected({
            ...LEGACY_PLAYLIST,
            password: 'saved-password',
            username: 'saved-user',
        });

        expect(connected?.username).toBeUndefined();
        expect(connected?.password).toBeUndefined();
        const persisted = playlists.persistStalkerConnection.mock
            .calls[0][0] as Playlist;
        expect(persisted.username).toBeUndefined();
        expect(persisted.password).toBeUndefined();
        expect(
            playlists.persistStalkerConnection.mock.calls[0][1]
        ).toEqual({ clearCredentials: true });
    });

    it('discards the active credential challenge when the dialog is explicitly cancelled', async () => {
        const credentials: StalkerSessionConnectionOutcome = {
            attemptNumber: 1,
            attemptRef: 'attempt-credentials-cancelled',
            challengeRef: 'challenge-credentials-cancelled',
            kind: 'credentials-required',
            requestId: 'request-credentials-cancelled',
        };
        session.open.mockResolvedValueOnce(credentials);
        queuedDialogResults.push(null);

        await expect(
            service.ensureConnected(LEGACY_PLAYLIST)
        ).resolves.toBeUndefined();

        expect(session.discard).toHaveBeenCalledWith(
            'attempt-credentials-cancelled'
        );
        expect(playlists.persistStalkerConnection).not.toHaveBeenCalled();
    });

    it('consumes a rejected origin challenge without persisting anything', async () => {
        const origin: StalkerSessionConnectionOutcome = {
            attemptRef: 'attempt-origin-rejected',
            challengeRef: 'challenge-origin-rejected',
            finalOrigin: 'https://other.example',
            kind: 'origin-approval-required',
            requestId: 'request-origin-rejected',
            sourceOrigin: 'https://source.example',
        };
        session.open.mockResolvedValue(origin);
        session.continue.mockResolvedValue({
            kind: 'failure',
            reason: 'origin-not-approved',
            requestId: 'request-origin-rejected-result',
            retryable: false,
            stage: 'awaiting-origin-approval',
        });
        queuedDialogResults.push(false);

        await expect(
            service.ensureConnected(LEGACY_PLAYLIST)
        ).resolves.toBeUndefined();

        expect(session.continue).toHaveBeenCalledWith(LEGACY_PLAYLIST._id, {
            challengeRef: 'challenge-origin-rejected',
            response: {
                approved: false,
                kind: 'origin-approval',
            },
        });
        expect(playlists.persistStalkerConnection).not.toHaveBeenCalled();
    });

    it('retains a ready attempt after a local write failure and retries the same draft', async () => {
        session.open.mockResolvedValue(READY);
        playlists.persistStalkerConnection.mockReturnValueOnce(
            throwError(() => new Error('disk-full'))
        );

        await expect(
            service.ensureConnected(LEGACY_PLAYLIST)
        ).resolves.toBeUndefined();
        expect(session.commit).not.toHaveBeenCalled();

        playlists.persistStalkerConnection.mockImplementationOnce(
            (playlist: Playlist) => of(playlist)
        );
        const connected = await service.retryPendingPersistence();

        expect(playlists.persistStalkerConnection).toHaveBeenCalledTimes(2);
        expect(session.commit).toHaveBeenCalledWith('attempt-route-1');
        expect(connected).toMatchObject({
            stalkerRequestRecipe: 'full-session',
        });
    });

    it('discards a ready attempt when navigation abandons persistence retry', async () => {
        session.open.mockResolvedValue(READY);
        playlists.persistStalkerConnection.mockReturnValue(
            throwError(() => new Error('disk-full'))
        );
        await service.ensureConnected(LEGACY_PLAYLIST);

        await service.cancel();

        expect(session.discard).toHaveBeenCalledWith('attempt-route-1');
    });

    it('closes a committed lease when cancellation wins during commit', async () => {
        const commit = createDeferred<typeof CONTROL_SUCCESS>();
        session.forceRedetect.mockResolvedValueOnce(READY);
        session.commit.mockReturnValueOnce(commit.promise);
        const emitted = jest.fn();
        service.connectionReady$.subscribe(emitted);

        const connecting = service.forceRedetect(LEGACY_PLAYLIST);
        await flushPromises();
        expect(session.commit).toHaveBeenCalledWith('attempt-route-1');

        await service.cancel();
        commit.resolve(CONTROL_SUCCESS);

        await expect(connecting).resolves.toBeUndefined();
        expect(session.close).toHaveBeenCalledWith('lease-route-1');
        expect(emitted).not.toHaveBeenCalled();
    });

    it('reopens the persisted connection after discarding a rejected promotion', async () => {
        session.open
            .mockResolvedValueOnce(READY)
            .mockResolvedValueOnce(PERSISTED_READY);
        session.commit.mockRejectedValueOnce(new Error('promotion-failed'));

        const connected = await service.ensureConnected(LEGACY_PLAYLIST);

        expect(session.discard).toHaveBeenCalledWith('attempt-route-1');
        expect(session.open).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                portalUrl:
                    'https://portal.example/stalker_portal/server/load.php',
                stalkerRequestRecipe: 'full-session',
            })
        );
        expect(connected).toMatchObject({
            portalUrl: 'https://portal.example/stalker_portal/server/load.php',
            stalkerRequestRecipe: 'full-session',
        });
    });

    it('discards a provisional ready outcome that arrives after cancellation of open', async () => {
        const deferredOpen = createDeferred<StalkerSessionConnectionOutcome>();
        session.open.mockReturnValueOnce(deferredOpen.promise);

        const connecting = service.ensureConnected(LEGACY_PLAYLIST);
        await flushPromises();
        expect(session.open).toHaveBeenCalledTimes(1);

        await service.cancel();
        deferredOpen.resolve(READY);

        await expect(connecting).resolves.toBeUndefined();
        expect(session.discard).toHaveBeenCalledWith('attempt-route-1');
        expect(playlists.persistStalkerConnection).not.toHaveBeenCalled();
    });

    it('discards a provisional ready outcome that arrives after cancellation of continue', async () => {
        const credentials: StalkerSessionConnectionOutcome = {
            attemptNumber: 1,
            attemptRef: 'attempt-route-1',
            challengeRef: 'challenge-late-ready',
            kind: 'credentials-required',
            requestId: 'request-late-ready',
        };
        const deferredContinue =
            createDeferred<StalkerSessionConnectionOutcome>();
        session.open.mockResolvedValueOnce(credentials);
        session.continue.mockReturnValueOnce(deferredContinue.promise);
        queuedDialogResults.push({
            password: 'password',
            username: 'user',
        });

        const connecting = service.ensureConnected(LEGACY_PLAYLIST);
        await flushPromises();
        expect(session.continue).toHaveBeenCalledTimes(1);

        await service.cancel();
        deferredContinue.resolve(READY);

        await expect(connecting).resolves.toBeUndefined();
        expect(session.discard).toHaveBeenCalledWith('attempt-route-1');
        expect(playlists.persistStalkerConnection).not.toHaveBeenCalled();
    });

    it('discards an origin challenge attempt when cancellation closes its active dialog', async () => {
        const origin: StalkerSessionConnectionOutcome = {
            attemptRef: 'attempt-origin-dialog',
            challengeRef: 'challenge-origin-dialog',
            finalOrigin: 'https://portal.example',
            kind: 'origin-approval-required',
            requestId: 'request-origin-dialog',
            sourceOrigin: 'https://source.example',
        };
        const dialogRef = createClosableDialogRef();
        session.open.mockResolvedValueOnce(origin);
        dialog.open.mockReturnValueOnce(dialogRef);

        const connecting = service.ensureConnected(LEGACY_PLAYLIST);
        await flushPromises();
        expect(dialog.open).toHaveBeenCalledTimes(1);

        await service.cancel();
        await expect(connecting).resolves.toBeUndefined();

        expect(dialogRef.close).toHaveBeenCalledTimes(1);
        expect(session.discard).toHaveBeenCalledWith('attempt-origin-dialog');
    });

    it('discards a credential challenge attempt when cancellation closes its active dialog', async () => {
        const credentials: StalkerSessionConnectionOutcome = {
            attemptNumber: 1,
            attemptRef: 'attempt-credentials-dialog',
            challengeRef: 'challenge-credentials-dialog',
            kind: 'credentials-required',
            requestId: 'request-credentials-dialog',
        };
        const dialogRef = createClosableDialogRef();
        session.open.mockResolvedValueOnce(credentials);
        dialog.open.mockReturnValueOnce(dialogRef);

        const connecting = service.ensureConnected(LEGACY_PLAYLIST);
        await flushPromises();
        expect(dialog.open).toHaveBeenCalledTimes(1);

        await service.cancel();
        await expect(connecting).resolves.toBeUndefined();

        expect(dialogRef.close).toHaveBeenCalledTimes(1);
        expect(session.discard).toHaveBeenCalledWith(
            'attempt-credentials-dialog'
        );
    });

    it('reclassifies a current stateless recipe for a sanitized endpoint-shape recovery request', async () => {
        const simple = {
            ...LEGACY_PLAYLIST,
            isFullStalkerPortal: false,
            stalkerRecipeClassifierVersion: 1,
            stalkerRequestRecipe: 'stateless-mac' as const,
        };
        session.open.mockResolvedValue(READY);
        const handler = session.recoveryHandler();
        expect(handler).toBeDefined();

        await expect(
            handler?.({
                playlist: simple,
                trigger: 'endpoint-shape',
            })
        ).resolves.toMatchObject({
            portalUrl:
                'https://portal.example/stalker_portal/server/load.php',
            stalkerRequestRecipe: 'full-session',
        });

        expect(session.open).toHaveBeenCalledWith(simple, {
            connectionMode: 'provisional',
            provisionalReason: 'migration',
        });
        expect(session.commit).toHaveBeenCalledWith('attempt-route-1');
    });

    it('opens a provisional replacement for a principal transition and enables one facade reissue', async () => {
        session.open.mockResolvedValue(READY);
        const handler = session.recoveryHandler();
        expect(handler).toBeDefined();

        await expect(
            handler?.({
                outcome: {
                    kind: 'failure',
                    reason: 'principal-transition-required',
                    requestId: 'request-principal-transition',
                    retryable: false,
                    stage: 'refreshing',
                },
                playlist: LEGACY_PLAYLIST,
                trigger: 'request',
            })
        ).resolves.toMatchObject({
            stalkerRequestRecipe: 'full-session',
        });

        expect(session.open).toHaveBeenCalledWith(LEGACY_PLAYLIST, {
            connectionMode: 'provisional',
            provisionalReason: 'migration',
        });
        expect(session.commit).toHaveBeenCalledWith('attempt-route-1');
    });

    it('routes force-redetect through the active lease and handles its challenge', async () => {
        const credentials: StalkerSessionConnectionOutcome = {
            attemptNumber: 1,
            attemptRef: 'attempt-force-redetect',
            challengeRef: 'challenge-force-redetect',
            kind: 'credentials-required',
            requestId: 'request-force-redetect',
        };
        session.forceRedetect.mockResolvedValue(credentials);
        session.continue.mockResolvedValue(READY);
        queuedDialogResults.push({
            password: 'password',
            username: 'user',
        });

        await expect(
            service.forceRedetect(LEGACY_PLAYLIST)
        ).resolves.toMatchObject({
            stalkerRequestRecipe: 'full-session',
        });

        expect(session.forceRedetect).toHaveBeenCalledWith('lease-route-1');
    });

    it('lets Test Connection reclassify an explicitly simple record', async () => {
        session.getLeaseRef.mockReturnValueOnce(undefined);
        session.open.mockResolvedValue(READY);

        await expect(
            service.forceRedetect({
                ...LEGACY_PLAYLIST,
                isFullStalkerPortal: false,
                stalkerRequestRecipe: 'stateless-mac',
            })
        ).resolves.toMatchObject({
            isFullStalkerPortal: true,
            stalkerRequestRecipe: 'full-session',
        });

        expect(session.open).toHaveBeenCalledWith(
            expect.objectContaining({
                isFullStalkerPortal: false,
            }),
            {
                connectionMode: 'provisional',
                provisionalReason: 'migration',
            }
        );
    });
});

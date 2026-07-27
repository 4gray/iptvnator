import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { StalkerSessionService } from '@iptvnator/portal/stalker/data-access';
import { PlaylistsService } from '@iptvnator/services';
import type {
    Playlist,
    StalkerSessionConnectionOutcome,
    StalkerSessionFullReadyOutcome,
} from '@iptvnator/shared/interfaces';
import { of, throwError } from 'rxjs';
import { StalkerPortalImportComponent } from './stalker-portal-import.component';

const READY_OUTCOME: StalkerSessionFullReadyOutcome = {
    accountSummary: {
        expiresAt: '2027-07-27T00:00:00.000Z',
        name: 'subscriber',
        status: 'active',
        tariffPlan: 'Premium',
    },
    attemptRef: 'attempt-import-1',
    capabilities: {
        authenticatedSession: true,
        playbackContext: true,
    },
    connectionMode: 'provisional',
    endpoint: 'https://portal.example/stalker_portal/server/load.php',
    kind: 'ready',
    landingUrl: 'https://portal.example/stalker_portal/c/',
    leaseRef: 'lease-import-1',
    persistenceDraft: {
        isFullStalkerPortal: true,
        portalUrl: 'https://portal.example/stalker_portal/server/load.php',
        stalkerLandingUrl: 'https://portal.example/stalker_portal/c/',
        stalkerLastVerifiedAt: '2026-07-27T12:00:00.000Z',
        stalkerRecipeClassifierVersion: 1,
        stalkerRequestRecipe: 'full-session',
        stalkerSourceUrl: 'https://portal.example/stalker_portal/c',
    },
    provisionalReason: 'import',
    recipe: 'full-session',
    requestId: 'request-ready-1',
};

const CONTROL_SUCCESS = {
    action: 'commit' as const,
    kind: 'success' as const,
    requestId: 'request-commit-1',
};

function deferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
} {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((currentResolve) => {
        resolve = currentResolve;
    });
    return { promise, resolve };
}

describe('StalkerPortalImportComponent', () => {
    let component: StalkerPortalImportComponent;
    let session: {
        open: jest.Mock;
        continue: jest.Mock;
        commit: jest.Mock;
        discard: jest.Mock;
    };
    let playlists: {
        persistStalkerConnection: jest.Mock;
    };
    let store: { dispatch: jest.Mock };

    beforeEach(() => {
        session = {
            open: jest.fn().mockResolvedValue(READY_OUTCOME),
            continue: jest.fn(),
            commit: jest.fn().mockResolvedValue(CONTROL_SUCCESS),
            discard: jest.fn().mockResolvedValue({
                action: 'discard',
                kind: 'success',
                requestId: 'request-discard-1',
            }),
        };
        playlists = {
            persistStalkerConnection: jest.fn((playlist: Playlist) =>
                of(playlist)
            ),
        };
        store = {
            dispatch: jest.fn(),
        };

        TestBed.configureTestingModule({
            providers: [
                { provide: StalkerSessionService, useValue: session },
                { provide: PlaylistsService, useValue: playlists },
                { provide: Store, useValue: store },
                {
                    provide: MatSnackBar,
                    useValue: { open: jest.fn() },
                },
                {
                    provide: TranslateService,
                    useValue: { instant: jest.fn((value: string) => value) },
                },
            ],
        });

        component = TestBed.runInInjectionContext(
            () => new StalkerPortalImportComponent()
        );
        setValidForm();
    });

    it('does not persist a playlist before the portal reaches ready', async () => {
        const open = deferred<StalkerSessionConnectionOutcome>();
        session.open.mockReturnValueOnce(open.promise);

        const add = component.addPlaylist();
        await Promise.resolve();

        expect(component.connectionStage()).toBe('resolving');
        expect(playlists.persistStalkerConnection).not.toHaveBeenCalled();
        expect(session.commit).not.toHaveBeenCalled();
        expect(store.dispatch).not.toHaveBeenCalled();

        open.resolve(READY_OUTCOME);
        await add;

        expect(playlists.persistStalkerConnection).toHaveBeenCalledTimes(1);
    });

    it('persists the complete verified draft before commit and only then reports connected', async () => {
        component.form.patchValue({
            serialNumber: '  CUSTOMSN123  ',
            deviceId1: '  DEVICE-ID-1  ',
            deviceId2: '  DEVICE-ID-2  ',
            signature1: '  SIGNATURE-1  ',
            signature2: '  SIGNATURE-2  ',
            userAgent: '  Custom Portal Agent  ',
        });

        await component.addPlaylist();

        expect(session.open).toHaveBeenCalledWith(
            expect.objectContaining({
                _id: 'playlist-1',
                macAddress: '00:1A:79:AA:BB:CC',
                stalkerIdentityOverrides: {
                    deviceId1: 'DEVICE-ID-1',
                    deviceId2: 'DEVICE-ID-2',
                    serialNumber: 'CUSTOMSN123',
                    signature1: 'SIGNATURE-1',
                    signature2: 'SIGNATURE-2',
                },
                stalkerProfilePreset: {
                    id: 'mag250-public-5_1-minimal-v1',
                    version: 1,
                },
                stalkerSourceUrl: 'https://portal.example/stalker_portal/c',
                stalkerTransportConfiguration: {
                    userAgent: 'Custom Portal Agent',
                },
            }),
            {
                connectionMode: 'provisional',
                provisionalReason: 'import',
            }
        );

        const persisted = playlists.persistStalkerConnection.mock
            .calls[0][0] as Playlist;
        expect(persisted).toEqual(
            expect.objectContaining({
                _id: 'playlist-1',
                isFullStalkerPortal: true,
                portalUrl:
                    'https://portal.example/stalker_portal/server/load.php',
                stalkerLandingUrl: 'https://portal.example/stalker_portal/c/',
                stalkerRequestRecipe: 'full-session',
                stalkerSourceUrl: 'https://portal.example/stalker_portal/c',
                stalkerLastVerifiedAt: '2026-07-27T12:00:00.000Z',
                stalkerAccountInfo: {
                    expireDate: 1816646400,
                    login: 'subscriber',
                    status: 'active',
                    tariffPlanName: 'Premium',
                },
            })
        );
        expect(persisted).not.toHaveProperty('stalkerToken');
        expect(
            playlists.persistStalkerConnection.mock.invocationCallOrder[0]
        ).toBeLessThan(session.commit.mock.invocationCallOrder[0]);
        expect(session.commit).toHaveBeenCalledWith('attempt-import-1');
        expect(store.dispatch).toHaveBeenCalledWith(
            PlaylistActions.stalkerConnectionPersisted({
                playlist: persisted,
            })
        );
        expect(component.connectionStage()).toBe('connected');
        expect(component.addClicked.emit).toHaveBeenCalledTimes(1);
    });

    it('shows exact cross-origin approval and continues the same challenge', async () => {
        session.open.mockResolvedValueOnce({
            challengeRef: 'challenge-origin-1',
            finalOrigin: 'https://redirected.example',
            kind: 'origin-approval-required',
            requestId: 'request-origin-1',
            sourceOrigin: 'https://portal.example',
        });
        session.continue.mockResolvedValueOnce({
            ...READY_OUTCOME,
            requestId: 'request-ready-after-origin',
        });

        await component.addPlaylist();

        expect(component.connectionStage()).toBe('awaiting-origin-approval');
        expect(component.pendingOriginApproval()).toEqual({
            sourceOrigin: 'https://portal.example',
            finalOrigin: 'https://redirected.example',
        });
        expect(playlists.persistStalkerConnection).not.toHaveBeenCalled();

        await component.respondToOriginApproval(true);

        expect(session.continue).toHaveBeenCalledWith('playlist-1', {
            challengeRef: 'challenge-origin-1',
            response: {
                approved: true,
                kind: 'origin-approval',
            },
        });
        expect(component.connectionStage()).toBe('connected');
    });

    it('reveals credentials only after status 2 and persists only accepted values', async () => {
        session.open.mockResolvedValueOnce({
            attemptNumber: 1,
            challengeRef: 'challenge-credentials-1',
            kind: 'credentials-required',
            requestId: 'request-credentials-1',
        });
        session.continue.mockResolvedValueOnce(READY_OUTCOME);

        await component.addPlaylist();

        expect(component.connectionStage()).toBe('credentials-required');
        expect(component.credentialsRequested()).toBe(true);
        expect(playlists.persistStalkerConnection).not.toHaveBeenCalled();

        component.form.patchValue({
            password: 'accepted-password',
            username: 'accepted-user',
        });
        await component.submitCredentials();

        expect(session.continue).toHaveBeenCalledWith('playlist-1', {
            challengeRef: 'challenge-credentials-1',
            response: {
                kind: 'credentials',
                password: 'accepted-password',
                username: 'accepted-user',
            },
        });
        expect(playlists.persistStalkerConnection.mock.calls[0][0]).toEqual(
            expect.objectContaining({
                password: 'accepted-password',
                username: 'accepted-user',
            })
        );
        expect(component.connectionStage()).toBe('connected');
    });

    it('retains form values after rejected credentials without overwriting storage', async () => {
        session.open.mockResolvedValueOnce({
            attemptNumber: 1,
            challengeRef: 'challenge-credentials-1',
            kind: 'credentials-required',
            requestId: 'request-credentials-1',
        });
        session.continue.mockResolvedValueOnce({
            attemptNumber: 2,
            challengeRef: 'challenge-credentials-2',
            kind: 'credentials-required',
            requestId: 'request-credentials-2',
            savedCredentialsRejected: true,
        });

        await component.addPlaylist();
        component.form.patchValue({
            password: 'replacement-password',
            username: 'replacement-user',
        });
        await component.submitCredentials();

        expect(component.connectionStage()).toBe('credentials-required');
        expect(component.savedCredentialsRejected()).toBe(true);
        expect(component.form.controls.username.value).toBe('replacement-user');
        expect(component.form.controls.password.value).toBe(
            'replacement-password'
        );
        expect(playlists.persistStalkerConnection).not.toHaveBeenCalled();
        expect(session.commit).not.toHaveBeenCalled();
    });

    it('keeps a ready provisional attempt for Save Again after a local write failure', async () => {
        playlists.persistStalkerConnection
            .mockReturnValueOnce(throwError(() => new Error('disk-full')))
            .mockImplementationOnce((playlist: Playlist) => of(playlist));

        await component.addPlaylist();

        expect(component.connectionStage()).toBe('persistence-failed');
        expect(component.failureReason()).toBe('local-persistence-failed');
        expect(session.commit).not.toHaveBeenCalled();
        expect(session.discard).not.toHaveBeenCalled();
        expect(component.addClicked.emit).not.toHaveBeenCalled();

        await component.saveAgain();

        expect(playlists.persistStalkerConnection).toHaveBeenCalledTimes(2);
        expect(session.commit).toHaveBeenCalledWith('attempt-import-1');
        expect(component.connectionStage()).toBe('connected');
    });

    it('does not mislabel a promotion failure as a retryable persistence failure', async () => {
        session.commit.mockRejectedValueOnce(new Error('promotion-failed'));

        await component.addPlaylist();

        expect(playlists.persistStalkerConnection).toHaveBeenCalledTimes(1);
        expect(session.discard).toHaveBeenCalledWith('attempt-import-1');
        expect(component.connectionStage()).toBe('failure');
        expect(component.failureReason()).toBe('session-promotion-failed');
        expect(component.addClicked.emit).not.toHaveBeenCalled();

        await component.saveAgain();
        expect(playlists.persistStalkerConnection).toHaveBeenCalledTimes(1);
    });

    it('omits blank optional identity, transport, and credential values', async () => {
        component.form.patchValue({
            deviceId1: '  ',
            deviceId2: '',
            password: '',
            serialNumber: ' ',
            signature1: '',
            signature2: '  ',
            userAgent: ' ',
            username: '',
        });

        await component.addPlaylist();

        const openingPlaylist = session.open.mock.calls[0][0] as Playlist;
        const persisted = playlists.persistStalkerConnection.mock
            .calls[0][0] as Playlist;
        expect(openingPlaylist.stalkerIdentityOverrides).toBeUndefined();
        expect(openingPlaylist.stalkerTransportConfiguration).toBeUndefined();
        expect(persisted.username).toBeUndefined();
        expect(persisted.password).toBeUndefined();
        expect(persisted.stalkerSerialNumber).toBeUndefined();
        expect(persisted.stalkerDeviceId1).toBeUndefined();
        expect(persisted.stalkerSignature1).toBeUndefined();
    });

    it('discards an uncommitted ready attempt when the form is cleared', async () => {
        playlists.persistStalkerConnection.mockReturnValueOnce(
            throwError(() => new Error('disk-full'))
        );
        await component.addPlaylist();

        component.clearForm();
        await Promise.resolve();

        expect(session.discard).toHaveBeenCalledWith('attempt-import-1');
        expect(component.connectionStage()).toBe('idle');
    });

    function setValidForm(): void {
        component.form.patchValue({
            _id: 'playlist-1',
            importDate: '2026-07-27T00:00:00.000Z',
            macAddress: '00:1A:79:AA:BB:CC',
            portalUrl: 'https://portal.example/stalker_portal/c',
            title: 'Strict Portal',
        });
        jest.spyOn(component.addClicked, 'emit');
    }
});

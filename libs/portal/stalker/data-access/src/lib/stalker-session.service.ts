import { Injectable, InjectionToken, inject } from '@angular/core';
import {
    LEGACY_DEFAULT_STALKER_SERIAL,
    type ElectronBridgeApi,
    type Playlist,
    type StalkerSessionApplicationOperation,
    type StalkerSessionAttemptRef,
    type StalkerSessionConnectionOutcome,
    type StalkerSessionContinueRequest,
    type StalkerSessionControlOutcome,
    type StalkerSessionControlRequest,
    type StalkerSessionLeaseRef,
    type StalkerSessionRequest,
    type StalkerSessionRequestOutcome,
} from '@iptvnator/shared/interfaces';
import {
    type StalkerAdaptedRequest,
    adaptLegacyStalkerRequest,
    mapStalkerSessionResultToLegacyResponse,
} from './stalker-request-adapter';
import {
    mapPlaylistToStalkerSessionConnection,
    type StalkerSavedCredentials,
    type StalkerSessionDescriptorMappingOptions as LocalStalkerSessionDescriptorMappingOptions,
} from './stalker-session-descriptor';

export {
    getStalkerPortalIdentityFromPlaylist,
    normalizeStalkerPortalIdentity,
} from './stalker-identity.utils';
export type { StalkerPortalIdentity } from './stalker-identity.utils';
export const STALKER_SERIAL_NUMBER = LEGACY_DEFAULT_STALKER_SERIAL;

type SessionBridgeMethod =
    | 'stalkerSessionContinue'
    | 'stalkerSessionControl'
    | 'stalkerSessionOpen'
    | 'stalkerSessionRequest';

export type StalkerSessionBridge = Required<
    Pick<ElectronBridgeApi, SessionBridgeMethod>
>;

export const STALKER_SESSION_BRIDGE = new InjectionToken<
    StalkerSessionBridge | undefined
>('STALKER_SESSION_BRIDGE', {
    factory: resolveStalkerSessionBridge,
    providedIn: 'root',
});

export type StalkerSessionNonSuccessOutcome =
    | StalkerSessionConnectionOutcome
    | Exclude<
          StalkerSessionRequestOutcome<StalkerSessionApplicationOperation>,
          { kind: 'success' }
      >;

export interface StalkerSessionRecoveryRequest {
    readonly playlist: Playlist;
    readonly outcome: StalkerSessionNonSuccessOutcome;
    readonly trigger: 'open' | 'request';
}

export type StalkerSessionRecoveryHandler = (
    request: StalkerSessionRecoveryRequest
) => Promise<boolean>;

export class StalkerSessionOutcomeError extends Error {
    constructor(readonly outcome: StalkerSessionNonSuccessOutcome) {
        super(`stalker-session-outcome:${outcome.kind}`);
        this.name = 'StalkerSessionOutcomeError';
    }
}

/**
 * Renderer facade for main-owned Stalker sessions.
 *
 * The only retained session state is the association between a playlist row and
 * an opaque main-process lease. Protocol state, credentials, cookies, refresh
 * work, playback headers, and bearer material are never retained here.
 */
@Injectable({
    providedIn: 'root',
})
export class StalkerSessionService {
    private readonly bridge = inject(STALKER_SESSION_BRIDGE);
    private readonly leaseByPlaylistRef = new Map<
        string,
        StalkerSessionLeaseRef
    >();
    private readonly playlistRefByLease = new Map<
        StalkerSessionLeaseRef,
        string
    >();
    private readonly provisionalByAttemptRef = new Map<
        StalkerSessionAttemptRef,
        {
            readonly leaseRef: StalkerSessionLeaseRef;
            readonly playlistRef: string;
        }
    >();
    private readonly attemptRefByProvisionalLease = new Map<
        StalkerSessionLeaseRef,
        StalkerSessionAttemptRef
    >();
    private readonly openByPlaylistRef = new Map<
        string,
        Promise<StalkerSessionConnectionOutcome>
    >();
    private readonly recoveryByPlaylistRef = new Map<
        string,
        Promise<boolean>
    >();
    private recoveryHandler: StalkerSessionRecoveryHandler | undefined;

    supportsTypedSessions(): boolean {
        return this.bridge !== undefined;
    }

    isFullStalkerPortal(url: string): boolean {
        return (
            url.includes('/stalker_portal/') || url.includes('/server/load.php')
        );
    }

    getLeaseRef(playlistRef: string): StalkerSessionLeaseRef | undefined {
        return this.leaseByPlaylistRef.get(playlistRef);
    }

    registerRecoveryHandler(
        handler: StalkerSessionRecoveryHandler
    ): () => void {
        this.recoveryHandler = handler;
        return () => {
            if (this.recoveryHandler === handler) {
                this.recoveryHandler = undefined;
            }
        };
    }

    async open(
        playlist: Playlist,
        options: LocalStalkerSessionDescriptorMappingOptions = {}
    ): Promise<StalkerSessionConnectionOutcome> {
        const { descriptor, savedCredentials } =
            mapPlaylistToStalkerSessionConnection(playlist, options);
        const tracksPersistedOpen =
            descriptor.connectionMode === 'persisted-open';
        if (tracksPersistedOpen) {
            const pending = this.openByPlaylistRef.get(descriptor.playlistRef);
            if (pending !== undefined) {
                return pending;
            }
        }

        const bridge = this.requireBridge();
        const request = this.openWithSavedCredentials(
            bridge,
            { descriptor },
            savedCredentials
        );
        if (tracksPersistedOpen) {
            this.openByPlaylistRef.set(descriptor.playlistRef, request);
        }
        try {
            const outcome = await request;
            this.rememberConnectionOutcome(descriptor.playlistRef, outcome);
            return outcome;
        } finally {
            if (
                tracksPersistedOpen &&
                this.openByPlaylistRef.get(descriptor.playlistRef) === request
            ) {
                this.openByPlaylistRef.delete(descriptor.playlistRef);
            }
        }
    }

    async continue(
        playlistRef: string,
        request: StalkerSessionContinueRequest
    ): Promise<StalkerSessionConnectionOutcome> {
        const outcome =
            await this.requireBridge().stalkerSessionContinue(request);
        this.rememberConnectionOutcome(playlistRef, outcome);
        return outcome;
    }

    request<Operation extends StalkerSessionApplicationOperation>(
        request: StalkerSessionRequest<Operation>
    ): Promise<StalkerSessionRequestOutcome<Operation>> {
        return this.requireBridge().stalkerSessionRequest(request);
    }

    async control(
        request: StalkerSessionControlRequest
    ): Promise<StalkerSessionControlOutcome> {
        const playlistRef =
            'leaseRef' in request
                ? this.playlistRefByLease.get(request.leaseRef)
                : undefined;
        const provisional =
            'attemptRef' in request
                ? this.provisionalByAttemptRef.get(request.attemptRef)
                : undefined;
        const outcome =
            await this.requireBridge().stalkerSessionControl(request);

        if (outcome.kind === 'success' && request.action === 'close') {
            this.forgetLease(request.leaseRef);
            this.forgetProvisionalLease(request.leaseRef);
        } else if (
            outcome.kind === 'success' &&
            request.action === 'commit' &&
            provisional !== undefined
        ) {
            this.rememberLease(provisional.playlistRef, provisional.leaseRef);
            this.forgetProvisionalAttempt(request.attemptRef);
        } else if (outcome.kind === 'success' && request.action === 'discard') {
            this.forgetProvisionalAttempt(request.attemptRef);
        } else if (playlistRef !== undefined && outcome.kind === 'ready') {
            this.rememberConnectionOutcome(playlistRef, outcome);
        } else if (provisional !== undefined && outcome.kind === 'ready') {
            this.rememberConnectionOutcome(provisional.playlistRef, outcome);
        }

        return outcome;
    }

    activate(
        leaseRef: StalkerSessionLeaseRef
    ): Promise<StalkerSessionControlOutcome> {
        return this.control({
            action: 'activate',
            leaseRef,
        });
    }

    deactivate(
        leaseRef: StalkerSessionLeaseRef
    ): Promise<StalkerSessionControlOutcome> {
        return this.control({
            action: 'deactivate',
            leaseRef,
        });
    }

    close(
        leaseRef: StalkerSessionLeaseRef
    ): Promise<StalkerSessionControlOutcome> {
        return this.control({
            action: 'close',
            leaseRef,
        });
    }

    forceRedetect(
        leaseRef: StalkerSessionLeaseRef
    ): Promise<StalkerSessionControlOutcome> {
        return this.control({
            action: 'force-redetect',
            leaseRef,
        });
    }

    commit(
        attemptRef: StalkerSessionAttemptRef
    ): Promise<StalkerSessionControlOutcome> {
        return this.control({
            action: 'commit',
            attemptRef,
        });
    }

    discard(
        attemptRef: StalkerSessionAttemptRef
    ): Promise<StalkerSessionControlOutcome> {
        return this.control({
            action: 'discard',
            attemptRef,
        });
    }

    /**
     * Temporary application-call compatibility seam.
     *
     * Existing callers may keep their raw catalog request shape while the
     * adapter converts it to an allowlisted operation. This method never sends
     * those raw parameters to Electron and never performs renderer-side auth.
     */
    async makeAuthenticatedRequest<T>(
        playlist: Playlist,
        parameters: Readonly<Record<string, string | number>>
    ): Promise<T> {
        const adapted = adaptLegacyStalkerRequest(parameters);
        const leaseRef = await this.resolveLease(playlist);
        const result = await this.executeAdaptedRequest(
            playlist,
            leaseRef,
            adapted
        );
        return result as T;
    }

    private async resolveLease(
        playlist: Playlist
    ): Promise<StalkerSessionLeaseRef> {
        const retained = this.getLeaseRef(playlist._id);
        if (retained !== undefined) {
            return retained;
        }

        const outcome = await this.open(playlist);
        if (outcome.kind !== 'ready' || outcome.recipe !== 'full-session') {
            if (
                this.isRecoverable(outcome) &&
                (await this.recover(playlist, outcome, 'open'))
            ) {
                const recoveredLease = this.getLeaseRef(playlist._id);
                if (recoveredLease !== undefined) {
                    return recoveredLease;
                }
            }
            throw new StalkerSessionOutcomeError(outcome);
        }
        return outcome.leaseRef;
    }

    private async openWithSavedCredentials(
        bridge: StalkerSessionBridge,
        request: Parameters<StalkerSessionBridge['stalkerSessionOpen']>[0],
        savedCredentials: StalkerSavedCredentials | undefined
    ): Promise<StalkerSessionConnectionOutcome> {
        const outcome = await bridge.stalkerSessionOpen(request);
        if (
            outcome.kind !== 'credentials-required' ||
            outcome.savedCredentialsRejected === true ||
            savedCredentials === undefined
        ) {
            return outcome;
        }
        return bridge.stalkerSessionContinue({
            challengeRef: outcome.challengeRef,
            response: {
                kind: 'credentials',
                password: savedCredentials.password,
                username: savedCredentials.username,
            },
        });
    }

    private async executeAdaptedRequest(
        playlist: Playlist,
        leaseRef: StalkerSessionLeaseRef,
        adaptedRequest: StalkerAdaptedRequest
    ): Promise<unknown> {
        let outcome = await this.request({
            leaseRef,
            operation: adaptedRequest.operation,
            parameters: adaptedRequest.parameters,
        } as StalkerSessionRequest);
        if (
            outcome.kind !== 'success' &&
            this.isRecoverable(outcome) &&
            (await this.recover(playlist, outcome, 'request'))
        ) {
            const recoveredLease = this.getLeaseRef(playlist._id);
            if (recoveredLease !== undefined) {
                outcome = await this.request({
                    leaseRef: recoveredLease,
                    operation: adaptedRequest.operation,
                    parameters: adaptedRequest.parameters,
                } as StalkerSessionRequest);
            }
        }
        if (outcome.kind !== 'success') {
            throw new StalkerSessionOutcomeError(outcome);
        }
        return mapStalkerSessionResultToLegacyResponse(
            outcome.operation,
            outcome.payload
        );
    }

    private recover(
        playlist: Playlist,
        outcome: StalkerSessionNonSuccessOutcome,
        trigger: StalkerSessionRecoveryRequest['trigger']
    ): Promise<boolean> {
        const active = this.recoveryByPlaylistRef.get(playlist._id);
        if (active !== undefined) {
            return active;
        }
        const handler = this.recoveryHandler;
        if (handler === undefined) {
            return Promise.resolve(false);
        }
        const recovery = Promise.resolve(
            handler({
                outcome,
                playlist,
                trigger,
            })
        ).finally(() => {
            if (this.recoveryByPlaylistRef.get(playlist._id) === recovery) {
                this.recoveryByPlaylistRef.delete(playlist._id);
            }
        });
        this.recoveryByPlaylistRef.set(playlist._id, recovery);
        return recovery;
    }

    private isRecoverable(
        outcome: StalkerSessionNonSuccessOutcome
    ): boolean {
        return (
            outcome.kind === 'origin-approval-required' ||
            outcome.kind === 'credentials-required' ||
            (outcome.kind === 'failure' &&
                outcome.reason === 'principal-transition-required')
        );
    }

    private rememberConnectionOutcome(
        playlistRef: string,
        outcome: StalkerSessionConnectionOutcome
    ): void {
        if (outcome.kind !== 'ready') {
            return;
        }
        if (outcome.recipe !== 'full-session') {
            if (outcome.connectionMode === 'persisted-open') {
                const previousLease = this.leaseByPlaylistRef.get(playlistRef);
                if (previousLease !== undefined) {
                    this.forgetLease(previousLease);
                }
            }
            return;
        }

        if (outcome.connectionMode === 'provisional') {
            this.provisionalByAttemptRef.set(outcome.attemptRef, {
                leaseRef: outcome.leaseRef,
                playlistRef,
            });
            this.attemptRefByProvisionalLease.set(
                outcome.leaseRef,
                outcome.attemptRef
            );
            return;
        }

        this.rememberLease(playlistRef, outcome.leaseRef);
    }

    private rememberLease(
        playlistRef: string,
        leaseRef: StalkerSessionLeaseRef
    ): void {
        const previousLease = this.leaseByPlaylistRef.get(playlistRef);
        if (previousLease !== undefined && previousLease !== leaseRef) {
            this.playlistRefByLease.delete(previousLease);
        }
        this.leaseByPlaylistRef.set(playlistRef, leaseRef);
        this.playlistRefByLease.set(leaseRef, playlistRef);
    }

    private forgetLease(leaseRef: StalkerSessionLeaseRef): void {
        const playlistRef = this.playlistRefByLease.get(leaseRef);
        if (playlistRef !== undefined) {
            this.leaseByPlaylistRef.delete(playlistRef);
        }
        this.playlistRefByLease.delete(leaseRef);
    }

    private forgetProvisionalLease(leaseRef: StalkerSessionLeaseRef): void {
        const attemptRef = this.attemptRefByProvisionalLease.get(leaseRef);
        if (attemptRef !== undefined) {
            this.forgetProvisionalAttempt(attemptRef);
        }
    }

    private forgetProvisionalAttempt(
        attemptRef: StalkerSessionAttemptRef
    ): void {
        const provisional = this.provisionalByAttemptRef.get(attemptRef);
        if (provisional !== undefined) {
            this.attemptRefByProvisionalLease.delete(provisional.leaseRef);
        }
        this.provisionalByAttemptRef.delete(attemptRef);
    }

    private requireBridge(): StalkerSessionBridge {
        if (this.bridge === undefined) {
            throw new Error('stalker-session-bridge-unavailable');
        }
        return this.bridge;
    }
}

function resolveStalkerSessionBridge(): StalkerSessionBridge | undefined {
    if (typeof window === 'undefined') {
        return undefined;
    }
    const electron = (
        window as unknown as {
            electron?: ElectronBridgeApi;
        }
    ).electron;
    if (
        typeof electron?.stalkerSessionOpen !== 'function' ||
        typeof electron.stalkerSessionContinue !== 'function' ||
        typeof electron.stalkerSessionRequest !== 'function' ||
        typeof electron.stalkerSessionControl !== 'function'
    ) {
        return undefined;
    }
    return electron as StalkerSessionBridge;
}

/* eslint-disable max-lines -- Session ownership stays in one auditable main-process state machine. */
import { createHash, randomBytes } from 'node:crypto';
import {
    normalizeStalkerMacAddress,
    normalizeStalkerSourceUrl,
    serializeStalkerIdentityRevision,
    serializeStalkerPrincipalInput,
    type StalkerIdentityProfile,
    validateStalkerApplicationRequest,
} from '@iptvnator/portal/stalker/protocol';
import {
    STALKER_SESSION_APPLICATION_OPERATIONS,
    STALKER_SESSION_FAILURE_REASONS,
    type StalkerSessionAccountSummary,
    type StalkerSessionApplicationOperation,
    type StalkerSessionConnectionDescriptor,
    type StalkerSessionConnectionOutcome,
    type StalkerSessionContinueRequest,
    type StalkerSessionControlAction,
    type StalkerSessionControlOutcome,
    type StalkerSessionControlRequest,
    type StalkerSessionFailureOutcome,
    type StalkerSessionOpenRequest,
    type StalkerSessionOperationParameters,
    type StalkerSessionOperationResult,
    type StalkerSessionPersistenceDraft,
    type StalkerSessionRequest,
    type StalkerSessionRequestOutcome,
    type StalkerSessionStage,
} from '@iptvnator/shared/interfaces';
import {
    StalkerAuthSession,
    type StalkerAuthCredentials,
    type StalkerAuthenticatedRequestOutcome,
    type StalkerAuthOutcome,
    type StalkerAuthReadyOutcome,
} from './stalker-auth-session';
import {
    StalkerBaseIdentityCoordinator,
    StalkerBaseIdentityCoordinatorPool,
} from './stalker-base-identity-coordinator';
import {
    StalkerChallengeRegistry,
    type StalkerChallenge,
} from './stalker-challenge-registry';
import {
    StalkerEndpointResolver,
    type StalkerEndpointFullSessionOutcome,
    type StalkerEndpointResolverInput,
    type StalkerEndpointResolverOutcome,
    type StalkerEndpointStatelessOutcome,
} from './stalker-endpoint-resolver';
import {
    StalkerRuntimeValidationError,
    validateStalkerRuntimeInput,
} from './stalker-runtime-validation';
import type {
    StalkerTransportConfig,
    StalkerValidatedRuntimeInput,
} from './stalker-session.types';
import {
    StalkerWatchdog,
    type StalkerWatchdogActivation,
    type StalkerWatchdogDeactivation,
} from './stalker-watchdog';

const ATTEMPT_TTL_MS = 120_000;
const REFERENCE_BYTES = 32;
const MAX_REFERENCE_ATTEMPTS = 4;
const RECIPE_CLASSIFIER_VERSION = 1;

export interface StalkerPreparedPlayback {
    readonly headers: Readonly<Record<string, string>>;
    readonly streamUrl: string;
}

export interface StalkerSessionAuthLike {
    checkProfile(): Promise<StalkerAuthenticatedRequestOutcome>;
    getEndpoint(): string;
    getPrincipalKey(): string;
    hasAcceptedCredentials(): boolean;
    preparePlayback?(streamUrl: string): Promise<StalkerPreparedPlayback>;
    request(
        parameters: Readonly<Record<string, string | number>>
    ): Promise<StalkerAuthenticatedRequestOutcome>;
    start(
        savedCredentials?: StalkerAuthCredentials
    ): Promise<StalkerAuthOutcome>;
    submitCredentials(
        credentials: StalkerAuthCredentials,
        savedCredentials?: boolean
    ): Promise<StalkerAuthOutcome>;
}

export type StalkerSessionMappedOperation<
    Operation extends StalkerSessionApplicationOperation,
> =
    | {
          readonly kind: 'local';
          readonly result: StalkerSessionOperationResult<Operation>;
      }
    | {
          readonly kind: 'remote';
          readonly mapResult: (
              value: unknown
          ) => StalkerSessionOperationResult<Operation>;
          readonly parameters: Readonly<Record<string, string | number>>;
      };

export interface StalkerSessionOperationMapper {
    <Operation extends StalkerSessionApplicationOperation>(
        operation: Operation,
        parameters: StalkerSessionOperationParameters<Operation>
    ): StalkerSessionMappedOperation<Operation>;
}

export interface StalkerSessionWatchdogLike {
    activate(activation: StalkerWatchdogActivation): void;
    cleanupAll(): void;
    cleanupSession(sessionKey: string): void;
    deactivate(deactivation: StalkerWatchdogDeactivation): void;
}

export interface StalkerPlaybackContextRegistration {
    readonly authGeneration: number;
    readonly coordinatorEpoch: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly leaseRef: string;
    readonly senderId: number;
    readonly sessionKey: string;
    readonly streamUrl: string;
}

export interface StalkerSessionPlaybackContextPort {
    cleanupSender(senderId: number): void;
    clear(): void;
    invalidateAuthGeneration(sessionKey: string, authGeneration: number): void;
    invalidateCoordinatorEpoch(
        sessionKey: string,
        coordinatorEpoch: number
    ): void;
    invalidateLease(leaseRef: string): void;
    invalidateSession(sessionKey: string): void;
    register(input: StalkerPlaybackContextRegistration): string;
}

interface StalkerEndpointResolverLike {
    resolve(
        input: StalkerEndpointResolverInput
    ): Promise<StalkerEndpointResolverOutcome>;
}

export interface StalkerSessionManagerDependencies {
    readonly coordinatorPool?: StalkerBaseIdentityCoordinatorPool;
    readonly createAuthSession?: (
        resolved: StalkerEndpointFullSessionOutcome,
        transport: StalkerTransportConfig
    ) => StalkerSessionAuthLike;
    readonly createRef?: (kind: 'attempt' | 'lease' | 'request') => string;
    readonly loadSavedCredentials?: (
        descriptor: StalkerSessionConnectionDescriptor
    ) => Promise<StalkerAuthCredentials | undefined>;
    readonly mapRawOperation: StalkerSessionOperationMapper;
    readonly now?: () => number;
    readonly playbackContexts?: StalkerSessionPlaybackContextPort;
    readonly random?: (size: number) => Buffer;
    readonly resolver?: StalkerEndpointResolverLike;
    readonly watchdog?: StalkerSessionWatchdogLike;
}

interface FullReadyProgress {
    readonly accountSummary?: StalkerSessionAccountSummary;
    readonly auth: StalkerSessionAuthLike;
    readonly credentials?: StalkerAuthCredentials;
    readonly endpoint: string;
    readonly epoch: number;
    readonly identityRevision: string;
    readonly kind: 'full-ready';
    readonly landingUrl: string;
    readonly principal: string;
    readonly watchdogIntervalSeconds?: number;
}

interface CredentialsProgress {
    readonly auth: StalkerSessionAuthLike;
    readonly endpoint: string;
    readonly epoch: number;
    readonly kind: 'credentials-required';
    readonly landingUrl: string;
    readonly outcome: Extract<
        StalkerAuthOutcome,
        { kind: 'credentials-required' }
    >;
}

interface OriginProgress {
    readonly finalOrigin: string;
    readonly kind: 'origin-approval-required';
    readonly landingUrl: string;
    readonly sourceOrigin: string;
}

type AuthenticationProgress =
    | FullReadyProgress
    | CredentialsProgress
    | OriginProgress
    | StalkerEndpointStatelessOutcome
    | Extract<StalkerSessionConnectionOutcome, { kind: 'failure' }>;

interface AttemptRecord {
    approvedOrigins: Set<string>;
    auth?: StalkerSessionAuthLike;
    challengeRef?: string;
    coordinator: StalkerBaseIdentityCoordinator;
    credentialCandidate?: StalkerAuthCredentials;
    descriptor: StalkerSessionConnectionDescriptor;
    expiresAt: number;
    lastEndpoint?: string;
    lastIdentityRevision?: string;
    lastLandingUrl?: string;
    mutationEpoch?: number;
    previousSessions: Set<SessionRecord>;
    ready?: AttemptReady;
    readonly ref: string;
    resolutionSourceUrl?: string;
    readonly senderId: number;
    state: 'authenticating' | 'challenge' | 'ready';
    readonly transport: StalkerTransportConfig;
}

interface FullAttemptReady {
    readonly accountSummary?: StalkerSessionAccountSummary;
    readonly auth: StalkerSessionAuthLike;
    readonly credentials?: StalkerAuthCredentials;
    readonly endpoint: string;
    readonly epoch: number;
    readonly identityRevision: string;
    readonly key: string;
    readonly kind: 'full-session';
    readonly landingUrl: string;
    readonly leaseRef: string;
    readonly principal: string;
    readonly watchdogIntervalSeconds?: number;
}

interface StatelessAttemptReady {
    readonly endpoint: string;
    readonly kind: 'stateless-mac';
    readonly landingUrl: string;
}

type AttemptReady = FullAttemptReady | StatelessAttemptReady;

interface AttemptTombstone {
    readonly action: 'commit' | 'discard';
    readonly expiresAt: number;
    readonly playlistRef: string;
    readonly senderId: number;
}

interface LeaseRecord {
    active: boolean;
    readonly playlistRef: string;
    readonly ref: string;
    readonly senderId: number;
    session: SessionRecord;
}

type WatchdogRecoveryOutcome = Exclude<
    StalkerAuthenticatedRequestOutcome,
    { kind: 'success' } | { kind: 'token-rejected' }
>;

interface SessionRecord {
    accountSummary?: StalkerSessionAccountSummary;
    readonly activeLeases: Set<string>;
    approvedOrigins: Set<string>;
    auth: StalkerSessionAuthLike;
    credentials?: StalkerAuthCredentials;
    descriptor: StalkerSessionConnectionDescriptor;
    endpoint: string;
    epoch: number;
    generation: number;
    identityRevision: string;
    key: string;
    landingUrl: string;
    readonly leases: Set<string>;
    principal: string;
    refreshPromise?: Promise<RefreshResult>;
    resolutionSourceUrl?: string;
    readonly coordinator: StalkerBaseIdentityCoordinator;
    transport: StalkerTransportConfig;
    watchdogRecovery?: WatchdogRecoveryOutcome;
    watchdogIntervalSeconds?: number;
}

interface SessionGenerationBinding {
    readonly auth: StalkerSessionAuthLike;
    readonly epoch: number;
    readonly generation: number;
    readonly key: string;
    readonly principal: string;
    readonly session: SessionRecord;
}

type SessionRequestRunResult =
    | {
          readonly binding: SessionGenerationBinding;
          readonly kind: 'completed';
          readonly outcome: StalkerAuthenticatedRequestOutcome;
      }
    | { readonly kind: 'suspended' };

type RefreshResult =
    | { readonly kind: 'ready'; readonly session: SessionRecord }
    | {
          readonly kind: 'origin-approval-required';
          readonly progress: OriginProgress;
      }
    | {
          readonly kind: 'failure';
          readonly outcome: StalkerSessionFailureOutcome;
      };

type RefreshRequestResult =
    | Extract<SessionRequestRunResult, { kind: 'completed' }>
    | Exclude<RefreshResult, { kind: 'ready' }>
    | { readonly kind: 'suspended' };

class ProgressSignal {
    constructor(readonly progress: AuthenticationProgress) {}
}

class PrincipalTransitionSignal {}

/**
 * Main-process owner for Stalker auth generations, attempts and opaque leases.
 *
 * All secret-bearing objects are reachable only through ECMAScript private
 * fields. Public methods always project their results onto shared DTOs.
 */
export class StalkerSessionManager {
    readonly #attempts = new Map<string, AttemptRecord>();
    readonly #attemptTombstones = new Map<string, AttemptTombstone>();
    readonly #challengeRegistry: StalkerChallengeRegistry;
    readonly #coordinatorPool: StalkerBaseIdentityCoordinatorPool;
    readonly #createAuthSession: (
        resolved: StalkerEndpointFullSessionOutcome,
        transport: StalkerTransportConfig
    ) => StalkerSessionAuthLike;
    readonly #createRef: (kind: 'attempt' | 'lease' | 'request') => string;
    readonly #leases = new Map<string, LeaseRecord>();
    readonly #loadSavedCredentials:
        | ((
              descriptor: StalkerSessionConnectionDescriptor
          ) => Promise<StalkerAuthCredentials | undefined>)
        | undefined;
    readonly #mapRawOperation: StalkerSessionOperationMapper;
    readonly #now: () => number;
    readonly #playbackContexts: StalkerSessionPlaybackContextPort | undefined;
    readonly #resolver: StalkerEndpointResolverLike;
    readonly #sessions = new Map<string, SessionRecord>();
    readonly #watchdog: StalkerSessionWatchdogLike;
    #expiryCleanupPromise?: Promise<void>;
    #expiryTimer?: ReturnType<typeof setTimeout>;

    constructor(dependencies: StalkerSessionManagerDependencies) {
        this.#now = dependencies.now ?? Date.now;
        const random = dependencies.random ?? randomBytes;
        this.#createRef =
            dependencies.createRef ??
            (() => random(REFERENCE_BYTES).toString('base64url'));
        this.#challengeRegistry = new StalkerChallengeRegistry({
            now: this.#now,
            random,
        });
        this.#coordinatorPool =
            dependencies.coordinatorPool ??
            new StalkerBaseIdentityCoordinatorPool();
        this.#resolver = dependencies.resolver ?? new StalkerEndpointResolver();
        this.#createAuthSession =
            dependencies.createAuthSession ??
            ((resolved, transport) =>
                new StalkerAuthSession(resolved, transport));
        this.#loadSavedCredentials = dependencies.loadSavedCredentials;
        this.#mapRawOperation = dependencies.mapRawOperation;
        this.#playbackContexts = dependencies.playbackContexts;
        this.#watchdog =
            dependencies.watchdog ??
            new StalkerWatchdog({
                isWireActive: (target) => {
                    const session = this.#sessions.get(target.sessionKey);
                    return (
                        session !== undefined &&
                        session.principal === target.principal &&
                        session.activeLeases.size > 0 &&
                        session.coordinator.snapshot.epoch === session.epoch &&
                        session.coordinator.snapshot.activePrincipal ===
                            session.principal
                    );
                },
                joinRefresh: (target) =>
                    this.#sessions
                        .get(target.sessionKey)
                        ?.refreshPromise?.then(() => undefined),
                ping: async (target) => {
                    const session = this.#sessions.get(target.sessionKey);
                    if (!session || session.principal !== target.principal) {
                        return;
                    }
                    const binding = this.#captureBinding(session);
                    const read = await session.coordinator.runRead(
                        binding.principal,
                        binding.epoch,
                        () => binding.auth.checkProfile()
                    );
                    if (
                        read.kind !== 'completed' ||
                        !this.#isCurrentSessionBinding(binding)
                    ) {
                        return;
                    }
                    if (read.value.kind === 'success') {
                        session.watchdogRecovery = undefined;
                        return;
                    }
                    if (read.value.kind !== 'token-rejected') {
                        session.watchdogRecovery = read.value;
                        return;
                    }

                    const refreshed = await this.#refreshSession(session);
                    if (refreshed.kind === 'ready') {
                        refreshed.session.watchdogRecovery = undefined;
                    } else if (this.#isLiveSession(session)) {
                        session.watchdogRecovery =
                            refreshed.kind === 'failure'
                                ? refreshed.outcome
                                : {
                                      finalOrigin:
                                          refreshed.progress.finalOrigin,
                                      kind: 'origin-approval-required',
                                      sourceOrigin:
                                          refreshed.progress.sourceOrigin,
                                      targetUrl:
                                          refreshed.progress.landingUrl,
                                  };
                    }
                },
            });
    }

    async open(
        senderId: number,
        request: StalkerSessionOpenRequest
    ): Promise<StalkerSessionConnectionOutcome> {
        const requestId = this.#requestId();
        await this.#pruneExpired();
        if (!validSender(senderId)) {
            return failure(
                requestId,
                STALKER_SESSION_FAILURE_REASONS.InvalidIdentityInput,
                'new',
                false
            );
        }

        let validated: StalkerValidatedRuntimeInput;
        try {
            validated = validateStalkerRuntimeInput(request?.descriptor);
        } catch (error) {
            const reason =
                error instanceof StalkerRuntimeValidationError
                    ? error.reason
                    : STALKER_SESSION_FAILURE_REASONS.InvalidIdentityInput;
            return failure(requestId, reason, 'new', false);
        }

        const attempt = this.#createAttempt(senderId, validated);
        this.#attempts.set(attempt.ref, attempt);
        this.#scheduleExpiryCleanup();
        try {
            attempt.credentialCandidate = await this.#loadSavedCredentials?.(
                attempt.descriptor
            );
        } catch {
            await this.#terminateAttempt(attempt, true);
            return failure(
                requestId,
                STALKER_SESSION_FAILURE_REASONS.LocalPersistenceFailed,
                'new',
                false
            );
        }

        const progress = await this.#authenticateFresh(
            attempt,
            attempt.credentialCandidate
        );
        return this.#publishProgress(attempt, progress, requestId);
    }

    async continue(
        senderId: number,
        request: StalkerSessionContinueRequest
    ): Promise<StalkerSessionConnectionOutcome> {
        const requestId = this.#requestId();
        await this.#pruneExpired();
        if (
            !validSender(senderId) ||
            typeof request?.challengeRef !== 'string' ||
            (request.response?.kind !== 'credentials' &&
                request.response?.kind !== 'origin-approval')
        ) {
            return invalidIdentityFailure(requestId, 'awaiting-credentials');
        }

        const attempt = [...this.#attempts.values()].find(
            (candidate) => candidate.challengeRef === request.challengeRef
        );
        if (!attempt) {
            return invalidIdentityFailure(requestId, 'awaiting-credentials');
        }
        const consumed = this.#challengeRegistry.consume({
            attemptRef: attempt.ref,
            challengeRef: request.challengeRef,
            responseKind: request.response.kind,
            senderId,
        });
        if (consumed.kind !== 'consumed') {
            return invalidIdentityFailure(requestId, 'awaiting-credentials');
        }
        attempt.challengeRef = undefined;
        attempt.state = 'authenticating';

        if (
            request.response.kind === 'origin-approval' &&
            consumed.challenge.kind === 'origin-approval'
        ) {
            if (!request.response.approved) {
                await this.#terminateAttempt(attempt, true);
                return failure(
                    requestId,
                    STALKER_SESSION_FAILURE_REASONS.OriginNotApproved,
                    'awaiting-origin-approval',
                    false
                );
            }
            const resolutionSourceUrl = approvedResolutionSourceUrl(
                consumed.challenge.finalOrigin,
                consumed.challenge.landingPath
            );
            if (resolutionSourceUrl === undefined) {
                await this.#terminateAttempt(attempt, true);
                return failure(
                    requestId,
                    STALKER_SESSION_FAILURE_REASONS.InvalidIdentityInput,
                    'awaiting-origin-approval',
                    false
                );
            }
            attempt.approvedOrigins.add(consumed.challenge.finalOrigin);
            attempt.resolutionSourceUrl = resolutionSourceUrl;
            attempt.coordinator = this.#coordinatorPool.get(
                consumed.challenge.finalOrigin,
                attempt.descriptor.macAddress
            );
            const progress = await this.#authenticateFresh(
                attempt,
                attempt.credentialCandidate
            );
            return this.#publishProgress(attempt, progress, requestId);
        }

        if (
            request.response.kind === 'credentials' &&
            consumed.challenge.kind === 'credentials'
        ) {
            const credentials = {
                password: request.response.password,
                username: request.response.username,
            };
            attempt.credentialCandidate = credentials;
            const coordinatorSnapshot = attempt.coordinator.snapshot;
            const mayReuseAuth =
                attempt.auth !== undefined &&
                attempt.mutationEpoch === coordinatorSnapshot.epoch &&
                coordinatorSnapshot.activePrincipal === undefined;
            const progress = mayReuseAuth
                ? await this.#submitCredentials(attempt, credentials)
                : await this.#authenticateFresh(attempt, credentials);
            return this.#publishProgress(attempt, progress, requestId);
        }

        await this.#terminateAttempt(attempt, true);
        return invalidIdentityFailure(requestId, 'awaiting-credentials');
    }

    async request<Operation extends StalkerSessionApplicationOperation>(
        senderId: number,
        request: StalkerSessionRequest<Operation>
    ): Promise<StalkerSessionRequestOutcome<Operation>> {
        const requestId = this.#requestId();
        await this.#pruneExpired();
        const lease = this.#ownedLease(senderId, request?.leaseRef);
        if (!lease) {
            return invalidIdentityFailure(
                requestId,
                'ready'
            ) as StalkerSessionRequestOutcome<Operation>;
        }

        let policy: ReturnType<typeof validateStalkerApplicationRequest>;
        try {
            policy = validateStalkerApplicationRequest({
                operation: request.operation,
                parameters: request.parameters as Readonly<
                    Record<string, unknown>
                >,
            });
        } catch {
            return invalidIdentityFailure(
                requestId,
                'ready'
            ) as StalkerSessionRequestOutcome<Operation>;
        }
        if (policy.kind !== 'accepted') {
            return invalidIdentityFailure(
                requestId,
                'ready'
            ) as StalkerSessionRequestOutcome<Operation>;
        }

        let mapped: StalkerSessionMappedOperation<Operation>;
        try {
            mapped = this.#mapRawOperation(
                request.operation,
                request.parameters
            );
        } catch {
            return failure(
                requestId,
                STALKER_SESSION_FAILURE_REASONS.InvalidIdentityInput,
                'ready',
                false
            ) as StalkerSessionRequestOutcome<Operation>;
        }
        if (mapped.kind === 'local') {
            return {
                kind: 'success',
                operation: request.operation,
                payload: mapped.result,
                requestId,
            } as StalkerSessionRequestOutcome<Operation>;
        }

        const watchdogRecovery = lease.session.watchdogRecovery;
        if (watchdogRecovery !== undefined) {
            if (watchdogRecovery.kind === 'origin-approval-required') {
                lease.session.watchdogRecovery = undefined;
                return this.#issueRecoveryOriginChallenge(
                    senderId,
                    lease.session,
                    watchdogRecovery,
                    requestId
                ) as StalkerSessionRequestOutcome<Operation>;
            }
            return projectAuthFailure(
                requestId,
                watchdogRecovery
            ) as StalkerSessionRequestOutcome<Operation>;
        }

        let execution = await this.#runSessionRequest(
            lease.session,
            mapped.parameters
        );
        if (!this.#isCurrentLease(lease)) {
            return invalidIdentityFailure(
                requestId,
                'ready'
            ) as StalkerSessionRequestOutcome<Operation>;
        }
        let retryBudgetSpent = false;
        if (
            execution.kind === 'suspended' ||
            !this.#isCurrentGenerationBinding(lease, execution.binding)
        ) {
            retryBudgetSpent = true;
            const retrySession = lease.session;
            const retried = await this.#refreshSessionAndRequest(
                retrySession,
                mapped.parameters
            );
            if (retried.kind === 'suspended') {
                return authRefreshExhausted(
                    requestId
                ) as StalkerSessionRequestOutcome<Operation>;
            }
            if (retried.kind !== 'completed') {
                return this.#projectRefreshFailure(
                    senderId,
                    retrySession,
                    retried,
                    requestId
                ) as StalkerSessionRequestOutcome<Operation>;
            }
            execution = retried;
        }

        let binding = execution.binding;
        let outcome = execution.outcome;
        if (
            outcome.kind === 'token-rejected' ||
            requiresEndpointRediscovery(outcome)
        ) {
            if (retryBudgetSpent) {
                if (outcome.kind === 'token-rejected') {
                    return authRefreshExhausted(
                        requestId
                    ) as StalkerSessionRequestOutcome<Operation>;
                }
            } else {
                retryBudgetSpent = true;
                const retrySession = binding.session;
                const retried = await this.#refreshSessionAndRequest(
                    retrySession,
                    mapped.parameters
                );
                if (retried.kind === 'suspended') {
                    return authRefreshExhausted(
                        requestId
                    ) as StalkerSessionRequestOutcome<Operation>;
                }
                if (retried.kind !== 'completed') {
                    return this.#projectRefreshFailure(
                        senderId,
                        retrySession,
                        retried,
                        requestId
                    ) as StalkerSessionRequestOutcome<Operation>;
                }
                binding = retried.binding;
                outcome = retried.outcome;
                if (outcome.kind === 'token-rejected') {
                    return authRefreshExhausted(
                        requestId
                    ) as StalkerSessionRequestOutcome<Operation>;
                }
            }
        }

        if (!this.#isCurrentGenerationBinding(lease, binding)) {
            return invalidIdentityFailure(
                requestId,
                'ready'
            ) as StalkerSessionRequestOutcome<Operation>;
        }
        if (outcome.kind === 'success') {
            try {
                let payload = mapped.mapResult(outcome.value);
                payload = await this.#registerPlaybackIfNeeded(
                    senderId,
                    lease,
                    binding,
                    request.operation,
                    payload
                );
                return {
                    kind: 'success',
                    operation: request.operation,
                    payload,
                    requestId,
                } as StalkerSessionRequestOutcome<Operation>;
            } catch {
                return failure(
                    requestId,
                    STALKER_SESSION_FAILURE_REASONS.IncompatibleResponse,
                    'ready',
                    false
                ) as StalkerSessionRequestOutcome<Operation>;
            }
        }
        if (outcome.kind === 'origin-approval-required') {
            return this.#issueRecoveryOriginChallenge(
                senderId,
                binding.session,
                outcome,
                requestId
            ) as StalkerSessionRequestOutcome<Operation>;
        }
        return projectAuthFailure(
            requestId,
            outcome
        ) as StalkerSessionRequestOutcome<Operation>;
    }

    async control(
        senderId: number,
        request: StalkerSessionControlRequest
    ): Promise<StalkerSessionControlOutcome> {
        const requestId = this.#requestId();
        await this.#pruneExpired();
        if (!validSender(senderId) || !request) {
            return invalidIdentityFailure(requestId, 'ready');
        }

        if (request.action === 'commit' || request.action === 'discard') {
            return this.#controlAttempt(
                senderId,
                request.action,
                request.attemptRef,
                requestId
            );
        }

        if (!('leaseRef' in request)) {
            return invalidIdentityFailure(requestId, 'ready');
        }
        const lease = this.#ownedLease(senderId, request.leaseRef);
        if (!lease) {
            return invalidIdentityFailure(requestId, 'ready');
        }
        if (request.action === 'activate') {
            this.#activateLease(lease);
            return controlSuccess(requestId, request.action);
        }
        if (request.action === 'deactivate') {
            this.#deactivateLease(lease);
            return controlSuccess(requestId, request.action);
        }
        if (request.action === 'close') {
            this.#closeLease(lease);
            return controlSuccess(requestId, request.action);
        }
        if (request.action === 'force-redetect') {
            return this.#forceRedetect(senderId, lease, requestId);
        }
        return invalidIdentityFailure(requestId, 'ready');
    }

    async cleanupSender(senderId: number): Promise<void> {
        await this.#pruneExpired();
        this.#challengeRegistry.invalidateSender(senderId);
        for (const attempt of [...this.#attempts.values()]) {
            if (attempt.senderId === senderId) {
                await this.#terminateAttempt(attempt, false);
            }
        }
        for (const [ref, tombstone] of this.#attemptTombstones) {
            if (tombstone.senderId === senderId) {
                this.#attemptTombstones.delete(ref);
            }
        }
        for (const lease of [...this.#leases.values()]) {
            if (lease.senderId === senderId) {
                this.#closeLease(lease);
            }
        }
        this.#playbackContexts?.cleanupSender(senderId);
        this.#scheduleExpiryCleanup();
    }

    async cleanupPlaylist(playlistRef: string): Promise<void> {
        await this.#pruneExpired();
        for (const attempt of [...this.#attempts.values()]) {
            if (attempt.descriptor.playlistRef === playlistRef) {
                await this.#terminateAttempt(attempt, false);
            }
        }
        for (const [ref, tombstone] of this.#attemptTombstones) {
            if (tombstone.playlistRef === playlistRef) {
                this.#attemptTombstones.delete(ref);
            }
        }
        for (const lease of [...this.#leases.values()]) {
            if (lease.playlistRef === playlistRef) {
                this.#closeLease(lease);
            }
        }
        this.#scheduleExpiryCleanup();
    }

    async destroyAll(): Promise<void> {
        this.#clearExpiryTimer();
        for (const attempt of [...this.#attempts.values()]) {
            await this.#terminateAttempt(attempt, false);
        }
        for (const lease of [...this.#leases.values()]) {
            this.#closeLease(lease);
        }
        this.#attempts.clear();
        this.#attemptTombstones.clear();
        this.#leases.clear();
        this.#sessions.clear();
        this.#watchdog.cleanupAll();
        this.#playbackContexts?.clear();
        this.#coordinatorPool.clear();
        this.#clearExpiryTimer();
    }

    #createAttempt(
        senderId: number,
        validated: StalkerValidatedRuntimeInput
    ): AttemptRecord {
        const ref = this.#uniqueReference(
            'attempt',
            (candidate) =>
                this.#attempts.has(candidate) ||
                this.#attemptTombstones.has(candidate)
        );
        return {
            approvedOrigins: new Set<string>(),
            coordinator: this.#coordinatorPool.get(
                validated.descriptor.sourceUrl,
                validated.descriptor.macAddress
            ),
            descriptor: validated.descriptor,
            expiresAt: this.#now() + ATTEMPT_TTL_MS,
            previousSessions:
                validated.descriptor.connectionMode === 'provisional'
                    ? this.#findPreviousSessions(
                          senderId,
                          validated.descriptor.playlistRef
                      )
                    : new Set<SessionRecord>(),
            ref,
            senderId,
            state: 'authenticating',
            transport: validated.transport,
        };
    }

    async #authenticateFresh(
        attempt: AttemptRecord,
        credentials?: StalkerAuthCredentials,
        expectedPrincipal?: string,
        beforeMutationRelease?: (progress: FullReadyProgress) => Promise<void>
    ): Promise<AuthenticationProgress> {
        try {
            const mutation =
                await attempt.coordinator.runDiscoveredPrincipalMutation(
                    async (epoch) => {
                        attempt.mutationEpoch = epoch;
                        this.#invalidateOlderCoordinatorEpochs(
                            attempt.coordinator,
                            epoch
                        );
                        const resolved = await this.#resolver.resolve({
                            approvedOrigins: [...attempt.approvedOrigins],
                            descriptor: resolutionDescriptor(attempt),
                            transport: attempt.transport,
                        });
                        if (resolved.kind !== 'full-session') {
                            throw new ProgressSignal(
                                endpointProgress(resolved)
                            );
                        }

                        const auth = this.#createAuthSession(
                            resolved,
                            attempt.transport
                        );
                        attempt.auth = auth;
                        attempt.lastEndpoint = resolved.endpoint;
                        attempt.lastIdentityRevision =
                            effectiveIdentityRevision(
                                resolved.identity,
                                attempt.descriptor
                            );
                        attempt.lastLandingUrl = resolved.landingUrl;
                        const authOutcome = await auth.start(credentials);
                        if (authOutcome.kind !== 'ready') {
                            throw new ProgressSignal(
                                authProgress(authOutcome, auth, resolved, epoch)
                            );
                        }
                        const principal = confirmedPrincipal(auth);
                        if (
                            expectedPrincipal !== undefined &&
                            principal !== expectedPrincipal
                        ) {
                            throw new PrincipalTransitionSignal();
                        }
                        const progress = fullReadyProgress(
                            auth,
                            authOutcome,
                            resolved,
                            epoch,
                            principal,
                            auth.hasAcceptedCredentials()
                                ? credentials
                                : undefined,
                            attempt
                        );
                        await beforeMutationRelease?.(progress);
                        return { principal, value: progress };
                    }
                );
            attempt.mutationEpoch = mutation.snapshot.epoch;
            return mutation.value;
        } catch (error) {
            attempt.mutationEpoch = attempt.coordinator.snapshot.epoch;
            if (error instanceof ProgressSignal) {
                return error.progress;
            }
            if (error instanceof PrincipalTransitionSignal) {
                return failure(
                    '',
                    STALKER_SESSION_FAILURE_REASONS.PrincipalTransitionRequired,
                    'refreshing',
                    false
                );
            }
            return failure(
                '',
                STALKER_SESSION_FAILURE_REASONS.PortalUnavailable,
                'resolving',
                true
            );
        }
    }

    async #submitCredentials(
        attempt: AttemptRecord,
        credentials: StalkerAuthCredentials
    ): Promise<AuthenticationProgress> {
        const auth = attempt.auth;
        if (
            !auth ||
            !attempt.lastEndpoint ||
            !attempt.lastIdentityRevision ||
            !attempt.lastLandingUrl
        ) {
            return this.#authenticateFresh(attempt, credentials);
        }
        try {
            const mutation =
                await attempt.coordinator.runDiscoveredPrincipalMutation(
                    async (epoch) => {
                        attempt.mutationEpoch = epoch;
                        this.#invalidateOlderCoordinatorEpochs(
                            attempt.coordinator,
                            epoch
                        );
                        const outcome = await auth.submitCredentials(
                            credentials,
                            false
                        );
                        if (outcome.kind !== 'ready') {
                            throw new ProgressSignal(
                                authProgressFromKnownEndpoint(
                                    outcome,
                                    auth,
                                    attempt.lastEndpoint as string,
                                    attempt.lastLandingUrl as string,
                                    epoch
                                )
                            );
                        }
                        const principal = confirmedPrincipal(auth);
                        return {
                            principal,
                            value: {
                                ...fullReadyFromKnownEndpoint(
                                    auth,
                                    outcome,
                                    attempt.lastEndpoint as string,
                                    attempt.lastLandingUrl as string,
                                    epoch,
                                    attempt.lastIdentityRevision as string,
                                    principal,
                                    auth.hasAcceptedCredentials()
                                        ? credentials
                                        : undefined,
                                    attempt
                                ),
                            },
                        };
                    }
                );
            attempt.mutationEpoch = mutation.snapshot.epoch;
            return mutation.value;
        } catch (error) {
            attempt.mutationEpoch = attempt.coordinator.snapshot.epoch;
            if (error instanceof ProgressSignal) {
                return error.progress;
            }
            return failure(
                '',
                STALKER_SESSION_FAILURE_REASONS.PortalUnavailable,
                'do-auth',
                true
            );
        }
    }

    async #publishProgress(
        attempt: AttemptRecord,
        progress: AuthenticationProgress,
        requestId: string
    ): Promise<StalkerSessionConnectionOutcome> {
        if (this.#attempts.get(attempt.ref) !== attempt) {
            return invalidIdentityFailure(requestId, 'resolving');
        }
        if (progress.kind === 'full-ready') {
            attempt.auth = progress.auth;
            attempt.credentialCandidate = progress.credentials;
            attempt.ready = this.#createFullAttemptReady(attempt, progress);
            attempt.state = 'ready';
            this.#refreshAttemptExpiry(attempt);
            if (attempt.descriptor.connectionMode === 'persisted-open') {
                let lease: {
                    readonly ref: string;
                    readonly session: SessionRecord;
                };
                try {
                    lease = await this.#promoteAttempt(attempt);
                } catch {
                    if (this.#attempts.get(attempt.ref) === attempt) {
                        await this.#terminateAttempt(attempt, true);
                    }
                    return failure(
                        requestId,
                        STALKER_SESSION_FAILURE_REASONS.SessionPromotionFailed,
                        'promoting',
                        false
                    );
                }
                this.#finishAttempt(attempt, 'commit');
                return fullReadyOutcome(
                    requestId,
                    attempt.descriptor,
                    lease,
                    progress,
                    undefined,
                    this.#now()
                );
            }
            return fullReadyOutcome(
                requestId,
                attempt.descriptor,
                {
                    ref: attempt.ready.leaseRef,
                    session: undefined,
                },
                progress,
                attempt.ref,
                this.#now()
            );
        }
        if (progress.kind === 'stateless-mac') {
            attempt.ready = {
                endpoint: progress.endpoint,
                kind: progress.kind,
                landingUrl: progress.landingUrl,
            };
            attempt.state = 'ready';
            this.#refreshAttemptExpiry(attempt);
            const outcome = statelessReadyOutcome(
                requestId,
                attempt.descriptor,
                progress,
                attempt.descriptor.connectionMode === 'provisional'
                    ? attempt.ref
                    : undefined,
                this.#now()
            );
            if (attempt.descriptor.connectionMode === 'persisted-open') {
                this.#finishAttempt(attempt, 'commit');
            }
            return outcome;
        }
        if (progress.kind === 'origin-approval-required') {
            return this.#issueChallenge(
                attempt,
                {
                    finalOrigin: progress.finalOrigin,
                    kind: 'origin-approval',
                    landingPath: landingPath(progress.landingUrl),
                    sourceOrigin: progress.sourceOrigin,
                },
                requestId
            );
        }
        if (progress.kind === 'credentials-required') {
            attempt.auth = progress.auth;
            attempt.lastEndpoint = progress.endpoint;
            attempt.lastLandingUrl = progress.landingUrl;
            attempt.mutationEpoch = progress.epoch;
            if (progress.outcome.savedCredentialsRejected) {
                attempt.credentialCandidate = undefined;
            }
            return this.#issueChallenge(
                attempt,
                {
                    attemptNumber: progress.outcome.attemptNumber,
                    kind: 'credentials',
                    ...(progress.outcome.savedCredentialsRejected
                        ? { savedCredentialsRejected: true }
                        : {}),
                },
                requestId
            );
        }

        const projected = withRequestId(progress, requestId);
        await this.#terminateAttempt(attempt, true);
        return projected;
    }

    #issueChallenge(
        attempt: AttemptRecord,
        challenge: StalkerChallenge,
        requestId: string
    ): StalkerSessionConnectionOutcome {
        this.#challengeRegistry.invalidateAttempt(
            attempt.senderId,
            attempt.ref
        );
        const challengeRef = this.#challengeRegistry.issue(
            attempt.senderId,
            attempt.ref,
            challenge
        );
        attempt.challengeRef = challengeRef;
        attempt.state = 'challenge';
        this.#refreshAttemptExpiry(attempt);
        if (challenge.kind === 'origin-approval') {
            return {
                attemptRef: attempt.ref,
                challengeRef,
                finalOrigin: challenge.finalOrigin,
                kind: 'origin-approval-required',
                requestId,
                sourceOrigin: challenge.sourceOrigin,
            };
        }
        return {
            attemptNumber: challenge.attemptNumber,
            attemptRef: attempt.ref,
            challengeRef,
            kind: 'credentials-required',
            requestId,
            ...(challenge.savedCredentialsRejected
                ? { savedCredentialsRejected: true }
                : {}),
        };
    }

    #createFullAttemptReady(
        attempt: AttemptRecord,
        progress: FullReadyProgress,
        existingLeaseRef?: string
    ): FullAttemptReady {
        return {
            ...(progress.accountSummary === undefined
                ? {}
                : { accountSummary: progress.accountSummary }),
            auth: progress.auth,
            ...(progress.credentials === undefined
                ? {}
                : { credentials: progress.credentials }),
            endpoint: progress.endpoint,
            epoch: progress.epoch,
            identityRevision: progress.identityRevision,
            key: sessionKey(
                progress.endpoint,
                attempt.descriptor,
                progress.identityRevision,
                progress.principal
            ),
            kind: 'full-session',
            landingUrl: progress.landingUrl,
            leaseRef:
                existingLeaseRef ??
                this.#uniqueReference(
                    'lease',
                    (candidate) =>
                        this.#leases.has(candidate) ||
                        [...this.#attempts.values()].some(
                            (other) =>
                                other.ready?.kind === 'full-session' &&
                                other.ready.leaseRef === candidate
                        )
                ),
            principal: progress.principal,
            ...(progress.watchdogIntervalSeconds === undefined
                ? {}
                : {
                      watchdogIntervalSeconds: progress.watchdogIntervalSeconds,
                  }),
        };
    }

    async #promoteAttempt(attempt: AttemptRecord): Promise<{
        readonly ref: string;
        readonly session: SessionRecord;
    }> {
        if (this.#attempts.get(attempt.ref) !== attempt) {
            throw new Error('stalker-attempt-no-longer-active');
        }
        let ready = attempt.ready;
        if (!ready) {
            throw new Error('stalker-attempt-not-ready');
        }
        if (ready.kind === 'stateless-mac') {
            throw new Error('stalker-stateless-attempt-has-no-lease');
        }

        const snapshot = attempt.coordinator.snapshot;
        if (
            snapshot.epoch !== ready.epoch ||
            snapshot.activePrincipal !== ready.principal
        ) {
            const progress = await this.#authenticateFresh(
                attempt,
                ready.credentials,
                ready.principal
            );
            if (progress.kind !== 'full-ready') {
                throw new Error(
                    'stalker-session-promotion-revalidation-failed'
                );
            }
            ready = this.#createFullAttemptReady(
                attempt,
                progress,
                ready.leaseRef
            );
            attempt.ready = ready;
        }
        const finalSnapshot = attempt.coordinator.snapshot;
        if (
            this.#attempts.get(attempt.ref) !== attempt ||
            finalSnapshot.epoch !== ready.epoch ||
            finalSnapshot.activePrincipal !== ready.principal
        ) {
            throw new Error('stalker-session-promotion-became-stale');
        }

        const replacedLeaseRefs = this.#previousPlaylistLeaseRefs(attempt);
        const destination = this.#sessions.get(ready.key);
        const promoted: SessionRecord = {
            ...(ready.accountSummary === undefined
                ? {}
                : {
                      accountSummary: sanitizeAccountSummary(
                          ready.accountSummary,
                          attempt.descriptor,
                          ready.credentials
                      ),
                  }),
            activeLeases: new Set<string>(),
            approvedOrigins: new Set(attempt.approvedOrigins),
            auth: ready.auth,
            ...(ready.credentials === undefined
                ? {}
                : { credentials: ready.credentials }),
            coordinator: attempt.coordinator,
            descriptor: persistedDescriptor(attempt.descriptor),
            endpoint: ready.endpoint,
            epoch: ready.epoch,
            generation: (destination?.generation ?? 0) + 1,
            identityRevision: ready.identityRevision,
            key: ready.key,
            landingUrl: ready.landingUrl,
            leases: new Set<string>(),
            principal: ready.principal,
            ...(attempt.resolutionSourceUrl === undefined
                ? {}
                : { resolutionSourceUrl: attempt.resolutionSourceUrl }),
            transport: attempt.transport,
            ...(ready.watchdogIntervalSeconds === undefined
                ? {}
                : {
                      watchdogIntervalSeconds: ready.watchdogIntervalSeconds,
                  }),
        };

        if (destination) {
            this.#playbackContexts?.invalidateAuthGeneration(
                destination.key,
                destination.generation
            );
            this.#transferAllLeases(destination, promoted);
            this.#sessions.delete(destination.key);
            this.#watchdog.cleanupSession(destination.key);
        }
        for (const previous of attempt.previousSessions) {
            this.#transferPlaylistLeases(
                previous,
                promoted,
                attempt.senderId,
                attempt.descriptor.playlistRef
            );
        }

        const lease: LeaseRecord = {
            active: false,
            playlistRef: attempt.descriptor.playlistRef,
            ref: ready.leaseRef,
            senderId: attempt.senderId,
            session: promoted,
        };
        promoted.leases.add(lease.ref);
        this.#leases.set(lease.ref, lease);
        this.#sessions.set(promoted.key, promoted);
        this.#reactivateTransferredLeases(promoted);
        for (const replacedLeaseRef of replacedLeaseRefs) {
            const replacedLease = this.#leases.get(replacedLeaseRef);
            if (replacedLease !== undefined && replacedLease !== lease) {
                this.#closeLease(replacedLease);
            }
        }
        return { ref: lease.ref, session: promoted };
    }

    async #controlAttempt(
        senderId: number,
        action: 'commit' | 'discard',
        attemptRef: string,
        requestId: string
    ): Promise<StalkerSessionControlOutcome> {
        const tombstone = this.#attemptTombstones.get(attemptRef);
        if (tombstone) {
            return tombstone.senderId === senderId &&
                tombstone.action === action
                ? controlSuccess(requestId, action)
                : invalidIdentityFailure(requestId, 'promoting');
        }
        const attempt = this.#attempts.get(attemptRef);
        if (!attempt || attempt.senderId !== senderId) {
            return invalidIdentityFailure(requestId, 'promoting');
        }
        if (action === 'discard') {
            await this.#terminateAttempt(attempt, true);
            this.#rememberAttempt(attempt, action);
            return controlSuccess(requestId, action);
        }
        if (!attempt.ready) {
            return invalidIdentityFailure(requestId, 'promoting');
        }
        if (attempt.ready.kind === 'stateless-mac') {
            this.#closePreviousPlaylistLeases(attempt);
            this.#finishAttempt(attempt, action);
            return controlSuccess(requestId, action);
        }
        try {
            await this.#promoteAttempt(attempt);
        } catch {
            if (this.#attempts.get(attempt.ref) === attempt) {
                await this.#terminateAttempt(attempt, true);
            }
            return failure(
                requestId,
                STALKER_SESSION_FAILURE_REASONS.SessionPromotionFailed,
                'promoting',
                false
            );
        }
        this.#finishAttempt(attempt, action);
        return controlSuccess(requestId, action);
    }

    async #forceRedetect(
        senderId: number,
        lease: LeaseRecord,
        requestId: string
    ): Promise<StalkerSessionConnectionOutcome> {
        const { learnedEndpointHint: _learnedEndpointHint, ...persisted } =
            lease.session.descriptor;
        const descriptor: StalkerSessionConnectionDescriptor = {
            ...persisted,
            connectionMode: 'provisional',
            provisionalReason: 'migration',
        };
        const attempt = this.#createAttempt(senderId, {
            descriptor,
            transport: lease.session.transport,
        });
        attempt.previousSessions.add(lease.session);
        attempt.credentialCandidate = lease.session.credentials;
        this.#attempts.set(attempt.ref, attempt);
        this.#scheduleExpiryCleanup();
        const progress = await this.#authenticateFresh(
            attempt,
            attempt.credentialCandidate
        );
        return this.#publishProgress(attempt, progress, requestId);
    }

    #closePreviousPlaylistLeases(attempt: AttemptRecord): void {
        for (const ref of this.#previousPlaylistLeaseRefs(attempt)) {
            const lease = this.#leases.get(ref);
            if (lease !== undefined) {
                this.#closeLease(lease);
            }
        }
    }

    #previousPlaylistLeaseRefs(attempt: AttemptRecord): Set<string> {
        const refs = new Set<string>();
        for (const previous of attempt.previousSessions) {
            for (const ref of previous.leases) {
                const lease = this.#leases.get(ref);
                if (
                    lease?.senderId === attempt.senderId &&
                    lease.playlistRef === attempt.descriptor.playlistRef
                ) {
                    refs.add(ref);
                }
            }
        }
        return refs;
    }

    #finishAttempt(attempt: AttemptRecord, action: 'commit' | 'discard'): void {
        this.#challengeRegistry.invalidateAttempt(
            attempt.senderId,
            attempt.ref
        );
        this.#attempts.delete(attempt.ref);
        this.#rememberAttempt(attempt, action);
        attempt.auth = undefined;
        attempt.credentialCandidate = undefined;
        attempt.ready = undefined;
    }

    #rememberAttempt(
        attempt: AttemptRecord,
        action: 'commit' | 'discard'
    ): void {
        this.#attemptTombstones.set(attempt.ref, {
            action,
            expiresAt: this.#now() + ATTEMPT_TTL_MS,
            playlistRef: attempt.descriptor.playlistRef,
            senderId: attempt.senderId,
        });
        this.#scheduleExpiryCleanup();
    }

    async #terminateAttempt(
        attempt: AttemptRecord,
        restorePrevious: boolean
    ): Promise<void> {
        this.#challengeRegistry.invalidateAttempt(
            attempt.senderId,
            attempt.ref
        );
        this.#attempts.delete(attempt.ref);
        if (attempt.ready?.kind === 'full-session') {
            this.#playbackContexts?.invalidateLease(attempt.ready.leaseRef);
        }
        attempt.auth = undefined;
        attempt.credentialCandidate = undefined;
        attempt.ready = undefined;
        this.#scheduleExpiryCleanup();
        if (restorePrevious) {
            await this.#restorePreviousSessions(attempt);
        }
    }

    async #restorePreviousSessions(attempt: AttemptRecord): Promise<void> {
        for (const previous of attempt.previousSessions) {
            if (
                [...previous.leases].some(
                    (ref) => this.#leases.get(ref)?.session === previous
                )
            ) {
                const snapshot = previous.coordinator.snapshot;
                if (
                    snapshot.epoch !== previous.epoch ||
                    snapshot.activePrincipal !== previous.principal
                ) {
                    await this.#refreshSession(previous);
                }
            }
        }
    }

    async #refreshSession(session: SessionRecord): Promise<RefreshResult> {
        if (session.refreshPromise) {
            return session.refreshPromise;
        }
        const refresh = this.#performRefresh(session);
        session.refreshPromise = refresh;
        try {
            return await refresh;
        } finally {
            if (session.refreshPromise === refresh) {
                session.refreshPromise = undefined;
            }
        }
    }

    async #refreshSessionAndRequest(
        session: SessionRecord,
        parameters: Readonly<Record<string, string | number>>
    ): Promise<RefreshRequestResult> {
        if (session.refreshPromise) {
            const joined = await session.refreshPromise;
            return joined.kind === 'ready'
                ? this.#runSessionRequest(joined.session, parameters)
                : joined;
        }

        const operation = this.#performRefreshAndRequest(session, parameters);
        const refresh = operation.then(
            (result): RefreshResult =>
                result.kind === 'completed'
                    ? { kind: 'ready', session: result.binding.session }
                    : result.kind === 'suspended'
                      ? {
                            kind: 'failure',
                            outcome: authRefreshExhausted(''),
                        }
                      : result
        );
        session.refreshPromise = refresh;
        try {
            return await operation;
        } finally {
            if (session.refreshPromise === refresh) {
                session.refreshPromise = undefined;
            }
        }
    }

    async #performRefresh(session: SessionRecord): Promise<RefreshResult> {
        const attempt = this.#createRefreshAttempt(session);
        const installed: { session?: SessionRecord } = {};
        const progress = await this.#authenticateFresh(
            attempt,
            session.credentials,
            session.principal,
            async (ready) => {
                if (this.#isLiveSession(session)) {
                    installed.session = this.#installRefresh(session, ready);
                }
            }
        );
        if (progress.kind !== 'full-ready') {
            return this.#refreshFailureFromProgress(progress);
        }
        if (!installed.session) {
            return {
                kind: 'failure',
                outcome: authRefreshExhausted(''),
            };
        }
        return { kind: 'ready', session: installed.session };
    }

    async #performRefreshAndRequest(
        session: SessionRecord,
        parameters: Readonly<Record<string, string | number>>
    ): Promise<RefreshRequestResult> {
        const attempt = this.#createRefreshAttempt(session);
        const triggered: {
            execution?: Extract<SessionRequestRunResult, { kind: 'completed' }>;
        } = {};
        const progress = await this.#authenticateFresh(
            attempt,
            session.credentials,
            session.principal,
            async (ready) => {
                if (!this.#isLiveSession(session)) {
                    return;
                }
                const installed = this.#installRefresh(session, ready);
                const binding = this.#captureBinding(installed);
                triggered.execution = {
                    binding,
                    kind: 'completed',
                    outcome: await binding.auth.request(parameters),
                };
            }
        );
        if (progress.kind !== 'full-ready') {
            return this.#refreshFailureFromProgress(progress);
        }
        return (
            triggered.execution ?? {
                kind: 'failure',
                outcome: authRefreshExhausted(''),
            }
        );
    }

    #createRefreshAttempt(session: SessionRecord): AttemptRecord {
        return {
            approvedOrigins: new Set(session.approvedOrigins),
            coordinator: session.coordinator,
            credentialCandidate: session.credentials,
            descriptor: session.descriptor,
            expiresAt: this.#now() + ATTEMPT_TTL_MS,
            lastIdentityRevision: session.identityRevision,
            previousSessions: new Set(),
            ref: '',
            ...(session.resolutionSourceUrl === undefined
                ? {}
                : { resolutionSourceUrl: session.resolutionSourceUrl }),
            senderId: -1,
            state: 'authenticating',
            transport: session.transport,
        };
    }

    #refreshFailureFromProgress(
        progress: Exclude<AuthenticationProgress, FullReadyProgress>
    ): Exclude<RefreshResult, { kind: 'ready' }> {
        if (progress.kind === 'origin-approval-required') {
            return { kind: progress.kind, progress };
        }
        if (
            progress.kind === 'failure' &&
            progress.reason ===
                STALKER_SESSION_FAILURE_REASONS.PrincipalTransitionRequired
        ) {
            return {
                kind: 'failure',
                outcome: failure('', progress.reason, 'refreshing', false),
            };
        }
        const outcome =
            progress.kind === 'failure'
                ? withRequestId(progress, '')
                : failure(
                      '',
                      STALKER_SESSION_FAILURE_REASONS.PrincipalTransitionRequired,
                      'refreshing',
                      false
                  );
        return { kind: 'failure', outcome };
    }

    #installRefresh(
        session: SessionRecord,
        progress: FullReadyProgress
    ): SessionRecord {
        const nextKey = sessionKey(
            progress.endpoint,
            session.descriptor,
            progress.identityRevision,
            progress.principal
        );
        const collision = this.#sessions.get(nextKey);
        this.#playbackContexts?.invalidateAuthGeneration(
            session.key,
            session.generation
        );
        if (collision && collision !== session) {
            this.#playbackContexts?.invalidateAuthGeneration(
                collision.key,
                collision.generation
            );
            const replacement: SessionRecord = {
                ...(progress.accountSummary === undefined
                    ? {}
                    : {
                          accountSummary: sanitizeAccountSummary(
                              progress.accountSummary,
                              session.descriptor,
                              progress.credentials
                          ),
                      }),
                activeLeases: new Set<string>(),
                approvedOrigins: new Set(session.approvedOrigins),
                auth: progress.auth,
                ...(progress.credentials === undefined
                    ? {}
                    : { credentials: progress.credentials }),
                coordinator: session.coordinator,
                descriptor: session.descriptor,
                endpoint: progress.endpoint,
                epoch: progress.epoch,
                generation:
                    Math.max(session.generation, collision.generation) + 1,
                identityRevision: progress.identityRevision,
                key: nextKey,
                landingUrl: progress.landingUrl,
                leases: new Set<string>(),
                principal: progress.principal,
                ...(session.resolutionSourceUrl === undefined
                    ? {}
                    : {
                          resolutionSourceUrl: session.resolutionSourceUrl,
                      }),
                transport: session.transport,
                ...(progress.watchdogIntervalSeconds === undefined
                    ? {}
                    : {
                          watchdogIntervalSeconds:
                              progress.watchdogIntervalSeconds,
                      }),
            };
            this.#transferAllLeases(collision, replacement);
            this.#transferAllLeases(session, replacement);
            this.#sessions.delete(collision.key);
            this.#sessions.delete(session.key);
            this.#watchdog.cleanupSession(collision.key);
            this.#watchdog.cleanupSession(session.key);
            this.#sessions.set(nextKey, replacement);
            this.#reactivateTransferredLeases(replacement);
            return replacement;
        }

        const previousKey = session.key;
        this.#watchdog.cleanupSession(previousKey);
        if (previousKey !== nextKey) {
            this.#sessions.delete(previousKey);
        }
        session.auth = progress.auth;
        session.endpoint = progress.endpoint;
        session.epoch = progress.epoch;
        session.generation += 1;
        session.identityRevision = progress.identityRevision;
        session.key = nextKey;
        session.landingUrl = progress.landingUrl;
        session.accountSummary =
            progress.accountSummary === undefined
                ? undefined
                : sanitizeAccountSummary(
                      progress.accountSummary,
                      session.descriptor,
                      progress.credentials
                  );
        session.credentials = progress.credentials;
        session.watchdogRecovery = undefined;
        session.watchdogIntervalSeconds = progress.watchdogIntervalSeconds;
        this.#sessions.set(nextKey, session);
        this.#reactivateTransferredLeases(session);
        return session;
    }

    async #runSessionRequest(
        session: SessionRecord,
        parameters: Readonly<Record<string, string | number>>
    ): Promise<SessionRequestRunResult> {
        const binding = this.#captureBinding(session);
        const read = await session.coordinator.runRead(
            binding.principal,
            binding.epoch,
            () => binding.auth.request(parameters)
        );
        return read.kind === 'completed'
            ? { binding, kind: 'completed', outcome: read.value }
            : { kind: 'suspended' };
    }

    #captureBinding(session: SessionRecord): SessionGenerationBinding {
        return {
            auth: session.auth,
            epoch: session.epoch,
            generation: session.generation,
            key: session.key,
            principal: session.principal,
            session,
        };
    }

    #projectRefreshFailure(
        senderId: number,
        session: SessionRecord,
        result: Exclude<RefreshResult, { kind: 'ready' }>,
        requestId: string
    ): StalkerSessionConnectionOutcome {
        if (result.kind === 'origin-approval-required') {
            return this.#issueRecoveryOriginChallenge(
                senderId,
                session,
                {
                    finalOrigin: result.progress.finalOrigin,
                    kind: 'origin-approval-required',
                    sourceOrigin: result.progress.sourceOrigin,
                    targetUrl: result.progress.landingUrl,
                },
                requestId
            );
        }
        return withRequestId(result.outcome, requestId);
    }

    #issueRecoveryOriginChallenge(
        senderId: number,
        session: SessionRecord,
        outcome: Extract<
            StalkerAuthenticatedRequestOutcome,
            { kind: 'origin-approval-required' }
        >,
        requestId: string
    ): StalkerSessionConnectionOutcome {
        const descriptor: StalkerSessionConnectionDescriptor = {
            ...session.descriptor,
            connectionMode: 'provisional',
            provisionalReason: 'migration',
        };
        const attempt = this.#createAttempt(senderId, {
            descriptor,
            transport: session.transport,
        });
        attempt.previousSessions.add(session);
        attempt.credentialCandidate = session.credentials;
        attempt.lastEndpoint = session.endpoint;
        attempt.lastIdentityRevision = session.identityRevision;
        attempt.lastLandingUrl = session.landingUrl;
        attempt.resolutionSourceUrl = session.resolutionSourceUrl;
        this.#attempts.set(attempt.ref, attempt);
        this.#scheduleExpiryCleanup();
        return this.#issueChallenge(
            attempt,
            {
                finalOrigin: outcome.finalOrigin,
                kind: 'origin-approval',
                landingPath: landingPath(outcome.targetUrl),
                sourceOrigin: outcome.sourceOrigin,
            },
            requestId
        );
    }

    async #registerPlaybackIfNeeded<
        Operation extends StalkerSessionApplicationOperation,
    >(
        senderId: number,
        lease: LeaseRecord,
        binding: SessionGenerationBinding,
        operation: Operation,
        payload: StalkerSessionOperationResult<Operation>
    ): Promise<StalkerSessionOperationResult<Operation>> {
        if (
            operation !== STALKER_SESSION_APPLICATION_OPERATIONS.CreateLink ||
            !this.#playbackContexts ||
            !binding.auth.preparePlayback ||
            typeof (payload as { streamUrl?: unknown }).streamUrl !== 'string'
        ) {
            return payload;
        }
        const prepared = await binding.auth.preparePlayback(
            (payload as { streamUrl: string }).streamUrl
        );
        if (!this.#isCurrentBinding(lease, binding)) {
            throw new Error('stalker-playback-lease-became-stale');
        }
        const playbackContextRef = this.#playbackContexts.register({
            authGeneration: binding.generation,
            coordinatorEpoch: binding.epoch,
            headers: prepared.headers,
            leaseRef: lease.ref,
            senderId,
            sessionKey: binding.key,
            streamUrl: prepared.streamUrl,
        });
        return {
            ...(payload as object),
            playbackContextRef,
            streamUrl: prepared.streamUrl,
        } as StalkerSessionOperationResult<Operation>;
    }

    #activateLease(lease: LeaseRecord): void {
        if (lease.active) {
            return;
        }
        lease.active = true;
        lease.session.activeLeases.add(lease.ref);
        this.#watchdog.activate(watchdogActivation(lease));
    }

    #deactivateLease(lease: LeaseRecord): void {
        if (!lease.active) {
            return;
        }
        lease.active = false;
        lease.session.activeLeases.delete(lease.ref);
        this.#watchdog.deactivate(watchdogDeactivation(lease));
    }

    #closeLease(lease: LeaseRecord): void {
        this.#playbackContexts?.invalidateLease(lease.ref);
        this.#deactivateLease(lease);
        this.#leases.delete(lease.ref);
        lease.session.leases.delete(lease.ref);
        if (lease.session.leases.size === 0) {
            this.#destroySession(lease.session);
        }
    }

    #destroySession(session: SessionRecord): void {
        this.#playbackContexts?.invalidateSession(session.key);
        if (this.#sessions.get(session.key) === session) {
            this.#sessions.delete(session.key);
        }
        this.#watchdog.cleanupSession(session.key);
        session.activeLeases.clear();
        session.leases.clear();
        session.credentials = undefined;
        session.refreshPromise = undefined;
    }

    #transferAllLeases(
        source: SessionRecord,
        destination: SessionRecord
    ): void {
        for (const ref of [...source.leases]) {
            const lease = this.#leases.get(ref);
            if (!lease || lease.session !== source) {
                continue;
            }
            this.#playbackContexts?.invalidateLease(ref);
            lease.session = destination;
            destination.leases.add(ref);
            if (lease.active) {
                destination.activeLeases.add(ref);
            }
        }
        source.leases.clear();
        source.activeLeases.clear();
        source.credentials = undefined;
    }

    #transferPlaylistLeases(
        source: SessionRecord,
        destination: SessionRecord,
        senderId: number,
        playlistRef: string
    ): void {
        if (source === destination) {
            return;
        }
        for (const ref of [...source.leases]) {
            const lease = this.#leases.get(ref);
            if (
                !lease ||
                lease.session !== source ||
                lease.senderId !== senderId ||
                lease.playlistRef !== playlistRef
            ) {
                continue;
            }
            this.#playbackContexts?.invalidateLease(ref);
            source.leases.delete(ref);
            source.activeLeases.delete(ref);
            lease.session = destination;
            destination.leases.add(ref);
            if (lease.active) {
                destination.activeLeases.add(ref);
            }
        }
        if (source.leases.size === 0) {
            this.#destroySession(source);
        }
    }

    #reactivateTransferredLeases(session: SessionRecord): void {
        for (const ref of session.activeLeases) {
            const lease = this.#leases.get(ref);
            if (lease?.session === session) {
                this.#watchdog.activate(watchdogActivation(lease));
            }
        }
    }

    #ownedLease(
        senderId: number,
        leaseRef: string | undefined
    ): LeaseRecord | undefined {
        if (typeof leaseRef !== 'string') {
            return undefined;
        }
        const lease = this.#leases.get(leaseRef);
        return lease?.senderId === senderId ? lease : undefined;
    }

    #isCurrentLease(lease: LeaseRecord): boolean {
        return (
            this.#leases.get(lease.ref) === lease &&
            lease.session.leases.has(lease.ref)
        );
    }

    #isCurrentBinding(
        lease: LeaseRecord,
        binding: SessionGenerationBinding
    ): boolean {
        return (
            this.#isCurrentGenerationBinding(lease, binding) &&
            this.#isCurrentSessionBinding(binding)
        );
    }

    #isCurrentSessionBinding(binding: SessionGenerationBinding): boolean {
        const session = binding.session;
        const snapshot = session.coordinator.snapshot;
        return (
            this.#sessions.get(binding.key) === session &&
            session.auth === binding.auth &&
            session.epoch === binding.epoch &&
            session.generation === binding.generation &&
            session.key === binding.key &&
            session.principal === binding.principal &&
            snapshot.epoch === binding.epoch &&
            snapshot.activePrincipal === binding.principal
        );
    }

    #isCurrentGenerationBinding(
        lease: LeaseRecord,
        binding: SessionGenerationBinding
    ): boolean {
        const session = binding.session;
        return (
            this.#isCurrentLease(lease) &&
            lease.session === session &&
            session.auth === binding.auth &&
            session.epoch === binding.epoch &&
            session.generation === binding.generation &&
            session.key === binding.key &&
            session.principal === binding.principal
        );
    }

    #isLiveSession(session: SessionRecord): boolean {
        return (
            this.#sessions.get(session.key) === session &&
            [...session.leases].some(
                (ref) => this.#leases.get(ref)?.session === session
            )
        );
    }

    #invalidateOlderCoordinatorEpochs(
        coordinator: StalkerBaseIdentityCoordinator,
        mutationEpoch: number
    ): void {
        for (const session of this.#sessions.values()) {
            if (
                session.coordinator === coordinator &&
                session.epoch < mutationEpoch
            ) {
                this.#playbackContexts?.invalidateCoordinatorEpoch(
                    session.key,
                    session.epoch
                );
            }
        }
    }

    #findPreviousSessions(
        senderId: number,
        playlistRef: string
    ): Set<SessionRecord> {
        const sessions = new Set<SessionRecord>();
        for (const lease of this.#leases.values()) {
            if (
                lease.senderId === senderId &&
                lease.playlistRef === playlistRef
            ) {
                sessions.add(lease.session);
            }
        }
        return sessions;
    }

    #refreshAttemptExpiry(attempt: AttemptRecord): void {
        if (this.#attempts.get(attempt.ref) !== attempt) {
            return;
        }
        attempt.expiresAt = this.#now() + ATTEMPT_TTL_MS;
        this.#scheduleExpiryCleanup();
    }

    async #pruneExpired(): Promise<void> {
        if (this.#expiryCleanupPromise) {
            return this.#expiryCleanupPromise;
        }
        const cleanup = this.#performExpiryCleanup();
        this.#expiryCleanupPromise = cleanup;
        try {
            await cleanup;
        } finally {
            if (this.#expiryCleanupPromise === cleanup) {
                this.#expiryCleanupPromise = undefined;
            }
            this.#scheduleExpiryCleanup();
        }
    }

    async #performExpiryCleanup(): Promise<void> {
        const now = this.#now();
        for (const attempt of [...this.#attempts.values()]) {
            if (attempt.expiresAt <= now) {
                await this.#terminateAttempt(attempt, true);
            }
        }
        for (const [ref, tombstone] of this.#attemptTombstones) {
            if (tombstone.expiresAt <= now) {
                this.#attemptTombstones.delete(ref);
            }
        }
    }

    #scheduleExpiryCleanup(): void {
        this.#clearExpiryTimer();
        const expiries = [
            ...[...this.#attempts.values()].map((attempt) => attempt.expiresAt),
            ...[...this.#attemptTombstones.values()].map(
                (tombstone) => tombstone.expiresAt
            ),
        ];
        if (expiries.length === 0) {
            return;
        }
        const delay = Math.max(0, Math.min(...expiries) - this.#now());
        const timer = setTimeout(() => {
            if (this.#expiryTimer === timer) {
                this.#expiryTimer = undefined;
            }
            void this.#pruneExpired().catch(() => undefined);
        }, delay);
        if (typeof timer === 'object' && 'unref' in timer) {
            timer.unref();
        }
        this.#expiryTimer = timer;
    }

    #clearExpiryTimer(): void {
        if (this.#expiryTimer === undefined) {
            return;
        }
        clearTimeout(this.#expiryTimer);
        this.#expiryTimer = undefined;
    }

    #requestId(): string {
        return this.#createReference('request');
    }

    #uniqueReference(
        kind: 'attempt' | 'lease',
        exists: (candidate: string) => boolean
    ): string {
        for (let index = 0; index < MAX_REFERENCE_ATTEMPTS; index += 1) {
            const candidate = this.#createReference(kind);
            if (!exists(candidate)) {
                return candidate;
            }
        }
        throw new Error(`stalker-${kind}-reference-generation-failed`);
    }

    #createReference(kind: 'attempt' | 'lease' | 'request'): string {
        const value = this.#createRef(kind);
        if (
            typeof value !== 'string' ||
            value.length === 0 ||
            value.length > 256 ||
            hasControlCharacters(value)
        ) {
            throw new Error(`invalid-stalker-${kind}-reference`);
        }
        return value;
    }
}

function endpointProgress(
    outcome: Exclude<StalkerEndpointResolverOutcome, { kind: 'full-session' }>
): AuthenticationProgress {
    if (outcome.kind === 'origin-approval-required') {
        return {
            finalOrigin: outcome.finalOrigin,
            kind: outcome.kind,
            landingUrl: outcome.landingUrl,
            sourceOrigin: outcome.sourceOrigin,
        };
    }
    if (outcome.kind === 'failure') {
        return failure(
            '',
            outcome.reason,
            outcome.stage,
            outcome.retryable,
            outcome.retryAfterSeconds
        );
    }
    return outcome;
}

function authProgress(
    outcome: Exclude<StalkerAuthOutcome, { kind: 'ready' }>,
    auth: StalkerSessionAuthLike,
    resolved: StalkerEndpointFullSessionOutcome,
    epoch: number
): AuthenticationProgress {
    return authProgressFromKnownEndpoint(
        outcome,
        auth,
        resolved.endpoint,
        resolved.landingUrl,
        epoch
    );
}

function authProgressFromKnownEndpoint(
    outcome: Exclude<StalkerAuthOutcome, { kind: 'ready' }>,
    auth: StalkerSessionAuthLike,
    endpoint: string,
    landingUrl: string,
    epoch: number
): AuthenticationProgress {
    if (outcome.kind === 'credentials-required') {
        return {
            auth,
            endpoint,
            epoch,
            kind: outcome.kind,
            landingUrl,
            outcome,
        };
    }
    if (outcome.kind === 'origin-approval-required') {
        return {
            finalOrigin: outcome.finalOrigin,
            kind: outcome.kind,
            landingUrl: outcome.targetUrl,
            sourceOrigin: outcome.sourceOrigin,
        };
    }
    return failure(
        '',
        outcome.reason,
        outcome.stage,
        outcome.retryable,
        outcome.retryAfterSeconds
    );
}

function fullReadyProgress(
    auth: StalkerSessionAuthLike,
    outcome: StalkerAuthReadyOutcome,
    resolved: StalkerEndpointFullSessionOutcome,
    epoch: number,
    principal: string,
    credentials: StalkerAuthCredentials | undefined,
    attempt: AttemptRecord
): FullReadyProgress {
    return fullReadyFromKnownEndpoint(
        auth,
        outcome,
        resolved.endpoint,
        resolved.landingUrl,
        epoch,
        attempt.lastIdentityRevision ??
            effectiveIdentityRevision(resolved.identity, attempt.descriptor),
        principal,
        credentials,
        attempt
    );
}

function fullReadyFromKnownEndpoint(
    auth: StalkerSessionAuthLike,
    outcome: StalkerAuthReadyOutcome,
    endpoint: string,
    landingUrl: string,
    epoch: number,
    identityRevision: string,
    principal: string,
    credentials: StalkerAuthCredentials | undefined,
    attempt: AttemptRecord
): FullReadyProgress {
    return {
        ...(outcome.accountSummary === undefined
            ? {}
            : {
                  accountSummary: sanitizeAccountSummary(
                      outcome.accountSummary,
                      attempt.descriptor,
                      credentials
                  ),
              }),
        auth,
        ...(credentials === undefined ? {} : { credentials }),
        endpoint,
        epoch,
        identityRevision,
        kind: 'full-ready',
        landingUrl,
        principal,
        ...(outcome.watchdogIntervalSeconds === undefined
            ? {}
            : {
                  watchdogIntervalSeconds: outcome.watchdogIntervalSeconds,
              }),
    };
}

function confirmedPrincipal(auth: StalkerSessionAuthLike): string {
    if (!auth.hasAcceptedCredentials()) {
        return 'mac-only';
    }
    const confirmed = auth.getPrincipalKey();
    if (
        typeof confirmed !== 'string' ||
        confirmed.length === 0 ||
        Buffer.byteLength(confirmed, 'utf8') > 512
    ) {
        throw new PrincipalTransitionSignal();
    }
    return `username:${createHash('sha256')
        .update(serializeStalkerPrincipalInput(confirmed))
        .digest('hex')}`;
}

function effectiveIdentityRevision(
    identity: StalkerIdentityProfile,
    descriptor: StalkerSessionConnectionDescriptor
): string {
    const headers = new Map(
        Object.entries(identity.headers).map(([name, value]) => [
            name.toLowerCase(),
            value,
        ])
    );
    const profile = identity.profileParameters;
    const transport = descriptor.transportConfiguration ?? {};
    const profileOverrides: Record<string, string> = {};
    for (const [name, value] of [...headers].sort(compareRecordEntries)) {
        if (name !== 'authorization' && name !== 'cookie') {
            profileOverrides[`header.${name}`] = value;
        }
    }
    addEffectiveRecord(
        profileOverrides,
        'cookie',
        identity.managedCookies,
        new Set(['mac'])
    );
    addEffectiveRecord(profileOverrides, 'profile', profile);
    addEffectiveRecord(
        profileOverrides,
        'metric',
        identity.metrics,
        new Set(['mac', 'random'])
    );

    return serializeStalkerIdentityRevision({
        apiSignature: effectiveString(profile['api_signature']),
        deviceId1: effectiveString(profile['device_id']),
        deviceId2: effectiveString(profile['device_id2']),
        firmwareVersion: effectiveString(profile['ver']),
        hardwareVersion: effectiveString(profile['hw_version']),
        hardwareVersion2: effectiveString(profile['hw_version_2']),
        imageVersion: effectiveString(profile['image_version']),
        language: effectiveString(profile['language']),
        locale: headers.get('accept-language'),
        numberOfBanks: effectiveString(profile['num_banks']),
        origin: headers.get('origin'),
        originPolicy: transport.originPolicy,
        prehash: effectiveString(profile['prehash']),
        presetId: identity.preset.id,
        presetVersion: identity.preset.version,
        profileOverrides,
        referer: headers.get('referer'),
        refererPolicy: transport.refererPolicy,
        serialNumber: effectiveString(profile['sn']),
        signature1: effectiveString(profile['signature']),
        signature2: effectiveString(profile['signature2']),
        timezone: effectiveString(profile['timezone']),
        userAgent: headers.get('user-agent'),
        videoOutput: effectiveString(profile['video_out']),
        xUserAgent: headers.get('x-user-agent'),
    });
}

function addEffectiveRecord(
    target: Record<string, string>,
    prefix: string,
    source: Readonly<Record<string, string | number>>,
    excluded = new Set<string>()
): void {
    for (const [name, value] of Object.entries(source).sort(
        compareRecordEntries
    )) {
        if (!excluded.has(name)) {
            target[`${prefix}.${name}`] = String(value);
        }
    }
}

function compareRecordEntries(
    [left]: readonly [string, unknown],
    [right]: readonly [string, unknown]
): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function effectiveString(
    value: string | number | undefined
): string | undefined {
    return value === undefined ? undefined : String(value);
}

function sessionKey(
    endpoint: string,
    descriptor: StalkerSessionConnectionDescriptor,
    identityRevision: string,
    principal: string
): string {
    return createHash('sha256')
        .update(
            JSON.stringify([
                normalizeStalkerSourceUrl(endpoint),
                normalizeStalkerMacAddress(descriptor.macAddress),
                identityRevision,
                principal,
            ])
        )
        .digest('hex');
}

function persistedDescriptor(
    descriptor: StalkerSessionConnectionDescriptor
): StalkerSessionConnectionDescriptor {
    return {
        connectionMode: 'persisted-open',
        ...(descriptor.identityOverrides === undefined
            ? {}
            : { identityOverrides: descriptor.identityOverrides }),
        ...(descriptor.learnedEndpointHint === undefined
            ? {}
            : { learnedEndpointHint: descriptor.learnedEndpointHint }),
        macAddress: descriptor.macAddress,
        playlistRef: descriptor.playlistRef,
        profilePreset: descriptor.profilePreset,
        sourceUrl: descriptor.sourceUrl,
        ...(descriptor.transportConfiguration === undefined
            ? {}
            : {
                  transportConfiguration: descriptor.transportConfiguration,
              }),
    };
}

function fullReadyOutcome(
    requestId: string,
    descriptor: StalkerSessionConnectionDescriptor,
    lease: { readonly ref: string; readonly session?: SessionRecord },
    progress: FullReadyProgress,
    attemptRef: string | undefined,
    now: number
): StalkerSessionConnectionOutcome {
    const accountSummary =
        lease.session?.accountSummary ??
        sanitizeAccountSummary(
            progress.accountSummary,
            descriptor,
            progress.credentials
        );
    return {
        ...(accountSummary === undefined ? {} : { accountSummary }),
        capabilities: {
            authenticatedSession: true,
            playbackContext: true,
        },
        ...connectionState(descriptor, attemptRef),
        endpoint: progress.endpoint,
        kind: 'ready',
        landingUrl: progress.landingUrl,
        leaseRef: lease.ref,
        persistenceDraft: persistenceDraft(
            descriptor,
            progress.endpoint,
            progress.landingUrl,
            'full-session',
            now
        ),
        recipe: 'full-session',
        requestId,
    };
}

function statelessReadyOutcome(
    requestId: string,
    descriptor: StalkerSessionConnectionDescriptor,
    ready: StatelessAttemptReady,
    attemptRef: string | undefined,
    now: number
): StalkerSessionConnectionOutcome {
    return {
        ...connectionState(descriptor, attemptRef),
        endpoint: ready.endpoint,
        kind: 'ready',
        landingUrl: ready.landingUrl,
        persistenceDraft: persistenceDraft(
            descriptor,
            ready.endpoint,
            ready.landingUrl,
            'stateless-mac',
            now
        ),
        recipe: 'stateless-mac',
        requestId,
    };
}

function connectionState(
    descriptor: StalkerSessionConnectionDescriptor,
    attemptRef?: string
):
    | {
          readonly connectionMode: 'persisted-open';
      }
    | {
          readonly attemptRef: string;
          readonly connectionMode: 'provisional';
          readonly provisionalReason: 'edit' | 'import' | 'migration';
      } {
    if (descriptor.connectionMode === 'persisted-open') {
        return { connectionMode: descriptor.connectionMode };
    }
    if (!attemptRef) {
        throw new Error('missing-stalker-provisional-attempt-ref');
    }
    return {
        attemptRef,
        connectionMode: descriptor.connectionMode,
        provisionalReason: descriptor.provisionalReason,
    };
}

function persistenceDraft(
    descriptor: StalkerSessionConnectionDescriptor,
    endpoint: string,
    landingUrl: string,
    recipe: 'full-session' | 'stateless-mac',
    now: number
): StalkerSessionPersistenceDraft {
    return {
        isFullStalkerPortal: recipe === 'full-session',
        portalUrl: endpoint,
        stalkerLandingUrl: landingUrl,
        stalkerLastVerifiedAt: new Date(now).toISOString(),
        stalkerRecipeClassifierVersion: RECIPE_CLASSIFIER_VERSION,
        stalkerRequestRecipe: recipe,
        stalkerSourceUrl: descriptor.sourceUrl,
    };
}

function sanitizeAccountSummary(
    summary: StalkerSessionAccountSummary | undefined,
    descriptor: StalkerSessionConnectionDescriptor,
    credentials: StalkerAuthCredentials | undefined
): StalkerSessionAccountSummary | undefined {
    if (!summary) {
        return undefined;
    }
    const forbidden = new Set(
        [
            credentials?.username,
            credentials?.password,
            ...Object.values(descriptor.identityOverrides ?? {}),
        ].filter(
            (value): value is string =>
                typeof value === 'string' && value.length > 0
        )
    );
    const sanitized = Object.fromEntries(
        Object.entries(summary).filter(
            ([, value]) =>
                typeof value === 'string' &&
                value.length > 0 &&
                !forbidden.has(value)
        )
    ) as StalkerSessionAccountSummary;
    return Object.keys(sanitized).length === 0 ? undefined : sanitized;
}

function projectAuthFailure(
    requestId: string,
    outcome: Exclude<
        StalkerAuthenticatedRequestOutcome,
        { kind: 'success' | 'token-rejected' | 'origin-approval-required' }
    >
): StalkerSessionFailureOutcome {
    return failure(
        requestId,
        outcome.reason,
        outcome.stage,
        outcome.retryable,
        outcome.retryAfterSeconds
    );
}

function requiresEndpointRediscovery(
    outcome: StalkerAuthenticatedRequestOutcome
): outcome is Extract<StalkerAuthenticatedRequestOutcome, { kind: 'failure' }> {
    return (
        outcome.kind === 'failure' &&
        (outcome.reason === STALKER_SESSION_FAILURE_REASONS.EndpointNotFound ||
            outcome.reason ===
                STALKER_SESSION_FAILURE_REASONS.IncompatibleResponse)
    );
}

function failure(
    requestId: string,
    reason: StalkerSessionFailureOutcome['reason'],
    stage: StalkerSessionStage,
    retryable: boolean,
    retryAfterSeconds?: number
): StalkerSessionFailureOutcome {
    return {
        kind: 'failure',
        reason,
        requestId,
        retryable,
        ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
        stage,
    };
}

function invalidIdentityFailure(
    requestId: string,
    stage: StalkerSessionStage
): StalkerSessionFailureOutcome {
    return failure(
        requestId,
        STALKER_SESSION_FAILURE_REASONS.InvalidIdentityInput,
        stage,
        false
    );
}

function authRefreshExhausted(requestId: string): StalkerSessionFailureOutcome {
    return failure(
        requestId,
        STALKER_SESSION_FAILURE_REASONS.AuthRefreshExhausted,
        'refreshing',
        false
    );
}

function withRequestId(
    outcome: StalkerSessionFailureOutcome,
    requestId: string
): StalkerSessionFailureOutcome {
    return { ...outcome, requestId };
}

function controlSuccess(
    requestId: string,
    action: StalkerSessionControlAction
): StalkerSessionControlOutcome {
    return { action, kind: 'success', requestId };
}

function validSender(senderId: number): boolean {
    return Number.isSafeInteger(senderId) && senderId >= 0;
}

function hasControlCharacters(value: string): boolean {
    for (const character of value) {
        const code = character.charCodeAt(0);
        if (code <= 0x1f || code === 0x7f) {
            return true;
        }
    }
    return false;
}

function landingPath(url: string): string {
    try {
        const parsed = new URL(url);
        return `${parsed.pathname}${parsed.search}`;
    } catch {
        return '/';
    }
}

function approvedResolutionSourceUrl(
    finalOrigin: string,
    path: string
): string | undefined {
    try {
        const parsedOrigin = new URL(finalOrigin);
        if (
            parsedOrigin.origin !== finalOrigin ||
            (parsedOrigin.protocol !== 'http:' &&
                parsedOrigin.protocol !== 'https:')
        ) {
            return undefined;
        }
        const target = normalizeStalkerSourceUrl(
            new URL(path, `${finalOrigin}/`).toString()
        );
        return new URL(target).origin === finalOrigin ? target : undefined;
    } catch {
        return undefined;
    }
}

function resolutionDescriptor(
    attempt: AttemptRecord
): StalkerSessionConnectionDescriptor {
    if (attempt.resolutionSourceUrl === undefined) {
        return attempt.descriptor;
    }
    const learnedEndpointHint = attempt.descriptor.learnedEndpointHint;
    const sameOriginHint =
        learnedEndpointHint !== undefined &&
        sameOrigin(learnedEndpointHint, attempt.resolutionSourceUrl)
            ? learnedEndpointHint
            : undefined;
    return {
        ...attempt.descriptor,
        learnedEndpointHint: sameOriginHint,
        sourceUrl: attempt.resolutionSourceUrl,
    };
}

function sameOrigin(left: string, right: string): boolean {
    try {
        return new URL(left).origin === new URL(right).origin;
    } catch {
        return false;
    }
}

function watchdogActivation(lease: LeaseRecord): StalkerWatchdogActivation {
    return {
        leaseRef: lease.ref,
        principal: lease.session.principal,
        ...(lease.session.watchdogIntervalSeconds === undefined
            ? {}
            : {
                  profile: {
                      watchdog_timeout: lease.session.watchdogIntervalSeconds,
                  },
              }),
        sessionKey: lease.session.key,
    };
}

function watchdogDeactivation(lease: LeaseRecord): StalkerWatchdogDeactivation {
    return {
        leaseRef: lease.ref,
        principal: lease.session.principal,
        sessionKey: lease.session.key,
    };
}

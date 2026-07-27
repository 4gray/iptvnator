/* eslint-disable max-lines -- Lifecycle scenarios intentionally share one state-machine harness. */
import type {
    StalkerSessionApplicationOperation,
    StalkerSessionConnectionDescriptor,
    StalkerSessionConnectionOutcome,
    StalkerSessionOperationParameters,
    StalkerSessionOperationResult,
    StalkerSessionRequest,
} from '@iptvnator/shared/interfaces';
import {
    STALKER_SESSION_APPLICATION_OPERATIONS,
    STALKER_SESSION_FAILURE_REASONS,
} from '@iptvnator/shared/interfaces';
import {
    MAG250_LEGACY_BROWSER_USER_AGENT,
    MAG250_X_USER_AGENT,
    createStalkerIdentityProfile,
    type StalkerIdentityProfileInput,
} from '@iptvnator/portal/stalker/protocol';
import type {
    StalkerAuthCredentials,
    StalkerAuthenticatedRequestOutcome,
    StalkerAuthOutcome,
} from './stalker-auth-session';
import type {
    StalkerEndpointFullSessionOutcome,
    StalkerEndpointResolverOutcome,
} from './stalker-endpoint-resolver';
import type {
    StalkerBaseIdentityCoordinator,
    StalkerBaseIdentityCoordinatorPool,
} from './stalker-base-identity-coordinator';
import {
    StalkerSessionManager,
    type StalkerSessionAuthLike,
    type StalkerSessionManagerDependencies,
    type StalkerSessionOperationMapper,
    type StalkerSessionPlaybackContextPort,
    type StalkerSessionWatchdogLike,
} from './stalker-session-manager';

const ENDPOINT = 'https://portal.test/server/load.php';
const LANDING_URL = 'https://portal.test/c/';
const MAC = '00:1A:79:AA:BB:CC';

function descriptor(
    playlistRef: string,
    connectionMode: 'persisted-open' | 'provisional' = 'persisted-open',
    overrides: Partial<StalkerSessionConnectionDescriptor> = {}
): StalkerSessionConnectionDescriptor {
    const safeOverrides = {
        ...overrides,
    } as Partial<StalkerSessionConnectionDescriptor> & {
        connectionMode?: never;
        provisionalReason?: never;
    };
    delete safeOverrides.connectionMode;
    delete safeOverrides.provisionalReason;
    const base = {
        macAddress: MAC,
        playlistRef,
        profilePreset: {
            id: 'mag250-public-5_1-minimal-v1' as const,
            version: 1 as const,
        },
        sourceUrl: `https://portal.test/${playlistRef}/`,
        ...safeOverrides,
    };
    return connectionMode === 'provisional'
        ? {
              ...base,
              connectionMode,
              provisionalReason: 'edit',
          }
        : {
              ...base,
              connectionMode,
          };
}

function full(
    endpoint = ENDPOINT,
    identity: Partial<StalkerIdentityProfileInput> = {}
): StalkerEndpointFullSessionOutcome {
    return {
        cookieJar: { privateCookie: 'cookie-secret' } as never,
        endpoint,
        handshakeRandom: 'random-secret',
        identity: createStalkerIdentityProfile({
            macAddress: MAC,
            ...identity,
        }),
        kind: 'full-session',
        landingUrl: LANDING_URL,
        profile: {
            kind: 'ready',
            profile: { status: 0 },
            status: 0,
        },
        profileEnvelope: { js: { token: 'profile-token-secret' } },
        token: 'token-secret',
    };
}

function stateless(): StalkerEndpointResolverOutcome {
    return {
        endpoint: ENDPOINT,
        kind: 'stateless-mac',
        landingUrl: LANDING_URL,
    };
}

class FakeAuth implements StalkerSessionAuthLike {
    readonly requests: Readonly<Record<string, string | number>>[] = [];
    readonly submittedCredentials: StalkerAuthCredentials[] = [];
    startCalls = 0;

    constructor(
        readonly principal = 'mac-only',
        readonly acceptedCredentials = false,
        private readonly startOutcomes: StalkerAuthOutcome[] = [
            { kind: 'ready' },
        ],
        private readonly requestOutcomes: StalkerAuthenticatedRequestOutcome[] = [
            { kind: 'success', value: { js: [] } },
        ]
    ) {}

    getEndpoint(): string {
        return ENDPOINT;
    }

    getPrincipalKey(): string {
        return this.principal;
    }

    hasAcceptedCredentials(): boolean {
        return this.acceptedCredentials;
    }

    async start(): Promise<StalkerAuthOutcome> {
        this.startCalls += 1;
        return (
            this.startOutcomes.shift() ?? {
                kind: 'failure',
                reason: STALKER_SESSION_FAILURE_REASONS.IncompatibleResponse,
                retryable: false,
                stage: 'handshaking',
            }
        );
    }

    async submitCredentials(
        credentials: StalkerAuthCredentials
    ): Promise<StalkerAuthOutcome> {
        this.submittedCredentials.push(credentials);
        return (
            this.startOutcomes.shift() ?? {
                kind: 'failure',
                reason: STALKER_SESSION_FAILURE_REASONS.IncompatibleResponse,
                retryable: false,
                stage: 'do-auth',
            }
        );
    }

    async request(
        parameters: Readonly<Record<string, string | number>>
    ): Promise<StalkerAuthenticatedRequestOutcome> {
        this.requests.push(parameters);
        return (
            this.requestOutcomes.shift() ?? {
                kind: 'success',
                value: { js: [] },
            }
        );
    }
}

const operationMapper: StalkerSessionOperationMapper = <
    Operation extends StalkerSessionApplicationOperation,
>(
    operation: Operation,
    parameters: StalkerSessionOperationParameters<Operation>
) => {
    if (operation === STALKER_SESSION_APPLICATION_OPERATIONS.Favorites) {
        const favorite = (
            parameters as StalkerSessionOperationParameters<'favorites'>
        ).favorite;
        return {
            kind: 'local',
            result: {
                favorite,
                success: true,
            } as StalkerSessionOperationResult<Operation>,
        };
    }
    return {
        kind: 'remote',
        mapResult: () =>
            ({
                items: [],
            }) as StalkerSessionOperationResult<Operation>,
        parameters: {
            action: String(operation),
            JsHttpRequest: '1-xml',
            type: 'itv',
        },
    };
};

function harness(
    options: {
        auths?: FakeAuth[];
        coordinatorPool?: StalkerBaseIdentityCoordinatorPool;
        credentials?: Readonly<Record<string, StalkerAuthCredentials>>;
        now?: () => number;
        playbackContexts?: StalkerSessionPlaybackContextPort;
        resolverOutcomes?: StalkerEndpointResolverOutcome[];
        watchdog?: StalkerSessionWatchdogLike;
    } = {}
) {
    const auths = [...(options.auths ?? [new FakeAuth()])];
    const resolverOutcomes = [...(options.resolverOutcomes ?? [full()])];
    const resolve = jest.fn(async () => {
        const outcome = resolverOutcomes.shift();
        if (!outcome) {
            throw new Error('unexpected-resolver-call');
        }
        return outcome;
    });
    const createAuthSession = jest.fn(() => {
        const auth = auths.shift();
        if (!auth) {
            throw new Error('unexpected-auth-session');
        }
        return auth;
    });
    let reference = 0;
    const dependencies: StalkerSessionManagerDependencies = {
        ...(options.coordinatorPool
            ? { coordinatorPool: options.coordinatorPool }
            : {}),
        createAuthSession,
        createRef(kind) {
            reference += 1;
            return `${kind}-${reference}`;
        },
        loadSavedCredentials: async (currentDescriptor) =>
            options.credentials?.[currentDescriptor.playlistRef],
        mapRawOperation: operationMapper,
        ...(options.now ? { now: options.now } : {}),
        ...(options.playbackContexts
            ? { playbackContexts: options.playbackContexts }
            : {}),
        random: (size) => Buffer.alloc(size, reference++ % 255),
        resolver: { resolve },
        ...(options.watchdog ? { watchdog: options.watchdog } : {}),
    };
    return {
        createAuthSession,
        manager: new StalkerSessionManager(dependencies),
        resolve,
    };
}

function expectFullReady(
    outcome: StalkerSessionConnectionOutcome
): asserts outcome is Extract<
    StalkerSessionConnectionOutcome,
    { kind: 'ready'; recipe: 'full-session' }
> {
    expect(outcome).toMatchObject({
        kind: 'ready',
        recipe: 'full-session',
    });
    if (outcome.kind !== 'ready' || outcome.recipe !== 'full-session') {
        throw new Error('expected-full-ready');
    }
}

function catalogRequest(
    leaseRef: string
): StalkerSessionRequest<'get-categories'> {
    return {
        leaseRef,
        operation: STALKER_SESSION_APPLICATION_OPERATIONS.CatalogCategories,
        parameters: { contentType: 'vod' },
    };
}

function playbackContextPort(): StalkerSessionPlaybackContextPort {
    return {
        cleanupSender: jest.fn(),
        clear: jest.fn(),
        invalidateAuthGeneration: jest.fn(),
        invalidateCoordinatorEpoch: jest.fn(),
        invalidateLease: jest.fn(),
        invalidateSession: jest.fn(),
        register: jest.fn(() => 'playback-ref'),
    };
}

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

describe('StalkerSessionManager', () => {
    it('derives opaque canonical keys from endpoint, MAC, identity revision, and confirmed principal only', async () => {
        const activate = jest.fn();
        const watchdog: StalkerSessionWatchdogLike = {
            activate,
            cleanupAll: jest.fn(),
            cleanupSession: jest.fn(),
            deactivate: jest.fn(),
        };
        const { manager } = harness({
            auths: [
                new FakeAuth(),
                new FakeAuth(),
                new FakeAuth(),
                new FakeAuth('user-a', true),
                new FakeAuth(),
                new FakeAuth(),
                new FakeAuth(),
            ],
            credentials: {
                principal: {
                    password: 'password',
                    username: 'user-a',
                },
            },
            resolverOutcomes: [
                full(),
                full(),
                full('https://other-endpoint.test/portal.php'),
                full(),
                full(ENDPOINT, { serialNumber: 'explicit-serial' }),
                full(),
                full(),
            ],
            watchdog,
        });
        const first = await manager.open(1, {
            descriptor: descriptor('alias-one'),
        });
        const same = await manager.open(2, {
            descriptor: descriptor('alias-two'),
        });
        const endpointChanged = await manager.open(3, {
            descriptor: descriptor('endpoint'),
        });
        const principalChanged = await manager.open(4, {
            descriptor: descriptor('principal'),
        });
        const identityChanged = await manager.open(5, {
            descriptor: descriptor('identity', 'persisted-open', {
                identityOverrides: { serialNumber: 'explicit-serial' },
            }),
        });
        const macChanged = await manager.open(6, {
            descriptor: descriptor('mac', 'persisted-open', {
                macAddress: '00:1A:79:AA:BB:CD',
            }),
        });
        const explicitDefaults = await manager.open(7, {
            descriptor: descriptor('explicit-defaults', 'persisted-open', {
                transportConfiguration: {
                    language: 'en',
                    locale: 'en-US',
                    timezone: 'UTC',
                    userAgent: MAG250_LEGACY_BROWSER_USER_AGENT,
                    xUserAgent: MAG250_X_USER_AGENT,
                },
            }),
        });
        expectFullReady(first);
        expectFullReady(same);
        expectFullReady(endpointChanged);
        expectFullReady(principalChanged);
        expectFullReady(identityChanged);
        expectFullReady(macChanged);
        expectFullReady(explicitDefaults);

        await manager.control(1, {
            action: 'activate',
            leaseRef: first.leaseRef,
        });
        await manager.control(2, {
            action: 'activate',
            leaseRef: same.leaseRef,
        });
        await manager.control(3, {
            action: 'activate',
            leaseRef: endpointChanged.leaseRef,
        });
        await manager.control(4, {
            action: 'activate',
            leaseRef: principalChanged.leaseRef,
        });
        await manager.control(5, {
            action: 'activate',
            leaseRef: identityChanged.leaseRef,
        });
        await manager.control(6, {
            action: 'activate',
            leaseRef: macChanged.leaseRef,
        });
        await manager.control(7, {
            action: 'activate',
            leaseRef: explicitDefaults.leaseRef,
        });

        const keys = activate.mock.calls.map(
            ([activation]) => activation.sessionKey as string
        );
        expect(keys[0]).toBe(keys[1]);
        expect(keys[2]).not.toBe(keys[0]);
        expect(keys[3]).not.toBe(keys[0]);
        expect(keys[4]).not.toBe(keys[0]);
        expect(keys[5]).not.toBe(keys[0]);
        expect(keys[6]).toBe(keys[0]);
        expect(keys.every((key) => /^[a-f0-9]{64}$/.test(key))).toBe(true);
        expect(keys.join(' ')).not.toContain('user-a');
        expect(keys.join(' ')).not.toContain('alias-one');
        expect(keys.join(' ')).not.toContain('alias-two');
    });

    it('shares only a committed canonical identity while issuing sender-bound leases', async () => {
        const firstAuth = new FakeAuth();
        const replacementAuth = new FakeAuth();
        const { manager } = harness({
            auths: [firstAuth, replacementAuth],
            resolverOutcomes: [full(), full()],
        });

        const first = await manager.open(11, {
            descriptor: descriptor('playlist-one'),
        });
        const second = await manager.open(22, {
            descriptor: descriptor('playlist-two'),
        });
        expectFullReady(first);
        expectFullReady(second);
        expect(first.leaseRef).not.toBe(second.leaseRef);

        await expect(
            manager.request(11, catalogRequest(first.leaseRef))
        ).resolves.toMatchObject({ kind: 'success' });
        await expect(
            manager.request(22, catalogRequest(second.leaseRef))
        ).resolves.toMatchObject({ kind: 'success' });
        expect(firstAuth.requests).toHaveLength(0);
        expect(replacementAuth.requests).toHaveLength(2);

        await expect(
            manager.request(22, catalogRequest(first.leaseRef))
        ).resolves.toMatchObject({
            kind: 'failure',
            reason: STALKER_SESSION_FAILURE_REASONS.InvalidIdentityInput,
        });
    });

    it('keeps provisional leases unusable until an idempotent commit atomically replaces the generation', async () => {
        const oldAuth = new FakeAuth();
        const promotedAuth = new FakeAuth();
        const { manager } = harness({
            auths: [oldAuth, promotedAuth],
            resolverOutcomes: [full(), full()],
        });
        const existing = await manager.open(1, {
            descriptor: descriptor('playlist'),
        });
        const provisional = await manager.open(1, {
            descriptor: descriptor('playlist', 'provisional'),
        });
        expectFullReady(existing);
        expectFullReady(provisional);
        expect(provisional.connectionMode).toBe('provisional');
        if (provisional.connectionMode !== 'provisional') {
            throw new Error('expected-provisional-ready');
        }

        await expect(
            manager.request(1, catalogRequest(provisional.leaseRef))
        ).resolves.toMatchObject({
            kind: 'failure',
            reason: STALKER_SESSION_FAILURE_REASONS.InvalidIdentityInput,
        });
        await expect(
            manager.control(1, {
                action: 'commit',
                attemptRef: provisional.attemptRef,
            })
        ).resolves.toMatchObject({ action: 'commit', kind: 'success' });
        await expect(
            manager.control(1, {
                action: 'commit',
                attemptRef: provisional.attemptRef,
            })
        ).resolves.toMatchObject({ action: 'commit', kind: 'success' });

        await manager.request(1, catalogRequest(existing.leaseRef));
        await manager.request(1, catalogRequest(provisional.leaseRef));
        expect(oldAuth.requests).toHaveLength(0);
        expect(promotedAuth.requests).toHaveLength(2);
    });

    it('revalidates a stale provisional principal before promotion', async () => {
        const provisionalAuth = new FakeAuth('user-a', true);
        const otherPrincipalAuth = new FakeAuth('user-b', true);
        const revalidatedAuth = new FakeAuth('user-a', true);
        const { manager, resolve } = harness({
            auths: [provisionalAuth, otherPrincipalAuth, revalidatedAuth],
            credentials: {
                a: { password: 'a-password', username: 'user-a' },
                b: { password: 'b-password', username: 'user-b' },
            },
            resolverOutcomes: [full(), full(), full()],
        });
        const provisional = await manager.open(10, {
            descriptor: descriptor('a', 'provisional'),
        });
        const other = await manager.open(20, {
            descriptor: descriptor('b'),
        });
        expectFullReady(provisional);
        expectFullReady(other);
        if (provisional.connectionMode !== 'provisional') {
            throw new Error('expected-provisional-ready');
        }

        await expect(
            manager.control(10, {
                action: 'commit',
                attemptRef: provisional.attemptRef,
            })
        ).resolves.toMatchObject({ action: 'commit', kind: 'success' });
        expect(resolve).toHaveBeenCalledTimes(3);
        await manager.request(10, catalogRequest(provisional.leaseRef));
        expect(revalidatedAuth.requests).toHaveLength(1);
    });

    it('returns a typed failure and terminates a persisted open when promotion revalidation fails', async () => {
        let mutationCount = 0;
        const coordinator = {
            get snapshot() {
                return mutationCount === 1
                    ? { activePrincipal: 'another-principal', epoch: 2 }
                    : { activePrincipal: undefined, epoch: mutationCount + 1 };
            },
            runDiscoveredPrincipalMutation: async (
                operation: (
                    epoch: number
                ) => Promise<{ principal: string; value: unknown }>
            ) => {
                mutationCount += 1;
                const epoch = mutationCount === 1 ? 1 : 3;
                const result = await operation(epoch);
                return {
                    snapshot: {
                        activePrincipal: result.principal,
                        epoch,
                    },
                    value: result.value,
                };
            },
            runRead: jest.fn(),
        } as unknown as StalkerBaseIdentityCoordinator;
        const coordinatorPool = {
            clear: jest.fn(),
            get: jest.fn(() => coordinator),
        } as unknown as StalkerBaseIdentityCoordinatorPool;
        const { manager, resolve } = harness({
            auths: [new FakeAuth()],
            coordinatorPool,
            resolverOutcomes: [
                full(),
                {
                    kind: 'failure',
                    reason: STALKER_SESSION_FAILURE_REASONS.EndpointNotFound,
                    retryable: false,
                    stage: 'resolving',
                },
            ],
        });

        await expect(
            manager.open(30, {
                descriptor: descriptor('persisted-promotion-failure'),
            })
        ).resolves.toMatchObject({
            kind: 'failure',
            reason: STALKER_SESSION_FAILURE_REASONS.SessionPromotionFailed,
            stage: 'promoting',
        });
        expect(resolve).toHaveBeenCalledTimes(2);
        await expect(
            manager.cleanupPlaylist('persisted-promotion-failure')
        ).resolves.toBeUndefined();
    });

    it('restores the previous ready generation after a failed provisional edit', async () => {
        const originalAuth = new FakeAuth();
        const restoredAuth = new FakeAuth();
        const { manager, resolve } = harness({
            auths: [originalAuth, restoredAuth],
            resolverOutcomes: [
                full(),
                {
                    kind: 'failure',
                    reason: STALKER_SESSION_FAILURE_REASONS.PortalUnavailable,
                    retryable: true,
                    stage: 'resolving',
                },
                full(),
            ],
        });
        const existing = await manager.open(4, {
            descriptor: descriptor('playlist'),
        });
        expectFullReady(existing);

        await expect(
            manager.open(4, {
                descriptor: descriptor('playlist', 'provisional'),
            })
        ).resolves.toMatchObject({
            kind: 'failure',
            reason: STALKER_SESSION_FAILURE_REASONS.PortalUnavailable,
        });
        expect(resolve).toHaveBeenCalledTimes(3);
        await manager.request(4, catalogRequest(existing.leaseRef));
        expect(originalAuth.requests).toHaveLength(0);
        expect(restoredAuth.requests).toHaveLength(1);
    });

    it('binds one-shot challenges to the sender and the exact attempt', async () => {
        const auth = new FakeAuth('confirmed-user', true, [
            { attemptNumber: 1, kind: 'credentials-required' },
            { kind: 'ready' },
        ]);
        const { manager } = harness({ auths: [auth] });

        const challenge = await manager.open(7, {
            descriptor: descriptor('credentials'),
        });
        expect(challenge).toMatchObject({
            kind: 'credentials-required',
            attemptNumber: 1,
        });
        if (challenge.kind !== 'credentials-required') {
            throw new Error('expected-credentials-challenge');
        }

        await expect(
            manager.continue(8, {
                challengeRef: challenge.challengeRef,
                response: {
                    kind: 'credentials',
                    password: 'password',
                    username: 'confirmed-user',
                },
            })
        ).resolves.toMatchObject({
            kind: 'failure',
            reason: STALKER_SESSION_FAILURE_REASONS.InvalidIdentityInput,
        });
        const ready = await manager.continue(7, {
            challengeRef: challenge.challengeRef,
            response: {
                kind: 'credentials',
                password: 'password',
                username: 'confirmed-user',
            },
        });
        expectFullReady(ready);
        expect(auth.submittedCredentials).toEqual([
            {
                password: 'password',
                username: 'confirmed-user',
            },
        ]);
        await expect(
            manager.continue(7, {
                challengeRef: challenge.challengeRef,
                response: {
                    kind: 'credentials',
                    password: 'password',
                    username: 'confirmed-user',
                },
            })
        ).resolves.toMatchObject({
            kind: 'failure',
            reason: STALKER_SESSION_FAILURE_REASONS.InvalidIdentityInput,
        });
    });

    it('resets the two-minute lifetime when a slow attempt becomes ready or issues a challenge', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(0);
        class SlowReadyAuth extends FakeAuth {
            override async start(): Promise<StalkerAuthOutcome> {
                this.startCalls += 1;
                jest.setSystemTime(119_000);
                return { kind: 'ready' };
            }
        }
        class SlowChallengeAuth extends FakeAuth {
            override async start(): Promise<StalkerAuthOutcome> {
                this.startCalls += 1;
                jest.setSystemTime(238_000);
                return {
                    attemptNumber: 1,
                    kind: 'credentials-required',
                };
            }
        }
        const { manager } = harness({
            auths: [
                new SlowReadyAuth(),
                new SlowChallengeAuth('confirmed-user', true, [
                    { kind: 'ready' },
                ]),
            ],
            now: Date.now,
            resolverOutcomes: [full(), full()],
        });

        try {
            const ready = await manager.open(41, {
                descriptor: descriptor('slow-ready', 'provisional'),
            });
            expectFullReady(ready);
            if (ready.connectionMode !== 'provisional') {
                throw new Error('expected-provisional-ready');
            }
            await jest.advanceTimersByTimeAsync(2_000);
            await expect(
                manager.control(41, {
                    action: 'commit',
                    attemptRef: ready.attemptRef,
                })
            ).resolves.toMatchObject({ action: 'commit', kind: 'success' });

            const challenge = await manager.open(42, {
                descriptor: descriptor('slow-challenge', 'provisional'),
            });
            if (challenge.kind !== 'credentials-required') {
                throw new Error('expected-credentials-challenge');
            }
            await jest.advanceTimersByTimeAsync(2_000);
            await expect(
                manager.continue(42, {
                    challengeRef: challenge.challengeRef,
                    response: {
                        kind: 'credentials',
                        password: 'password',
                        username: 'confirmed-user',
                    },
                })
            ).resolves.toMatchObject({ kind: 'ready' });
        } finally {
            await manager.destroyAll();
            jest.useRealTimers();
        }
    });

    it('automatically terminates an abandoned provisional attempt at its deadline', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(0);
        const { manager, resolve } = harness({
            auths: [
                new FakeAuth('user-a', true),
                new FakeAuth('user-b', true),
                new FakeAuth('user-a', true),
            ],
            credentials: {
                'automatic-expiry': {
                    password: 'a-password',
                    username: 'user-a',
                },
            },
            now: Date.now,
            resolverOutcomes: [full(), full(), full()],
        });

        try {
            const existing = await manager.open(43, {
                descriptor: descriptor('automatic-expiry'),
            });
            expectFullReady(existing);
            const ready = await manager.open(43, {
                descriptor: descriptor('automatic-expiry', 'provisional'),
            });
            expectFullReady(ready);
            if (ready.connectionMode !== 'provisional') {
                throw new Error('expected-provisional-ready');
            }

            await jest.advanceTimersByTimeAsync(120_001);
            expect(resolve).toHaveBeenCalledTimes(3);
            await expect(
                manager.control(43, {
                    action: 'commit',
                    attemptRef: ready.attemptRef,
                })
            ).resolves.toMatchObject({
                kind: 'failure',
                reason: STALKER_SESSION_FAILURE_REASONS.InvalidIdentityInput,
            });
        } finally {
            await manager.destroyAll();
            jest.useRealTimers();
        }
    });

    it('keeps local operations off the wire after lease and policy validation', async () => {
        const auth = new FakeAuth();
        const { manager } = harness({ auths: [auth] });
        const ready = await manager.open(3, {
            descriptor: descriptor('local'),
        });
        expectFullReady(ready);

        await expect(
            manager.request(3, {
                leaseRef: ready.leaseRef,
                operation: STALKER_SESSION_APPLICATION_OPERATIONS.Favorites,
                parameters: {
                    contentType: 'vod',
                    favorite: true,
                    itemId: '42',
                },
            })
        ).resolves.toMatchObject({
            kind: 'success',
            payload: { favorite: true, success: true },
        });
        expect(auth.requests).toHaveLength(0);
    });

    it('performs one single-flight refresh and one retry for concurrent token rejections', async () => {
        const expired = new FakeAuth(
            'mac-only',
            false,
            [{ kind: 'ready' }],
            [{ kind: 'token-rejected' }, { kind: 'token-rejected' }]
        );
        const refreshed = new FakeAuth(
            'mac-only',
            false,
            [{ kind: 'ready' }],
            [
                { kind: 'success', value: { js: [] } },
                { kind: 'success', value: { js: [] } },
            ]
        );
        const playbackContexts = playbackContextPort();
        const { manager, resolve } = harness({
            auths: [expired, refreshed],
            playbackContexts,
            resolverOutcomes: [full(), full()],
        });
        const ready = await manager.open(5, {
            descriptor: descriptor('refresh'),
        });
        expectFullReady(ready);

        const outcomes = await Promise.all([
            manager.request(5, catalogRequest(ready.leaseRef)),
            manager.request(5, catalogRequest(ready.leaseRef)),
        ]);

        expect(outcomes).toEqual([
            expect.objectContaining({ kind: 'success' }),
            expect.objectContaining({ kind: 'success' }),
        ]);
        expect(resolve).toHaveBeenCalledTimes(2);
        expect(expired.requests).toHaveLength(2);
        expect(refreshed.requests).toHaveLength(2);
        expect(playbackContexts.invalidateAuthGeneration).toHaveBeenCalledTimes(
            1
        );
    });

    it('keeps suspended-principal authentication and its triggering request in one exclusive mutation', async () => {
        const refreshStarted = deferred<void>();
        const allowRefresh = deferred<void>();
        class PausedRefreshAuth extends FakeAuth {
            override async start(): Promise<StalkerAuthOutcome> {
                this.startCalls += 1;
                refreshStarted.resolve();
                await allowRefresh.promise;
                return { kind: 'ready' };
            }
        }
        const refreshedA = new PausedRefreshAuth('user-a', true);
        const refreshedB = new FakeAuth('user-b', true);
        const { manager, resolve } = harness({
            auths: [
                new FakeAuth('user-a', true),
                new FakeAuth('user-b', true),
                refreshedA,
                refreshedB,
            ],
            credentials: {
                a: { password: 'a-password', username: 'user-a' },
                b: { password: 'b-password', username: 'user-b' },
            },
            resolverOutcomes: [full(), full(), full(), full()],
        });
        const first = await manager.open(1, {
            descriptor: descriptor('a'),
        });
        const second = await manager.open(2, {
            descriptor: descriptor('b'),
        });
        expectFullReady(first);
        expectFullReady(second);

        const firstRequest = manager.request(1, catalogRequest(first.leaseRef));
        await refreshStarted.promise;
        const secondRequest = manager.request(
            2,
            catalogRequest(second.leaseRef)
        );
        allowRefresh.resolve();

        await expect(
            Promise.all([firstRequest, secondRequest])
        ).resolves.toEqual([
            expect.objectContaining({ kind: 'success' }),
            expect.objectContaining({ kind: 'success' }),
        ]);
        expect(resolve).toHaveBeenCalledTimes(4);
        expect(refreshedA.requests).toHaveLength(1);
        expect(refreshedB.requests).toHaveLength(1);
    });

    it('rediscovers an incompatible learned endpoint once and retries on the refreshed generation', async () => {
        const incompatible = new FakeAuth(
            'mac-only',
            false,
            [{ kind: 'ready' }],
            [
                {
                    kind: 'failure',
                    reason: STALKER_SESSION_FAILURE_REASONS.EndpointNotFound,
                    retryable: false,
                    stage: 'ready',
                },
            ]
        );
        const rediscovered = new FakeAuth();
        const { manager, resolve } = harness({
            auths: [incompatible, rediscovered],
            resolverOutcomes: [full(), full()],
        });
        const ready = await manager.open(3, {
            descriptor: descriptor('rediscovery-success'),
        });
        expectFullReady(ready);

        await expect(
            manager.request(3, catalogRequest(ready.leaseRef))
        ).resolves.toMatchObject({ kind: 'success' });
        expect(resolve).toHaveBeenCalledTimes(2);
        expect(rediscovered.requests).toHaveLength(1);
    });

    it('does not recursively rediscover when the one retry is also incompatible', async () => {
        const incompatible = new FakeAuth(
            'mac-only',
            false,
            [{ kind: 'ready' }],
            [
                {
                    kind: 'failure',
                    reason: STALKER_SESSION_FAILURE_REASONS.IncompatibleResponse,
                    retryable: false,
                    stage: 'ready',
                },
            ]
        );
        const stillIncompatible = new FakeAuth(
            'mac-only',
            false,
            [{ kind: 'ready' }],
            [
                {
                    kind: 'failure',
                    reason: STALKER_SESSION_FAILURE_REASONS.IncompatibleResponse,
                    retryable: false,
                    stage: 'ready',
                },
            ]
        );
        const { manager, resolve } = harness({
            auths: [incompatible, stillIncompatible],
            resolverOutcomes: [full(), full()],
        });
        const ready = await manager.open(4, {
            descriptor: descriptor('rediscovery-budget'),
        });
        expectFullReady(ready);

        await expect(
            manager.request(4, catalogRequest(ready.leaseRef))
        ).resolves.toMatchObject({
            kind: 'failure',
            reason: STALKER_SESSION_FAILURE_REASONS.IncompatibleResponse,
        });
        expect(resolve).toHaveBeenCalledTimes(2);
        expect(stillIncompatible.requests).toHaveLength(1);
    });

    it('rejects a principal change discovered during refresh', async () => {
        const expired = new FakeAuth(
            'user-a',
            true,
            [{ kind: 'ready' }],
            [{ kind: 'token-rejected' }]
        );
        const changed = new FakeAuth('user-b', true);
        const playbackContexts = playbackContextPort();
        const { manager } = harness({
            auths: [expired, changed],
            credentials: {
                refresh: {
                    password: 'password',
                    username: 'user-a',
                },
            },
            playbackContexts,
            resolverOutcomes: [full(), full()],
        });
        const ready = await manager.open(6, {
            descriptor: descriptor('refresh'),
        });
        expectFullReady(ready);

        await expect(
            manager.request(6, catalogRequest(ready.leaseRef))
        ).resolves.toMatchObject({
            kind: 'failure',
            reason: STALKER_SESSION_FAILURE_REASONS.PrincipalTransitionRequired,
            stage: 'refreshing',
        });
        expect(changed.requests).toHaveLength(0);
        expect(
            playbackContexts.invalidateCoordinatorEpoch
        ).toHaveBeenCalledTimes(1);
    });

    it('does not recursively refresh when the one retry also rejects its token', async () => {
        const expired = new FakeAuth(
            'mac-only',
            false,
            [{ kind: 'ready' }],
            [{ kind: 'token-rejected' }]
        );
        const refreshed = new FakeAuth(
            'mac-only',
            false,
            [{ kind: 'ready' }],
            [{ kind: 'token-rejected' }]
        );
        const { manager, resolve } = harness({
            auths: [expired, refreshed],
            resolverOutcomes: [full(), full()],
        });
        const ready = await manager.open(9, {
            descriptor: descriptor('retry-budget'),
        });
        expectFullReady(ready);

        await expect(
            manager.request(9, catalogRequest(ready.leaseRef))
        ).resolves.toMatchObject({
            kind: 'failure',
            reason: STALKER_SESSION_FAILURE_REASONS.AuthRefreshExhausted,
            stage: 'refreshing',
        });
        expect(resolve).toHaveBeenCalledTimes(2);
        expect(refreshed.requests).toHaveLength(1);
    });

    it('spends the same one-refresh budget when a stale generation must be revalidated first', async () => {
        const stale = new FakeAuth('user-a', true);
        const switcher = new FakeAuth('user-b', true);
        const revalidated = new FakeAuth(
            'user-a',
            true,
            [{ kind: 'ready' }],
            [{ kind: 'token-rejected' }]
        );
        const { manager, resolve } = harness({
            auths: [stale, switcher, revalidated],
            credentials: {
                a: { password: 'a-password', username: 'user-a' },
                b: { password: 'b-password', username: 'user-b' },
            },
            resolverOutcomes: [full(), full(), full()],
        });
        const first = await manager.open(1, {
            descriptor: descriptor('a'),
        });
        const second = await manager.open(2, {
            descriptor: descriptor('b'),
        });
        expectFullReady(first);
        expectFullReady(second);

        await expect(
            manager.request(1, catalogRequest(first.leaseRef))
        ).resolves.toMatchObject({
            kind: 'failure',
            reason: STALKER_SESSION_FAILURE_REASONS.AuthRefreshExhausted,
        });
        expect(resolve).toHaveBeenCalledTimes(3);
        expect(revalidated.requests).toHaveLength(1);
    });

    it('coordinates lifecycle and cleanup through lease ownership', async () => {
        const watchdog: StalkerSessionWatchdogLike = {
            activate: jest.fn(),
            cleanupAll: jest.fn(),
            cleanupSession: jest.fn(),
            deactivate: jest.fn(),
        };
        const playbackContexts = playbackContextPort();
        const { manager } = harness({
            auths: [new FakeAuth(), new FakeAuth(), new FakeAuth()],
            resolverOutcomes: [full(), full(), full()],
            playbackContexts,
            watchdog,
        });
        const first = await manager.open(1, {
            descriptor: descriptor('one'),
        });
        const second = await manager.open(2, {
            descriptor: descriptor('two'),
        });
        const discarded = await manager.open(1, {
            descriptor: descriptor('draft', 'provisional', {
                macAddress: '00:1A:79:AA:BB:CD',
            }),
        });
        expectFullReady(first);
        expectFullReady(second);
        expectFullReady(discarded);
        if (discarded.connectionMode !== 'provisional') {
            throw new Error('expected-provisional-ready');
        }

        await manager.control(1, {
            action: 'activate',
            leaseRef: first.leaseRef,
        });
        await manager.control(1, {
            action: 'deactivate',
            leaseRef: first.leaseRef,
        });
        await manager.control(1, {
            action: 'discard',
            attemptRef: discarded.attemptRef,
        });
        await expect(
            manager.control(1, {
                action: 'close',
                leaseRef: first.leaseRef,
            })
        ).resolves.toMatchObject({ action: 'close', kind: 'success' });
        expect(watchdog.activate).toHaveBeenCalledTimes(1);
        expect(watchdog.deactivate).toHaveBeenCalledTimes(1);

        await manager.cleanupSender(1);
        expect(playbackContexts.cleanupSender).toHaveBeenCalledWith(1);
        await expect(
            manager.request(1, catalogRequest(first.leaseRef))
        ).resolves.toMatchObject({ kind: 'failure' });
        await manager.cleanupPlaylist('two');
        await expect(
            manager.request(2, catalogRequest(second.leaseRef))
        ).resolves.toMatchObject({ kind: 'failure' });
        await manager.destroyAll();
        expect(watchdog.cleanupAll).toHaveBeenCalledTimes(1);
        expect(playbackContexts.invalidateLease).toHaveBeenCalledWith(
            first.leaseRef
        );
        expect(playbackContexts.invalidateSession).toHaveBeenCalled();
        expect(playbackContexts.clear).toHaveBeenCalledTimes(1);
    });

    it('cannot resurrect an attempt after its renderer is cleaned up mid-authentication', async () => {
        const resolution = deferred<StalkerEndpointResolverOutcome>();
        const manager = new StalkerSessionManager({
            createAuthSession: () => new FakeAuth(),
            createRef: (() => {
                let ref = 0;
                return (kind: 'attempt' | 'lease' | 'request') =>
                    `${kind}-cleanup-race-${ref++}`;
            })(),
            mapRawOperation: operationMapper,
            resolver: {
                resolve: () => resolution.promise,
            },
        });

        const opening = manager.open(77, {
            descriptor: descriptor('cleanup-race'),
        });
        await Promise.resolve();
        await manager.cleanupSender(77);
        resolution.resolve(full());

        await expect(opening).resolves.toMatchObject({
            kind: 'failure',
            reason: STALKER_SESSION_FAILURE_REASONS.InvalidIdentityInput,
        });
    });

    it('does not publish an in-flight request after its sender lease is cleaned up', async () => {
        const response = deferred<StalkerAuthenticatedRequestOutcome>();
        class PendingRequestAuth extends FakeAuth {
            override async request(
                parameters: Readonly<Record<string, string | number>>
            ): Promise<StalkerAuthenticatedRequestOutcome> {
                this.requests.push(parameters);
                return response.promise;
            }
        }
        const auth = new PendingRequestAuth();
        const { manager } = harness({ auths: [auth] });
        const ready = await manager.open(88, {
            descriptor: descriptor('request-cleanup-race'),
        });
        expectFullReady(ready);

        const pending = manager.request(88, catalogRequest(ready.leaseRef));
        await Promise.resolve();
        await manager.cleanupSender(88);
        response.resolve({ kind: 'success', value: { js: [] } });

        await expect(pending).resolves.toMatchObject({
            kind: 'failure',
            reason: STALKER_SESSION_FAILURE_REASONS.InvalidIdentityInput,
        });
    });

    it('cannot bind old playback headers to a replacement auth generation', async () => {
        const prepareStarted = deferred<void>();
        const prepared = deferred<{
            headers: Readonly<Record<string, string>>;
            streamUrl: string;
        }>();
        class SlowPlaybackAuth extends FakeAuth {
            async preparePlayback() {
                prepareStarted.resolve();
                return prepared.promise;
            }
        }
        const playbackContexts = playbackContextPort();
        const auths: StalkerSessionAuthLike[] = [
            new SlowPlaybackAuth(),
            new FakeAuth(),
        ];
        const resolverOutcomes = [full(), full()];
        let ref = 0;
        const manager = new StalkerSessionManager({
            createAuthSession: () => {
                const auth = auths.shift();
                if (!auth) {
                    throw new Error('unexpected-auth-session');
                }
                return auth;
            },
            createRef: (kind) => `${kind}-playback-race-${ref++}`,
            mapRawOperation: ((operation) => ({
                kind: 'remote',
                mapResult: () => ({ streamUrl: '/old.ts' }),
                parameters: {
                    action: String(operation),
                    JsHttpRequest: '1-xml',
                    type: 'vod',
                },
            })) as StalkerSessionOperationMapper,
            playbackContexts,
            resolver: {
                resolve: async () => {
                    const outcome = resolverOutcomes.shift();
                    if (!outcome) {
                        throw new Error('unexpected-resolver-call');
                    }
                    return outcome;
                },
            },
        });
        const first = await manager.open(91, {
            descriptor: descriptor('first-playback-row'),
        });
        expectFullReady(first);
        const pending = manager.request(91, {
            leaseRef: first.leaseRef,
            operation: STALKER_SESSION_APPLICATION_OPERATIONS.CreateLink,
            parameters: {
                command: '/old.ts',
                contentType: 'vod',
            },
        });
        await prepareStarted.promise;

        const replacement = await manager.open(92, {
            descriptor: descriptor('replacement-playback-row'),
        });
        expectFullReady(replacement);
        prepared.resolve({
            headers: { Authorization: 'Bearer old-generation' },
            streamUrl: 'https://portal.test/old.ts',
        });

        await expect(pending).resolves.toMatchObject({
            kind: 'failure',
            reason: STALKER_SESSION_FAILURE_REASONS.IncompatibleResponse,
        });
        expect(playbackContexts.register).not.toHaveBeenCalled();
    });

    it('keeps stateless provisional attempts outside the lease registry', async () => {
        const { manager } = harness({
            auths: [],
            resolverOutcomes: [stateless()],
        });
        const ready = await manager.open(1, {
            descriptor: descriptor('simple', 'provisional'),
        });
        expect(ready).toMatchObject({
            connectionMode: 'provisional',
            kind: 'ready',
            recipe: 'stateless-mac',
        });
        if (ready.kind !== 'ready' || ready.connectionMode !== 'provisional') {
            throw new Error('expected-stateless-provisional');
        }
        await expect(
            manager.control(1, {
                action: 'commit',
                attemptRef: ready.attemptRef,
            })
        ).resolves.toMatchObject({ action: 'commit', kind: 'success' });
    });
});

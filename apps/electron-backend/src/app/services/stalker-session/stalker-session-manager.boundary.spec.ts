import { createStalkerIdentityProfile } from '@iptvnator/portal/stalker/protocol';
import {
    STALKER_SESSION_APPLICATION_OPERATIONS,
    type StalkerSessionConnectionDescriptor,
} from '@iptvnator/shared/interfaces';
import type {
    StalkerAuthenticatedRequestOutcome,
    StalkerAuthOutcome,
} from './stalker-auth-session';
import type { StalkerEndpointFullSessionOutcome } from './stalker-endpoint-resolver';
import {
    StalkerSessionManager,
    type StalkerSessionAuthLike,
} from './stalker-session-manager';

const SECRET_VALUES = [
    'boundary-token-secret',
    'boundary-random-secret',
    'boundary-cookie-secret',
    'boundary-username-secret',
    'boundary-password-secret',
    'boundary-serial-secret',
    'boundary-device-secret',
    'boundary-signature-secret',
] as const;

class BoundaryAuth implements StalkerSessionAuthLike {
    readonly #outcomes: StalkerAuthOutcome[];
    readonly #requestOutcomes: StalkerAuthenticatedRequestOutcome[];

    constructor(
        outcomes: StalkerAuthOutcome[],
        requestOutcomes: StalkerAuthenticatedRequestOutcome[] = []
    ) {
        this.#outcomes = [...outcomes];
        this.#requestOutcomes = [...requestOutcomes];
    }

    getEndpoint(): string {
        return 'https://portal.boundary/server/load.php';
    }

    getPrincipalKey(): string {
        return SECRET_VALUES[3];
    }

    hasAcceptedCredentials(): boolean {
        return true;
    }

    async preparePlayback(): Promise<{
        headers: Readonly<Record<string, string>>;
        streamUrl: string;
    }> {
        return {
            headers: {
                Authorization: `Bearer ${SECRET_VALUES[0]}`,
                Cookie: `sid=${SECRET_VALUES[2]}`,
            },
            streamUrl: 'https://media.boundary/movie.ts',
        };
    }

    async request(): Promise<StalkerAuthenticatedRequestOutcome> {
        return (
            this.#requestOutcomes.shift() ?? {
                kind: 'success',
                value: {
                    js: {
                        cookie: SECRET_VALUES[2],
                        random: SECRET_VALUES[1],
                        token: SECRET_VALUES[0],
                    },
                },
            }
        );
    }

    async start(): Promise<StalkerAuthOutcome> {
        return (
            this.#outcomes.shift() ?? {
                kind: 'ready',
            }
        );
    }

    async submitCredentials(): Promise<StalkerAuthOutcome> {
        return (
            this.#outcomes.shift() ?? {
                kind: 'ready',
            }
        );
    }
}

function descriptor(
    connectionMode: 'persisted-open' | 'provisional' = 'persisted-open'
): StalkerSessionConnectionDescriptor {
    const base = {
        identityOverrides: {
            deviceId1: SECRET_VALUES[6],
            serialNumber: SECRET_VALUES[5],
            signature1: SECRET_VALUES[7],
        },
        macAddress: '00:1A:79:01:02:03',
        playlistRef: 'boundary-playlist',
        profilePreset: {
            id: 'mag250-public-5_1-minimal-v1' as const,
            version: 1 as const,
        },
        sourceUrl: 'https://portal.boundary/c/',
    };
    return connectionMode === 'provisional'
        ? {
              ...base,
              connectionMode,
              provisionalReason: 'edit',
          }
        : { ...base, connectionMode };
}

function resolved(): StalkerEndpointFullSessionOutcome {
    return {
        cookieJar: {
            sessionCookie: SECRET_VALUES[2],
        } as never,
        endpoint: 'https://portal.boundary/server/load.php',
        handshakeRandom: SECRET_VALUES[1],
        identity: createStalkerIdentityProfile({
            deviceId1: SECRET_VALUES[6],
            macAddress: '00:1A:79:01:02:03',
            serialNumber: SECRET_VALUES[5],
            signature1: SECRET_VALUES[7],
        }),
        kind: 'full-session',
        landingUrl: 'https://portal.boundary/c/',
        profile: {
            kind: 'credentials-required',
            profile: { status: 2 },
            status: 2,
        },
        profileEnvelope: {
            js: {
                random: SECRET_VALUES[1],
                token: SECRET_VALUES[0],
            },
        },
        token: SECRET_VALUES[0],
    };
}

function assertNoPrivateMaterial(value: unknown): void {
    const visit = (current: unknown): void => {
        if (typeof current === 'string') {
            for (const secret of SECRET_VALUES) {
                expect(current).not.toContain(secret);
            }
            return;
        }
        if (Array.isArray(current)) {
            current.forEach(visit);
            return;
        }
        if (typeof current !== 'object' || current === null) {
            return;
        }
        for (const [key, nested] of Object.entries(current)) {
            expect(key).not.toMatch(
                /^(?:authorization|cookie|token|random|password|username|serial(?:number)?|deviceid[12]?|signature[12]?|prehash|apisignature)$/i
            );
            visit(nested);
        }
    };
    visit(value);
}

describe('StalkerSessionManager secret boundary', () => {
    it('recursively keeps resolver, auth, identity, credential, and playback secrets out of every public outcome', async () => {
        const auth = new BoundaryAuth(
            [
                {
                    attemptNumber: 1,
                    kind: 'credentials-required',
                },
                {
                    accountSummary: {
                        accountBalance: SECRET_VALUES[6],
                        expiresAt: '2030-01-01',
                        name: SECRET_VALUES[3],
                        status: 'active',
                        tariffPlan: SECRET_VALUES[5],
                    },
                    kind: 'ready',
                },
            ],
            [
                {
                    kind: 'success',
                    value: {
                        js: {
                            cookie: SECRET_VALUES[2],
                            random: SECRET_VALUES[1],
                            token: SECRET_VALUES[0],
                        },
                    },
                },
                {
                    kind: 'success',
                    value: {
                        js: {
                            cmd: '/movie.ts',
                            cookie: SECRET_VALUES[2],
                            token: SECRET_VALUES[0],
                        },
                    },
                },
            ]
        );
        let reference = 0;
        const playbackRegistrations: unknown[] = [];
        const manager = new StalkerSessionManager({
            createAuthSession: () => auth,
            createRef: (kind) => `${kind}-boundary-${reference++}`,
            mapRawOperation: (operation) => {
                if (
                    operation ===
                    STALKER_SESSION_APPLICATION_OPERATIONS.CreateLink
                ) {
                    return {
                        kind: 'remote',
                        mapResult: () => ({
                            streamUrl: '/movie.ts',
                        }),
                        parameters: {
                            action: 'create_link',
                            JsHttpRequest: '1-xml',
                            type: 'vod',
                        },
                    } as never;
                }
                return {
                    kind: 'remote',
                    mapResult: () => ({ items: [] }),
                    parameters: {
                        action: 'get_categories',
                        JsHttpRequest: '1-xml',
                        type: 'vod',
                    },
                } as never;
            },
            playbackContexts: {
                cleanupSender: jest.fn(),
                clear: jest.fn(),
                invalidateAuthGeneration: jest.fn(),
                invalidateCoordinatorEpoch: jest.fn(),
                invalidateLease: jest.fn(),
                invalidateSession: jest.fn(),
                register: (input) => {
                    playbackRegistrations.push(input);
                    return 'playback-context-boundary';
                },
            },
            random: (size) => Buffer.alloc(size, reference++),
            resolver: {
                resolve: async () => resolved(),
            },
        });

        const openOutcome = await manager.open(41, {
            descriptor: descriptor(),
        });
        if (openOutcome.kind !== 'credentials-required') {
            throw new Error('expected-credentials-required');
        }
        const continueOutcome = await manager.continue(41, {
            challengeRef: openOutcome.challengeRef,
            response: {
                kind: 'credentials',
                password: SECRET_VALUES[4],
                username: SECRET_VALUES[3],
            },
        });
        if (
            continueOutcome.kind !== 'ready' ||
            continueOutcome.recipe !== 'full-session'
        ) {
            throw new Error('expected-full-ready');
        }
        const requestOutcome = await manager.request(41, {
            leaseRef: continueOutcome.leaseRef,
            operation: STALKER_SESSION_APPLICATION_OPERATIONS.CatalogCategories,
            parameters: { contentType: 'vod' },
        });
        const playbackOutcome = await manager.request(41, {
            leaseRef: continueOutcome.leaseRef,
            operation: STALKER_SESSION_APPLICATION_OPERATIONS.CreateLink,
            parameters: {
                command: '/movie.ts',
                contentType: 'vod',
            },
        });
        const controlOutcome = await manager.control(41, {
            action: 'activate',
            leaseRef: continueOutcome.leaseRef,
        });

        expect(playbackRegistrations).toHaveLength(1);
        expect(playbackOutcome).toMatchObject({
            kind: 'success',
            payload: {
                playbackContextRef: 'playback-context-boundary',
                streamUrl: 'https://media.boundary/movie.ts',
            },
        });
        for (const outcome of [
            openOutcome,
            continueOutcome,
            requestOutcome,
            playbackOutcome,
            controlOutcome,
        ]) {
            assertNoPrivateMaterial(outcome);
        }
        expect(JSON.stringify(manager)).toBe('{}');
    });

    it('keeps origin challenges opaque, sender-bound, and secret-free', async () => {
        let resolveCount = 0;
        const manager = new StalkerSessionManager({
            createAuthSession: () => new BoundaryAuth([{ kind: 'ready' }]),
            createRef: (kind) => `${kind}-origin-${resolveCount}`,
            mapRawOperation: (() => {
                throw new Error('not-used');
            }) as never,
            random: (size) => Buffer.alloc(size, ++resolveCount),
            resolver: {
                resolve: async () => {
                    resolveCount += 1;
                    return resolveCount === 1
                        ? {
                              finalOrigin: 'https://approved.boundary',
                              kind: 'origin-approval-required' as const,
                              landingUrl:
                                  'https://approved.boundary/customer/c/',
                              sourceOrigin: 'https://portal.boundary',
                          }
                        : resolved();
                },
            },
        });

        const challenge = await manager.open(51, {
            descriptor: descriptor('provisional'),
        });
        if (challenge.kind !== 'origin-approval-required') {
            throw new Error('expected-origin-approval');
        }
        const wrongSender = await manager.continue(52, {
            challengeRef: challenge.challengeRef,
            response: { approved: true, kind: 'origin-approval' },
        });
        const approved = await manager.continue(51, {
            challengeRef: challenge.challengeRef,
            response: { approved: true, kind: 'origin-approval' },
        });

        assertNoPrivateMaterial(challenge);
        assertNoPrivateMaterial(wrongSender);
        assertNoPrivateMaterial(approved);
    });
});

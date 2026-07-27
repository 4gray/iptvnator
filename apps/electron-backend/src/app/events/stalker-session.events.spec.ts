import {
    STALKER_SESSION_APPLICATION_OPERATIONS,
    STALKER_SESSION_CONTINUE,
    STALKER_SESSION_CONTROL,
    STALKER_SESSION_OPEN,
    STALKER_SESSION_REQUEST,
    type StalkerSessionConnectionOutcome,
    type StalkerSessionControlOutcome,
    type StalkerSessionRequestOutcome,
} from '@iptvnator/shared/interfaces';
import type { StalkerSessionManagerPort } from './stalker-session.events';

const mockHandlers = new Map<
    string,
    (event: MockInvokeEvent, request: unknown) => Promise<unknown>
>();

jest.mock('electron', () => ({
    ipcMain: {
        handle: jest.fn(
            (
                channel: string,
                handler: (
                    event: MockInvokeEvent,
                    request: unknown
                ) => Promise<unknown>
            ) => {
                mockHandlers.set(channel, handler);
            }
        ),
    },
}));

type MockSender = {
    id: number;
    once: jest.Mock;
};

type MockInvokeEvent = {
    sender: MockSender;
};

const OPEN_REQUEST = {
    descriptor: {
        connectionMode: 'provisional',
        macAddress: '00-1a-79-00-00-01',
        playlistRef: 'playlist-1',
        profilePreset: {
            id: 'mag250-public-5_1-minimal-v1',
            version: 1,
        },
        provisionalReason: 'import',
        sourceUrl: 'https://portal.example/c/#fragment',
    },
} as const;

const CONNECTION_OUTCOME: StalkerSessionConnectionOutcome = {
    kind: 'failure',
    reason: 'request-timeout',
    requestId: 'request-open',
    retryable: true,
    stage: 'handshaking',
};

function createSender(id = 42): MockSender {
    return {
        id,
        once: jest.fn(),
    };
}

function createManager(): StalkerSessionManagerPort {
    return {
        cleanupSender: jest.fn(),
        continue: jest.fn().mockResolvedValue(CONNECTION_OUTCOME),
        control: jest.fn().mockResolvedValue({
            action: 'activate',
            kind: 'success',
            requestId: 'request-control',
        } satisfies StalkerSessionControlOutcome),
        open: jest.fn().mockResolvedValue(CONNECTION_OUTCOME),
        request: jest.fn().mockResolvedValue({
            kind: 'success',
            operation: STALKER_SESSION_APPLICATION_OPERATIONS.CatalogItems,
            payload: {
                items: [],
            },
            requestId: 'request-catalog',
        } satisfies StalkerSessionRequestOutcome),
    };
}

function invoke(
    channel: string,
    sender: MockSender,
    request: unknown
): Promise<unknown> {
    const handler = mockHandlers.get(channel);
    if (!handler) {
        throw new Error(`Missing test IPC handler: ${channel}`);
    }
    return handler({ sender }, request);
}

describe('StalkerSessionEvents', () => {
    beforeEach(async () => {
        jest.resetModules();
        mockHandlers.clear();
    });

    it('registers exactly the four typed channels and binds normalized input to the sender', async () => {
        const manager = createManager();
        const sender = createSender();
        const { default: StalkerSessionEvents } =
            await import('./stalker-session.events');

        StalkerSessionEvents.bootstrapStalkerSessionEvents(manager);

        expect([...mockHandlers.keys()].sort()).toEqual(
            [
                STALKER_SESSION_OPEN,
                STALKER_SESSION_CONTINUE,
                STALKER_SESSION_REQUEST,
                STALKER_SESSION_CONTROL,
            ].sort()
        );

        await expect(
            invoke(STALKER_SESSION_OPEN, sender, OPEN_REQUEST)
        ).resolves.toBe(CONNECTION_OUTCOME);
        expect(manager.open).toHaveBeenCalledWith(42, {
            descriptor: {
                ...OPEN_REQUEST.descriptor,
                macAddress: '00:1A:79:00:00:01',
                sourceUrl: 'https://portal.example/c/',
            },
        });
        expect(sender.once).toHaveBeenCalledTimes(1);
        expect(sender.once).toHaveBeenCalledWith(
            'destroyed',
            expect.any(Function)
        );
    });

    it('forwards continue, application request, and control through their typed manager methods', async () => {
        const manager = createManager();
        const sender = createSender(73);
        const { default: StalkerSessionEvents } =
            await import('./stalker-session.events');
        const continueRequest = {
            challengeRef: 'opaque-challenge',
            response: {
                approved: true,
                kind: 'origin-approval',
            },
        } as const;
        const operationRequest = {
            leaseRef: 'opaque-lease',
            operation: STALKER_SESSION_APPLICATION_OPERATIONS.CatalogItems,
            parameters: {
                category: '10',
                page: 1,
            },
        } as const;
        const controlRequest = {
            action: 'activate',
            leaseRef: 'opaque-lease',
        } as const;

        StalkerSessionEvents.bootstrapStalkerSessionEvents(manager);

        await invoke(STALKER_SESSION_CONTINUE, sender, continueRequest);
        await invoke(STALKER_SESSION_REQUEST, sender, operationRequest);
        await invoke(STALKER_SESSION_CONTROL, sender, controlRequest);

        expect(manager.continue).toHaveBeenCalledWith(73, continueRequest);
        expect(manager.request).toHaveBeenCalledWith(73, operationRequest);
        expect(manager.control).toHaveBeenCalledWith(73, controlRequest);
        expect(sender.once).toHaveBeenCalledTimes(1);
    });

    it.each([
        {
            channel: STALKER_SESSION_OPEN,
            request: {
                ...OPEN_REQUEST,
                token: 'raw-top-level-token',
            },
        },
        {
            channel: STALKER_SESSION_OPEN,
            request: {
                descriptor: {
                    ...OPEN_REQUEST.descriptor,
                    password: 'raw-descriptor-password',
                },
            },
        },
        {
            channel: STALKER_SESSION_CONTINUE,
            request: {
                challengeRef: 'opaque-challenge',
                response: {
                    approved: 'yes',
                    kind: 'origin-approval',
                },
            },
        },
        {
            channel: STALKER_SESSION_CONTINUE,
            request: {
                challengeRef: 'opaque-challenge',
                response: {
                    kind: 'credentials',
                    password: 'allowed-challenge-password',
                    token: 'raw-continuation-token',
                    username: 'allowed-challenge-user',
                },
            },
        },
        {
            channel: STALKER_SESSION_REQUEST,
            request: {
                leaseRef: 'opaque-lease',
                operation: 'handshake',
                parameters: {},
            },
        },
        {
            channel: STALKER_SESSION_REQUEST,
            request: {
                leaseRef: 'opaque-lease',
                operation: STALKER_SESSION_APPLICATION_OPERATIONS.CatalogItems,
                parameters: {
                    token: 'raw-parameter-token',
                },
            },
        },
        {
            channel: STALKER_SESSION_REQUEST,
            request: {
                leaseRef: 'opaque-lease',
                operation: STALKER_SESSION_APPLICATION_OPERATIONS.CatalogItems,
                parameters: {
                    query: {
                        credentials: {
                            password: 'raw-nested-secret',
                        },
                    },
                },
            },
        },
        {
            channel: STALKER_SESSION_REQUEST,
            request: {
                headers: {
                    Authorization: 'Bearer raw-authorization',
                },
                leaseRef: 'opaque-lease',
                operation: STALKER_SESSION_APPLICATION_OPERATIONS.CatalogItems,
                parameters: {},
            },
        },
        {
            channel: STALKER_SESSION_CONTROL,
            request: {
                action: 'commit',
                leaseRef: 'wrong-reference-kind',
            },
        },
        {
            channel: STALKER_SESSION_CONTROL,
            request: {
                action: 'delete-everything',
                leaseRef: 'opaque-lease',
            },
        },
    ])(
        'rejects malformed or secret-bearing $channel input before the manager',
        async ({ channel, request }) => {
            const manager = createManager();
            const sender = createSender();
            const { default: StalkerSessionEvents } =
                await import('./stalker-session.events');

            StalkerSessionEvents.bootstrapStalkerSessionEvents(manager);

            const result = invoke(channel, sender, request);

            await expect(result).rejects.toThrow(
                'stalker-session-invalid-request'
            );
            await result.catch((error: unknown) => {
                expect(String(error)).not.toMatch(
                    /raw-(?:top-level-token|descriptor-password|continuation-token|parameter-token|authorization|nested-secret)/
                );
            });
            expect(manager.open).not.toHaveBeenCalled();
            expect(manager.continue).not.toHaveBeenCalled();
            expect(manager.request).not.toHaveBeenCalled();
            expect(manager.control).not.toHaveBeenCalled();
        }
    );

    it.each(['get_profile', 'do_auth'])(
        'rejects raw full-auth operation %s',
        async (operation) => {
            const manager = createManager();
            const sender = createSender();
            const { default: StalkerSessionEvents } =
                await import('./stalker-session.events');

            StalkerSessionEvents.bootstrapStalkerSessionEvents(manager);

            await expect(
                invoke(STALKER_SESSION_REQUEST, sender, {
                    leaseRef: 'opaque-lease',
                    operation,
                    parameters: {},
                })
            ).rejects.toThrow('stalker-session-invalid-request');
            expect(manager.request).not.toHaveBeenCalled();
        }
    );

    it('preserves sender binding for foreign or expired refs and returns the manager outcome unchanged', async () => {
        const manager = createManager();
        const sender = createSender(91);
        const failure: StalkerSessionRequestOutcome = {
            kind: 'failure',
            reason: 'invalid-identity-input',
            requestId: 'manager-owned-request-id',
            retryable: false,
            stage: 'ready',
        };
        (manager.request as jest.Mock).mockResolvedValueOnce(failure);
        const { default: StalkerSessionEvents } =
            await import('./stalker-session.events');
        const request = {
            leaseRef: 'foreign-or-expired-ref',
            operation: STALKER_SESSION_APPLICATION_OPERATIONS.MainInfo,
            parameters: {},
        } as const;

        StalkerSessionEvents.bootstrapStalkerSessionEvents(manager);

        await expect(
            invoke(STALKER_SESSION_REQUEST, sender, request)
        ).resolves.toBe(failure);
        expect(manager.request).toHaveBeenCalledWith(91, request);
    });

    it('attaches one destroyed listener per sender and cleans that sender exactly once', async () => {
        const manager = createManager();
        const sender = createSender(64);
        const { default: StalkerSessionEvents } =
            await import('./stalker-session.events');

        StalkerSessionEvents.bootstrapStalkerSessionEvents(manager);
        await invoke(STALKER_SESSION_OPEN, sender, OPEN_REQUEST);
        await invoke(STALKER_SESSION_CONTROL, sender, {
            action: 'activate',
            leaseRef: 'opaque-lease',
        });

        expect(sender.once).toHaveBeenCalledTimes(1);
        const destroyed = sender.once.mock.calls[0][1] as () => void;

        destroyed();
        destroyed();

        expect(manager.cleanupSender).toHaveBeenCalledTimes(1);
        expect(manager.cleanupSender).toHaveBeenCalledWith(64);
    });

    it('does not expose manager error details to the renderer', async () => {
        const manager = createManager();
        const sender = createSender();
        const secret = 'raw-manager-token';
        (manager.open as jest.Mock).mockRejectedValueOnce(
            new Error(`portal failed with ${secret}`)
        );
        const { default: StalkerSessionEvents } =
            await import('./stalker-session.events');

        StalkerSessionEvents.bootstrapStalkerSessionEvents(manager);

        const result = invoke(STALKER_SESSION_OPEN, sender, OPEN_REQUEST);

        await expect(result).rejects.toThrow(
            'stalker-session-operation-failed'
        );
        await result.catch((error: unknown) => {
            expect(String(error)).not.toContain(secret);
        });
    });
});

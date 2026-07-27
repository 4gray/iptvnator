import {
    STALKER_SESSION_CONTINUE,
    STALKER_SESSION_CONTROL,
    STALKER_SESSION_OPEN,
    STALKER_SESSION_REQUEST,
} from './ipc-commands';
import {
    IpcCommand,
    type IpcCommandRequest,
    type IpcCommandResponse,
} from './ipc-command.class';
import {
    STALKER_SESSION_APPLICATION_OPERATIONS,
    type StalkerSessionContinueRequest,
    type StalkerSessionControlRequest,
    type StalkerSessionOpenRequest,
    type StalkerSessionRequest,
} from './stalker-session.interface';

describe('typed IPC commands', () => {
    it('maps STALKER_SESSION_OPEN to exactly one request and response type', () => {
        const request: IpcCommandRequest<typeof STALKER_SESSION_OPEN> = {
            descriptor: {
                connectionMode: 'provisional',
                macAddress: '00:1A:79:00:00:01',
                playlistRef: 'playlist-ref',
                profilePreset: {
                    id: 'mag250-public-5_1-minimal-v1',
                    version: 1,
                },
                provisionalReason: 'import',
                sourceUrl: 'https://portal.test/c/',
            },
        } satisfies StalkerSessionOpenRequest;
        const response: IpcCommandResponse<typeof STALKER_SESSION_OPEN> = {
            challengeRef: 'opaque-origin-challenge',
            finalOrigin: 'https://target.test',
            kind: 'origin-approval-required',
            requestId: 'request-id',
            sourceOrigin: 'https://portal.test',
        };
        const callback = jest.fn<
            void,
            [IpcCommandResponse<typeof STALKER_SESSION_OPEN>]
        >();

        const command = new IpcCommand(STALKER_SESSION_OPEN, callback);
        command.callback(response);

        expect(request.descriptor.sourceUrl).toBe('https://portal.test/c/');
        expect(command.id).toBe(STALKER_SESSION_OPEN);
        expect(callback).toHaveBeenCalledWith(response);
    });

    it('maps STALKER_SESSION_CONTINUE to exactly one request and response type', () => {
        const request: IpcCommandRequest<typeof STALKER_SESSION_CONTINUE> = {
            challengeRef: 'opaque-credential-challenge',
            response: {
                kind: 'credentials',
                password: 'test-only-password',
                username: 'test-only-user',
            },
        } satisfies StalkerSessionContinueRequest;
        const response: IpcCommandResponse<typeof STALKER_SESSION_CONTINUE> = {
            attemptRef: 'opaque-attempt',
            capabilities: {
                authenticatedSession: true,
                playbackContext: true,
            },
            endpoint: 'https://portal.test/server/load.php',
            kind: 'ready',
            landingUrl: 'https://portal.test/c/',
            leaseRef: 'opaque-lease',
            persistenceDraft: {
                isFullStalkerPortal: true,
                portalUrl: 'https://portal.test/server/load.php',
                stalkerLandingUrl: 'https://portal.test/c/',
                stalkerRecipeClassifierVersion: 1,
                stalkerRequestRecipe: 'full-session',
            },
            recipe: 'full-session',
            requestId: 'request-id',
        };

        expect(request.response.kind).toBe('credentials');
        expect(response.kind).toBe('ready');
    });

    it('maps STALKER_SESSION_REQUEST to exactly one request and response type', () => {
        const request: IpcCommandRequest<typeof STALKER_SESSION_REQUEST> = {
            leaseRef: 'opaque-lease',
            operation: STALKER_SESSION_APPLICATION_OPERATIONS.CatalogItems,
            parameters: { category: '10', page: 1 },
            requestId: 'request-id',
        } satisfies StalkerSessionRequest;
        const response: IpcCommandResponse<typeof STALKER_SESSION_REQUEST> = {
            kind: 'success',
            operation: STALKER_SESSION_APPLICATION_OPERATIONS.CatalogItems,
            payload: { js: { data: [] } },
            requestId: 'request-id',
        };

        expect(request.operation).toBe('get-ordered-list');
        expect(response.kind).toBe('success');
    });

    it('maps STALKER_SESSION_CONTROL to exactly one request and response type', () => {
        const request: IpcCommandRequest<typeof STALKER_SESSION_CONTROL> = {
            action: 'commit',
            attemptRef: 'opaque-attempt',
            requestId: 'request-id',
        } satisfies StalkerSessionControlRequest;
        const response: IpcCommandResponse<typeof STALKER_SESSION_CONTROL> = {
            action: 'commit',
            kind: 'success',
            requestId: 'request-id',
        };

        expect(request.action).toBe('commit');
        expect(response.kind).toBe('success');
    });

    it('keeps secret runtime state out of result DTO examples', () => {
        const outcome: IpcCommandResponse<typeof STALKER_SESSION_OPEN> = {
            kind: 'failure',
            reason: 'request-timeout',
            requestId: 'request-id',
            retryable: true,
            stage: 'handshaking',
        };
        const serializedKeys = collectKeys(outcome);

        expect(serializedKeys).not.toEqual(
            expect.arrayContaining([
                'authorization',
                'cookie',
                'password',
                'random',
                'token',
            ])
        );
    });
});

function collectKeys(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.flatMap(collectKeys);
    }
    if (typeof value !== 'object' || value === null) {
        return [];
    }

    return Object.entries(value).flatMap(([key, child]) => [
        key.toLowerCase(),
        ...collectKeys(child),
    ]);
}

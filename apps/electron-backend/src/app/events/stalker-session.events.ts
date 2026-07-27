import { ipcMain } from 'electron';
import {
    STALKER_MANAGED_REQUEST_HEADERS,
    STALKER_RESERVED_REQUEST_PARAMETERS,
    validateStalkerApplicationRequest,
} from '@iptvnator/portal/stalker/protocol';
import {
    STALKER_SESSION_CONTINUE,
    STALKER_SESSION_CONTROL,
    STALKER_SESSION_OPEN,
    STALKER_SESSION_REQUEST,
} from '@iptvnator/shared/interfaces';
import type {
    StalkerSessionApplicationOperation,
    StalkerSessionConnectionOutcome,
    StalkerSessionContinueRequest,
    StalkerSessionControlOutcome,
    StalkerSessionControlRequest,
    StalkerSessionOpenRequest,
    StalkerSessionRequest,
    StalkerSessionRequestOutcome,
} from '@iptvnator/shared/interfaces';
import { validateStalkerRuntimeInput } from '../services/stalker-session/stalker-runtime-validation';

const INVALID_REQUEST_CODE = 'stalker-session-invalid-request';
const OPERATION_FAILED_CODE = 'stalker-session-operation-failed';
const REFERENCE_MAX_BYTES = 512;
const CREDENTIAL_MAX_BYTES = 4096;
const PARAMETER_NODE_LIMIT = 256;
const FORBIDDEN_PARAMETER_KEYS = new Set<string>([
    ...STALKER_MANAGED_REQUEST_HEADERS,
    ...STALKER_RESERVED_REQUEST_PARAMETERS,
    'credential',
    'credentials',
    'headers',
]);

type StalkerSessionSender = Pick<Electron.WebContents, 'id' | 'once'>;
type StalkerSessionInvokeEvent = {
    sender: StalkerSessionSender;
};

export interface StalkerSessionManagerPort {
    open(
        senderId: number,
        request: StalkerSessionOpenRequest
    ): Promise<StalkerSessionConnectionOutcome>;
    continue(
        senderId: number,
        request: StalkerSessionContinueRequest
    ): Promise<StalkerSessionConnectionOutcome>;
    request(
        senderId: number,
        request: StalkerSessionRequest
    ): Promise<StalkerSessionRequestOutcome>;
    control(
        senderId: number,
        request: StalkerSessionControlRequest
    ): Promise<StalkerSessionControlOutcome>;
    cleanupSender(senderId: number): void | Promise<void>;
}

class StalkerSessionIpcError extends Error {
    constructor(
        code: typeof INVALID_REQUEST_CODE | typeof OPERATION_FAILED_CODE
    ) {
        super(code);
        this.name = 'StalkerSessionIpcError';
    }
}

export default class StalkerSessionEvents {
    static bootstrapStalkerSessionEvents(
        manager: StalkerSessionManagerPort
    ): Electron.IpcMain {
        const cleanupAttached = new WeakSet<StalkerSessionSender>();

        const bindSender = (event: StalkerSessionInvokeEvent): number => {
            const sender = event.sender;
            if (
                !sender ||
                !Number.isSafeInteger(sender.id) ||
                sender.id < 0 ||
                typeof sender.once !== 'function'
            ) {
                invalidRequest();
            }

            if (!cleanupAttached.has(sender)) {
                cleanupAttached.add(sender);
                let cleaned = false;
                const senderId = sender.id;
                sender.once('destroyed', () => {
                    if (cleaned) {
                        return;
                    }
                    cleaned = true;
                    void Promise.resolve(manager.cleanupSender(senderId)).catch(
                        () => undefined
                    );
                });
            }

            return sender.id;
        };

        ipcMain.handle(STALKER_SESSION_OPEN, async (event, input: unknown) => {
            const senderId = bindSender(event);
            return callManager(() =>
                manager.open(senderId, validateOpenRequest(input))
            );
        });
        ipcMain.handle(
            STALKER_SESSION_CONTINUE,
            async (event, input: unknown) => {
                const senderId = bindSender(event);
                return callManager(() =>
                    manager.continue(senderId, validateContinueRequest(input))
                );
            }
        );
        ipcMain.handle(
            STALKER_SESSION_REQUEST,
            async (event, input: unknown) => {
                const senderId = bindSender(event);
                return callManager(() =>
                    manager.request(senderId, validateApplicationRequest(input))
                );
            }
        );
        ipcMain.handle(
            STALKER_SESSION_CONTROL,
            async (event, input: unknown) => {
                const senderId = bindSender(event);
                return callManager(() =>
                    manager.control(senderId, validateControlRequest(input))
                );
            }
        );

        return ipcMain;
    }
}

async function callManager<Result>(
    operation: () => Promise<Result>
): Promise<Result> {
    try {
        return await operation();
    } catch (error) {
        if (error instanceof StalkerSessionIpcError) {
            throw error;
        }
        throw new StalkerSessionIpcError(OPERATION_FAILED_CODE);
    }
}

function validateOpenRequest(input: unknown): StalkerSessionOpenRequest {
    const request = exactRecord(input, ['descriptor']);
    try {
        return {
            descriptor: validateStalkerRuntimeInput(request['descriptor'])
                .descriptor,
        };
    } catch {
        return invalidRequest();
    }
}

function validateContinueRequest(
    input: unknown
): StalkerSessionContinueRequest {
    const request = exactRecord(input, ['challengeRef', 'response']);
    const challengeRef = opaqueRef(request['challengeRef']);
    const response = request['response'];

    if (!isRecord(response) || typeof response['kind'] !== 'string') {
        return invalidRequest();
    }

    if (response['kind'] === 'origin-approval') {
        const approval = exactRecord(response, ['approved', 'kind']);
        if (typeof approval['approved'] !== 'boolean') {
            return invalidRequest();
        }
        return {
            challengeRef,
            response: {
                approved: approval['approved'],
                kind: 'origin-approval',
            },
        };
    }

    if (response['kind'] === 'credentials') {
        const credentials = exactRecord(response, [
            'kind',
            'password',
            'username',
        ]);
        if (
            !boundedString(credentials['username'], CREDENTIAL_MAX_BYTES) ||
            !boundedString(credentials['password'], CREDENTIAL_MAX_BYTES)
        ) {
            return invalidRequest();
        }
        return {
            challengeRef,
            response: {
                kind: 'credentials',
                password: credentials['password'],
                username: credentials['username'],
            },
        };
    }

    return invalidRequest();
}

function validateApplicationRequest(input: unknown): StalkerSessionRequest {
    const request = exactRecord(input, ['leaseRef', 'operation', 'parameters']);
    const operation = request['operation'];
    const parameters = request['parameters'];

    if (
        typeof operation !== 'string' ||
        !isRecord(parameters) ||
        containsForbiddenParameter(parameters) ||
        validateStalkerApplicationRequest({
            operation,
            parameters,
        }).kind !== 'accepted'
    ) {
        return invalidRequest();
    }

    const typedOperation = operation as StalkerSessionApplicationOperation;
    return {
        leaseRef: opaqueRef(request['leaseRef']),
        operation: typedOperation,
        parameters,
    } as StalkerSessionRequest;
}

function validateControlRequest(input: unknown): StalkerSessionControlRequest {
    if (!isRecord(input) || typeof input['action'] !== 'string') {
        return invalidRequest();
    }

    switch (input['action']) {
        case 'activate':
        case 'deactivate':
        case 'close':
        case 'force-redetect': {
            const request = exactRecord(input, ['action', 'leaseRef']);
            return {
                action: input['action'],
                leaseRef: opaqueRef(request['leaseRef']),
            };
        }
        case 'commit':
        case 'discard': {
            const request = exactRecord(input, ['action', 'attemptRef']);
            return {
                action: input['action'],
                attemptRef: opaqueRef(request['attemptRef']),
            };
        }
        default:
            return invalidRequest();
    }
}

function containsForbiddenParameter(value: unknown): boolean {
    const pending = [value];
    const visited = new WeakSet<object>();
    let nodes = 0;

    while (pending.length > 0) {
        const current = pending.pop();
        if (typeof current !== 'object' || current === null) {
            continue;
        }
        if (visited.has(current)) {
            continue;
        }
        visited.add(current);

        const entries = Object.entries(current);
        nodes += entries.length;
        if (nodes > PARAMETER_NODE_LIMIT) {
            return true;
        }
        for (const [key, child] of entries) {
            if (FORBIDDEN_PARAMETER_KEYS.has(key.toLowerCase())) {
                return true;
            }
            pending.push(child);
        }
    }

    return false;
}

function exactRecord(
    input: unknown,
    expectedKeys: readonly string[]
): Readonly<Record<string, unknown>> {
    if (!isRecord(input)) {
        return invalidRequest();
    }
    const keys = Object.keys(input);
    if (
        keys.length !== expectedKeys.length ||
        expectedKeys.some(
            (key) => !Object.prototype.hasOwnProperty.call(input, key)
        ) ||
        keys.some((key) => !expectedKeys.includes(key))
    ) {
        return invalidRequest();
    }
    return input;
}

function opaqueRef(value: unknown): string {
    if (!nonEmptyBoundedString(value, REFERENCE_MAX_BYTES)) {
        return invalidRequest();
    }
    return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function boundedString(value: unknown, maxBytes: number): value is string {
    return (
        typeof value === 'string' &&
        Buffer.byteLength(value, 'utf8') <= maxBytes
    );
}

function nonEmptyBoundedString(
    value: unknown,
    maxBytes: number
): value is string {
    return boundedString(value, maxBytes) && value.trim().length > 0;
}

function invalidRequest(): never {
    throw new StalkerSessionIpcError(INVALID_REQUEST_CODE);
}

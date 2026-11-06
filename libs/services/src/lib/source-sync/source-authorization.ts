import {
    assertSourceInstance,
    isSourceBackendRequest,
    sourceConnection,
    sourceVerificationEpoch,
    invalidateSourceVerification,
    tokenKey,
} from './source-connection';

let verifiedEpoch = -1;
let refusal:
    | { connection: ReturnType<typeof sourceConnection>; status: number }
    | undefined;

export function rejectSourceInstance(
    status: number,
    connection = sourceConnection()
): void {
    if (!connection || connection !== sourceConnection()) return;
    refusal = { connection, status };
    invalidateSourceVerification();
}
export function sourceVerificationRefusal(): number | undefined {
    return refusal?.connection === sourceConnection()
        ? refusal?.status
        : undefined;
}

/** Loaded with server transports; standalone bootstrap needs only connection state. */
export function verifySourceInstance(
    value: unknown,
    expected = sourceConnection(),
    epoch = sourceVerificationEpoch()
): void {
    if (epoch !== sourceVerificationEpoch())
        throw new Error('SOURCE_SYNC.OFFLINE');
    verifiedEpoch = -1;
    try {
        assertSourceInstance(value);
        if (value.instanceId !== expected?.instanceId)
            throw new Error('SOURCE_SYNC.INSTANCE_CHANGED');
    } catch (error) {
        rejectSourceInstance(409);
        throw error;
    }
    refusal = undefined;
    verifiedEpoch = epoch;
}

/** Block the whole call: its body/query may contain provider credentials. */
export function assertSourceRequestAllowed(url: string): void {
    if (
        isSourceBackendRequest(url) &&
        verifiedEpoch !== sourceVerificationEpoch()
    )
        throw new Error('SOURCE_SYNC.INSTANCE_CHANGED');
}

export function sourceAuthorization(url: string): Record<string, string> {
    if (
        verifiedEpoch !== sourceVerificationEpoch() ||
        !isSourceBackendRequest(url)
    )
        return {};
    try {
        const token = sessionStorage.getItem(tokenKey(sourceConnection()!));
        return token ? { Authorization: `Bearer ${token}` } : {};
    } catch {
        return {};
    }
}

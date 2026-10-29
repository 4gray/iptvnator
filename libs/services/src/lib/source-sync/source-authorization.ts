import {
    assertSourceInstance,
    isSourceBackendRequest,
    sourceConnection,
    sourceVerificationEpoch,
    tokenKey,
} from './source-connection';

let verifiedEpoch = -1;

/** Loaded with server transports; standalone bootstrap needs only connection state. */
export function verifySourceInstance(
    value: unknown,
    expected = sourceConnection(),
    epoch = sourceVerificationEpoch()
): void {
    if (epoch !== sourceVerificationEpoch())
        throw new Error('SOURCE_SYNC.OFFLINE');
    verifiedEpoch = -1;
    assertSourceInstance(value);
    if (value.instanceId !== expected?.instanceId)
        throw new Error('SOURCE_SYNC.INSTANCE_CHANGED');
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

import { SERVER_USER_STATE_NAMESPACES } from '@iptvnator/shared/interfaces';

/** Presence on this device, not a server read, establishes an upgrading client. */
export function wasLegacySourceClient(instanceId: string): boolean {
    if (localStorage.getItem('iptvnator-server:cache-owner') === instanceId)
        return true;
    if (
        SERVER_USER_STATE_NAMESPACES.some(
            (key) =>
                localStorage.getItem(
                    `iptvnator-server:cache:${instanceId}:${key}`
                ) !== null
        )
    )
        return true;
    try {
        const remembered = JSON.parse(
            localStorage.getItem('iptvnator-server:instance') ?? 'null'
        );
        return (
            remembered?.instance?.storage === 'server' &&
            remembered.instance.instanceId === instanceId
        );
    } catch {
        return false;
    }
}

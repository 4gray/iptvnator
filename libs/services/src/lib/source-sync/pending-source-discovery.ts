import type {
    ServerInstanceInfo,
    SourceServerConnection,
} from '@iptvnator/shared/interfaces';
import { disconnectBrowserSourceConnection } from './source-browser-settings';

/** An unconfirmed discovery can resolve to a stateless deployment. */
export function recoverPendingStatelessBackend(
    connection: SourceServerConnection,
    value: unknown,
    reload: () => void = () => location.reload(),
    status = 200
): boolean {
    const instance = value as Partial<ServerInstanceInfo> | null;
    if (
        !connection.instanceId.startsWith('pending:') ||
        (status !== 404 &&
            (instance?.service !== 'iptvnator' ||
                instance.apiVersion !== 1 ||
                instance.storage !== 'none'))
    )
        return false;
    if (!disconnectBrowserSourceConnection(false, connection))
        throw new Error('SOURCE_SYNC.REQUEST_FAILED');
    // Keep the selected profile until reload, so in-flight work cannot write
    // to the standalone database under a different profile name.
    reload();
    return true;
}

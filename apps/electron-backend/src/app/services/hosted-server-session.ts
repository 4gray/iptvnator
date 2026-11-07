import {
    HOSTED_SERVER_PORT,
    type SourceServerConnection,
} from '@iptvnator/shared/interfaces';

export const HOSTED_SERVER_LOCAL_URL = `http://127.0.0.1:${HOSTED_SERVER_PORT}`;

let session: { instanceId: string; code: string } | undefined;

export function setHostedServerSession(value?: typeof session): void {
    session = value;
}

export function getHostedServerAccessCode(
    connection?: SourceServerConnection
): string {
    if (
        connection &&
        (connection.apiUrl !== HOSTED_SERVER_LOCAL_URL + '/api' ||
            connection.instanceId !== session?.instanceId)
    )
        return '';
    return session?.code ?? '';
}

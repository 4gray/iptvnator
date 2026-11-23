import {
    HOSTED_SERVER_PORT,
    type SourceServerConnection,
    type HostedWorkerRequest,
    type HostedWorkerResponse,
} from '@iptvnator/shared/interfaces';

export const HOSTED_SERVER_LOCAL_URL = `http://127.0.0.1:${HOSTED_SERVER_PORT}`;

let session: {
    instanceId: string;
    code: string;
    request?: (request: HostedWorkerRequest) => Promise<HostedWorkerResponse>;
} | undefined;

export function setHostedServerSession(value?: typeof session): void {
    session = value;
}

export function hostedWorkerRequest(connection?: SourceServerConnection) {
    if (connection) {
        if (connection.apiUrl !== HOSTED_SERVER_LOCAL_URL + '/api') return undefined;
        if (connection.instanceId !== session?.instanceId && session?.request)
            throw new Error('SOURCE_SYNC.INSTANCE_CHANGED');
    }
    return session?.request;
}

export function getHostedServerInstanceId(): string | undefined {
    return session?.instanceId;
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

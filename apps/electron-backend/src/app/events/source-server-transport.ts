import {
    SOURCE_SYNC_CAPABILITY,
    type SourceServerConnection,
    type SourceServerRequest,
    type SourceServerResponse,
    type ServerInstanceInfo,
} from '@iptvnator/shared/interfaces';

type Send = (
    apiUrl: string,
    token: string,
    request: SourceServerRequest,
    instanceId?: string
) => Promise<SourceServerResponse>;

/** Main-process proof is independent of renderer state and import previews. */
export class SourceServerTransport {
    private selection?: string;
    private generation = 0;
    private verified = false;

    constructor(private readonly send: Send) {}

    async execute(
        connection: SourceServerConnection,
        request: SourceServerRequest,
        token: () => string
    ): Promise<SourceServerResponse> {
        const key = JSON.stringify([connection.apiUrl, connection.instanceId]);
        if (this.selection !== key) {
            this.revoke(this.generation);
            this.selection = key;
        }
        const generation = this.generation;
        try {
            if (request.operation === 'instance')
                return await this.probe(connection, generation);
            if (!this.verified) {
                const probe = await this.probe(connection, generation);
                if (!this.verified) {
                    const body = probe.body as
                        Partial<ServerInstanceInfo> | undefined;
                    throw new Error(
                        probe.status === 200 &&
                            body?.instanceId !== connection.instanceId
                            ? 'SOURCE_SYNC.INSTANCE_CHANGED'
                            : probe.status === 401
                              ? 'SOURCE_SYNC.LOCKED'
                              : 'SOURCE_SYNC.OFFLINE'
                    );
                }
            }
            this.assertCurrent(generation);
            const response = await this.send(
                connection.apiUrl,
                token(),
                request,
                connection.instanceId
            );
            if (
                response.status === 401 ||
                response.status >= 500 ||
                (response.status === 409 &&
                    (response.body as { code?: string })?.code ===
                        'instance_changed') ||
                (response.status !== 304 &&
                    (typeof response.body !== 'object' ||
                        response.body === null))
            )
                this.revoke(generation);
            return response;
        } catch (error) {
            this.revoke(generation);
            throw error;
        }
    }

    private async probe(
        connection: SourceServerConnection,
        generation: number
    ) {
        const response = await this.send(
            connection.apiUrl,
            '',
            { operation: 'instance' },
            connection.instanceId
        );
        this.assertCurrent(generation);
        const info = response.body as Partial<ServerInstanceInfo> | undefined;
        this.verified =
            response.status === 200 &&
            info?.service === 'iptvnator' &&
            info.apiVersion === 1 &&
            info.storage === 'server' &&
            info.instanceId === connection.instanceId &&
            Array.isArray(info.capabilities) &&
            info.capabilities.includes(SOURCE_SYNC_CAPABILITY);
        if (!this.verified) this.revoke(generation);
        return response;
    }

    private assertCurrent(generation: number): void {
        if (generation !== this.generation)
            throw new Error('SOURCE_SYNC.OFFLINE');
    }

    private revoke(generation: number): void {
        if (generation !== this.generation) return;
        this.verified = false;
        this.generation++;
    }
}

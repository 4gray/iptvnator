import type { Server } from 'node:http';
import type { Express } from 'express';
import {
    HOSTED_SERVER_HTTPS_PORT,
    parseHostedHttpsOrigin,
} from '@iptvnator/shared/interfaces';
import { listenHosted } from './hosted-listener';
import { closeGracefully } from './graceful-shutdown';

/** A second listener on the same application and database, never on the LAN. */
export class HostedHttpsListener {
    private server?: Server;
    private origin = '';

    constructor(
        private readonly app: Express,
        private readonly port = HOSTED_SERVER_HTTPS_PORT
    ) {}

    async configure(value: string): Promise<string> {
        const origin = value ? parseHostedHttpsOrigin(value) : undefined;
        if ((origin?.origin ?? '') === this.origin) return this.origin;
        await this.stop();
        if (origin) {
            this.server = await listenHosted(
                this.app,
                '127.0.0.1',
                this.port,
                origin
            );
            this.origin = origin.origin;
        }
        return this.origin;
    }

    async stop(): Promise<void> {
        const server = this.server;
        this.server = undefined;
        this.origin = '';
        if (server) await closeGracefully(server, 0);
    }
}

import type { UtilityProcess } from 'electron';
import {
    HOSTED_SERVER_PORT,
    parseHostedHttpsOrigin,
    type HostedServerStatus,
} from '@iptvnator/shared/interfaces';
import { stopHostedCloudflare } from './hosted-cloudflare.service';
import { configureHostedHttps } from './hosted-https-control';

interface LegacyHostedLifecycle {
    state(): HostedServerStatus;
    setState(state: HostedServerStatus): void;
    worker(): UtilityProcess | undefined;
    availableAddresses(): string[];
    savedAddress(): string;
    stop(): Promise<void>;
    start(address: string): Promise<void>;
    run(operation: () => Promise<void>): Promise<HostedServerStatus>;
}

/** Compatibility for an older renderer issuing separate LAN and proxy commands. */
export function legacyHostedControl(
    command: unknown,
    lifecycle: LegacyHostedLifecycle
): Promise<HostedServerStatus> | undefined {
    if (!command || typeof command !== 'object') return undefined;
    if ('httpsOrigin' in command) {
        if (typeof command.httpsOrigin !== 'string')
            throw new Error('Invalid HTTPS origin');
        const origin = command.httpsOrigin
            ? parseHostedHttpsOrigin(command.httpsOrigin).origin
            : '';
        return lifecycle.run(async () => {
            stopHostedCloudflare();
            const worker = lifecycle.worker();
            const state = lifecycle.state();
            if (!worker || state.mode || state.state !== 'running')
                throw new Error('Server is unavailable');
            try {
                const result = await configureHostedHttps(worker, origin);
                lifecycle.setState({
                    ...lifecycle.state(),
                    httpsOrigin: result.origin,
                    httpsError: !!result.failed,
                });
            } catch {
                worker.kill();
                lifecycle.setState({ state: 'error', error: 'startup' });
            }
        });
    }
    if (!('restart' in command) || command.restart !== true) return undefined;
    const address = 'lanAddress' in command ? command.lanAddress : '';
    if (
        typeof address !== 'string' ||
        !lifecycle.availableAddresses().includes(address)
    )
        throw new Error('Invalid hosted server address');
    return lifecycle.run(async () => {
        const state = lifecycle.state();
        if (!lifecycle.worker() || state.mode || state.state !== 'running')
            throw new Error('Server is unavailable');
        if (state.httpsOrigin)
            throw new Error(
                'Stop HTTPS access before changing the LAN address'
            );
        if (!lifecycle.availableAddresses().includes(address))
            throw new Error('Invalid hosted server address');
        const previousAddress = lifecycle.savedAddress();
        await lifecycle.stop();
        await lifecycle.start(address);
        if (
            lifecycle.state().lanUrl ===
            `http://${address}:${HOSTED_SERVER_PORT}`
        )
            return;

        if (lifecycle.worker()) await lifecycle.stop();
        await lifecycle.start(previousAddress);
        if (lifecycle.state().state === 'running')
            throw new Error(
                'LAN access could not be enabled; previous server settings restored'
            );
        throw new Error(
            'LAN access could not be enabled and previous server settings could not be restored'
        );
    });
}

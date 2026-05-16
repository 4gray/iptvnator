import * as http from 'http';
import * as https from 'https';
import { isIP } from 'net';
import {
    SourceVpnRequestContext,
    VpnIntegrationStatus,
} from 'shared-interfaces';
import {
    protonVpnIntegration,
    ProtonVpnIntegrationResult,
} from './proton-vpn-integration.service';

let cachedAgents:
    | {
          localAddress: string;
          httpAgent: http.Agent;
          httpsAgent: https.Agent;
      }
    | null
    | undefined;

export class SourceVpnNotReadyError extends Error {
    readonly result: ProtonVpnIntegrationResult;
    readonly status = 599;

    constructor(result: ProtonVpnIntegrationResult) {
        super(
            result.reason
                ? `VPN is required but not ready: ${result.reason}`
                : 'VPN is required but not ready'
        );
        this.name = 'SourceVpnNotReadyError';
        this.result = result;
    }
}

export function getSourceLocalAddress(): string | undefined {
    const localAddress = process.env.IPTVNATOR_SOURCE_LOCAL_ADDRESS?.trim();
    if (!localAddress || !isIP(localAddress)) {
        return undefined;
    }

    return localAddress;
}

export function getSourceAxiosAgents():
    | {
          httpAgent: http.Agent;
          httpsAgent: https.Agent;
      }
    | Record<string, never> {
    const localAddress = getSourceLocalAddress();
    if (!localAddress) {
        return {};
    }

    if (cachedAgents?.localAddress !== localAddress) {
        cachedAgents = {
            localAddress,
            httpAgent: new http.Agent({
                keepAlive: true,
                localAddress,
            }),
            httpsAgent: new https.Agent({
                keepAlive: true,
                localAddress,
            }),
        };
    }

    return {
        httpAgent: cachedAgents.httpAgent,
        httpsAgent: cachedAgents.httpsAgent,
    };
}

export function getSourceRequestOptions():
    | {
          localAddress: string;
      }
    | Record<string, never> {
    const localAddress = getSourceLocalAddress();
    return localAddress ? { localAddress } : {};
}

function normalizeDetectedLocalAddress(value: unknown): string | undefined {
    const localAddress = typeof value === 'string' ? value.trim() : '';
    return localAddress && isIP(localAddress) ? localAddress : undefined;
}

export async function ensureSourceNetworkReady(
    sourceVpn?: SourceVpnRequestContext
): Promise<VpnIntegrationStatus | null> {
    const result = await protonVpnIntegration.prepareForSourceNetwork(sourceVpn);
    if (!result.enabled || result.provider !== 'proton') {
        return {
            ...result,
            enabled: Boolean(result.enabled),
            platform: process.platform,
            provider: result.provider ?? 'none',
            lastCheckedAt: result.lastCheckedAt ?? Date.now(),
        };
    }

    const localAddress =
        getSourceLocalAddress() ??
        normalizeDetectedLocalAddress(result.localAddress);
    if (
        result.status !== 'configured' ||
        !localAddress
    ) {
        throw new SourceVpnNotReadyError(result);
    }

    process.env.IPTVNATOR_SOURCE_LOCAL_ADDRESS = localAddress;

    return {
        ...result,
        enabled: true,
        localAddress,
        platform: process.platform,
        provider: result.provider ?? 'proton',
        lastCheckedAt: result.lastCheckedAt ?? Date.now(),
    };
}

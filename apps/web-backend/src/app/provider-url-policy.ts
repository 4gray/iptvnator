import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

export interface ProviderUrlPolicy {
    readonly allowPrivateNetworkTargets: boolean;
    readonly resolveHostname: (hostname: string) => Promise<readonly string[]>;
}

export interface ProviderUrlError {
    readonly message: string;
    readonly status: number;
    readonly lookupError?: unknown;
}

export interface ValidatedProviderTarget {
    readonly url: URL;
    readonly addresses: readonly string[];
}

export function providerUrlErrorBody(error: ProviderUrlError): {
    message: string;
    status: number;
} {
    return { message: error.message, status: error.status };
}

export async function resolveHostname(
    hostname: string
): Promise<readonly string[]> {
    const records = await lookup(hostname, { all: true, verbatim: true });
    return records.map((record) => record.address);
}

export async function validateProviderUrl(
    rawUrl: string,
    policy: ProviderUrlPolicy
): Promise<ValidatedProviderTarget | ProviderUrlError> {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        return { message: 'Provider URL is not a valid URL', status: 400 };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return {
            message: 'Only http and https provider URLs are supported',
            status: 400,
        };
    }
    if (url.username || url.password) {
        return {
            message: 'Provider URL credentials are not supported',
            status: 400,
        };
    }
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const local = hostname.replace(/\.$/, '');
    if (
        !policy.allowPrivateNetworkTargets &&
        (local === 'localhost' ||
            local.endsWith('.localhost') ||
            (isIP(hostname) !== 0 && !isPublicAddress(hostname)))
    ) {
        return privateAddressError();
    }
    let addresses: readonly string[];
    try {
        addresses = isIP(hostname)
            ? [hostname]
            : await policy.resolveHostname(hostname);
    } catch (lookupError) {
        return {
            message: 'Provider URL host could not be resolved',
            status: 400,
            lookupError,
        };
    }
    // Validate every answer; never let a malformed record trigger a second DNS
    // lookup in the transport. Even trusted LAN mode requires concrete IPs.
    if (!addresses.length || addresses.some((address) => !isIP(address))) {
        return {
            message: 'Provider URL host could not be resolved',
            status: 400,
        };
    }
    if (
        !policy.allowPrivateNetworkTargets &&
        addresses.some((address) => !isPublicAddress(address))
    ) {
        return privateAddressError();
    }
    return { url, addresses: [...addresses] };
}

function privateAddressError(): ProviderUrlError {
    return {
        message: 'Provider URL points to a private or local network address',
        status: 400,
    };
}

const blockedV4 = new BlockList();
for (const [network, prefix] of [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.88.99.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 3],
] as const)
    blockedV4.addSubnet(network, prefix, 'ipv4');

const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
const blockedV6 = new BlockList();
for (const [network, prefix] of [
    ['2001::', 23], // Protocol assignments (including Teredo / benchmarking).
    ['2001:db8::', 32],
    ['2002::', 16], // Documentation / 6to4.
    ['3fff::', 20], // Documentation.
] as const)
    blockedV6.addSubnet(network, prefix, 'ipv6');
const mappedV4 = new BlockList();
mappedV4.addSubnet('::ffff:0:0', 96, 'ipv6');

function isPublicAddress(address: string): boolean {
    if (isIP(address) === 4) return !blockedV4.check(address, 'ipv4');
    // Node BlockList handles IPv4-mapped IPv6 in both dotted and hex forms.
    if (mappedV4.check(address, 'ipv6'))
        return !blockedV4.check(address, 'ipv6');
    return globalV6.check(address, 'ipv6') && !blockedV6.check(address, 'ipv6');
}

import type { APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { postWithRetry } from './e2e-helpers';

export const XTREAM_MOCK_SERVER = `http://localhost:${process.env['XTREAM_MOCK_PORT'] ?? '3211'}`;
export const STALKER_MOCK_SERVER = `http://localhost:${process.env['MOCK_PORT'] ?? '3210'}`;
export const STALKER_PORTAL_URL = `${STALKER_MOCK_SERVER}/portal.php`;

export interface PwaMockIdentity {
    username: string;
    password: string;
    macAddress: string;
    editedMacAddress: string;
}

let nextIdentity = 0;

/** Distinct worker bytes plus a per-worker counter reserve two MACs per test. */
export function createPwaMockIdentity(parallelIndex: number): PwaMockIdentity {
    const ordinal = ++nextIdentity;
    if (
        !Number.isInteger(parallelIndex) ||
        parallelIndex < 0 ||
        parallelIndex > 63 ||
        ordinal > 32767
    ) {
        throw new Error('PWA mock identity range exhausted');
    }
    const mac = (slot: number) =>
        `00:1A:79:${[0xc0 + parallelIndex, slot >> 8, slot & 255]
            .map((byte) => byte.toString(16).padStart(2, '0').toUpperCase())
            .join(':')}`;
    return {
        username: `pwa-${randomUUID().replace(/-/g, '')}`,
        password: 'pass1',
        macAddress: mac(ordinal * 2),
        editedMacAddress: mac(ordinal * 2 + 1),
    };
}

/** No unscoped reset: another test may be using either mock right now. */
export async function resetPwaMockServers(
    request: APIRequestContext,
    identity: PwaMockIdentity
): Promise<void> {
    const account = new URLSearchParams({
        username: identity.username,
        password: identity.password,
    });
    await postWithRetry(request, `${XTREAM_MOCK_SERVER}/reset?${account}`);
    const macs = new URLSearchParams();
    for (const mac of [identity.macAddress, identity.editedMacAddress]) {
        macs.append('macAddress', mac);
    }
    await postWithRetry(request, `${STALKER_MOCK_SERVER}/reset?${macs}`);
}

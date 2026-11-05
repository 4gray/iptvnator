import type { APIRequestContext } from '@playwright/test';
import { expect, test } from './pwa-mock.fixture';
import {
    createPwaMockIdentity,
    resetPwaMockServers,
    STALKER_MOCK_SERVER,
    XTREAM_MOCK_SERVER,
} from './pwa-mock-state';

// Two worker slots each exercise overlapping resource lifetimes. The reset is
// deliberately inside B's scenario, after its session/favorite are established.
// No scheduling race or timeout is needed to trigger the old shared-MAC bug.
test.describe.configure({ mode: 'parallel' });

async function portalRequest(
    request: APIRequestContext,
    macAddress: string,
    action: string,
    token = '',
    extra: Record<string, string> = {}
) {
    return request.get(`${STALKER_MOCK_SERVER}/server/load.php`, {
        headers: {
            Cookie: `mac=${macAddress}`,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        params: { macAddress, action, type: 'itv', ...extra },
    });
}

async function startSession(request: APIRequestContext, mac: string) {
    const handshake = await portalRequest(request, mac, 'handshake');
    const token: string = (await handshake.json()).js.token;
    const profile = await portalRequest(request, mac, 'get_profile', token);
    expect((await profile.json()).js.status).toBe(0);
    const channels = await portalRequest(
        request,
        mac,
        'get_all_channels',
        token
    );
    const id: string = (await channels.json()).js.data[0].id;
    await portalRequest(request, mac, 'favorites', token, {
        fav_action: 'add',
        item_id: id,
    });
    return { token, id };
}

for (const slot of ['alpha', 'beta']) {
    test(`@pwa @mocks scoped reset preserves another active scenario (${slot})`, async ({
        request,
        pwaMocks,
    }, testInfo) => {
        const peer = createPwaMockIdentity(testInfo.parallelIndex);
        expect(peer.username).not.toBe(pwaMocks.username);
        expect(
            new Set([
                peer.macAddress,
                peer.editedMacAddress,
                pwaMocks.macAddress,
                pwaMocks.editedMacAddress,
            ]).size
        ).toBe(4);
        await resetPwaMockServers(request, peer);
        try {
            const [owner, edited, other] = await Promise.all([
                startSession(request, pwaMocks.macAddress),
                startSession(request, pwaMocks.editedMacAddress),
                startSession(request, peer.macAddress),
            ]);
            const catalog = async (username: string) => {
                const response = await request.get(
                    `${XTREAM_MOCK_SERVER}/player_api.php`,
                    {
                        params: {
                            username,
                            password: 'pass1',
                            action: 'get_vod_streams',
                        },
                    }
                );
                expect(response.ok()).toBe(true);
                return (await response.json()).map(
                    (item: { stream_id: number }) => item.stream_id
                );
            };
            const peerCatalog = await catalog(peer.username);
            await Promise.all([
                resetPwaMockServers(request, pwaMocks),
                portalRequest(
                    request,
                    peer.macAddress,
                    'get_events',
                    other.token
                ),
                catalog(peer.username),
            ]);
            const favorites = await portalRequest(
                request,
                peer.macAddress,
                'favorites',
                other.token
            );
            expect(
                (await favorites.json()).js.data.map(
                    (item: { id: string }) => item.id
                )
            ).toEqual([other.id]);
            const handshake = await portalRequest(
                request,
                peer.macAddress,
                'handshake',
                other.token,
                { token: other.token }
            );
            expect((await handshake.json()).js.token).toBe(other.token);
            expect(await catalog(peer.username)).toEqual(peerCatalog);
            for (const [mac, session] of [
                [pwaMocks.macAddress, owner],
                [pwaMocks.editedMacAddress, edited],
            ] as const) {
                const cleared = await portalRequest(
                    request,
                    mac,
                    'favorites',
                    session.token
                );
                expect(await cleared.text()).toBe('Authorization failed.');
            }
        } finally {
            await resetPwaMockServers(request, peer);
        }
    });
}

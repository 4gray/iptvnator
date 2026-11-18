import {
    isTmdbTransferCapability,
    isTmdbTransferCode,
    type TmdbTransferRequest,
    type TmdbTransferSession,
} from '@iptvnator/shared/interfaces';
import { withTempStorage } from '../storage/server-storage.spec-helpers';
import { createWebBackendApp } from '../web-backend-app';
import { withServer } from '../web-backend-app.spec-helpers';

const token = 'synthetic-server-access';
const key = 'synthetic-tmdb-transfer-key';

describe('TMDB transfer', () => {
    const withTransfer = (
        run: (
            post: (
                request: TmdbTransferRequest,
                headers?: Record<string, string>
            ) => Promise<Response>
        ) => Promise<void>
    ) =>
        withTempStorage((storage) =>
            withServer(
                createWebBackendApp({ storage, accessToken: token }),
                (base) =>
                    run((request, headers) =>
                        fetch(`${base}/v1/tmdb-transfer`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-IPTVnator-Instance-Id':
                                    storage.database.instanceId,
                                Authorization: `Bearer ${token}`,
                                ...headers,
                            },
                            body: JSON.stringify(request),
                        })
                    )
            )
        );

    it('requires access and the selected instance, then allows exactly one receiver claim', () =>
        withTransfer(async (post) => {
            expect(
                (await post({ action: 'start' }, { Authorization: '' })).status
            ).toBe(401);
            expect(
                (
                    await post(
                        { action: 'start' },
                        { 'X-IPTVnator-Instance-Id': 'other' }
                    )
                ).status
            ).toBe(409);
            const start = await post({ action: 'start', codeFormat: 'short' });
            expect(start.status).toBe(201);
            const { senderToken, receiverToken } =
                (await start.json()) as TmdbTransferSession;
            expect(isTmdbTransferCode(senderToken)).toBe(true);
            expect(isTmdbTransferCapability(receiverToken)).toBe(true);
            expect(
                (
                    await post({
                        action: 'send',
                        transferToken: receiverToken,
                        apiKey: key,
                    })
                ).status
            ).toBe(410);
            expect(
                (
                    await post({
                        action: 'send',
                        transferToken: senderToken,
                        apiKey: 'invalid\nvalue',
                    })
                ).status
            ).toBe(400);
            expect(
                (
                    await post({
                        action: 'send',
                        transferToken: senderToken,
                        apiKey: key,
                    })
                ).status
            ).toBe(200);
            expect(
                (
                    await post({
                        action: 'send',
                        transferToken: senderToken,
                        apiKey: 'synthetic-other-key',
                    })
                ).status
            ).toBe(409);
            expect(
                await (
                    await post({ action: 'check', transferToken: senderToken })
                ).json()
            ).toEqual({ status: 'ready' });
            expect(
                await (
                    await post({
                        action: 'status',
                        transferToken: receiverToken,
                    })
                ).json()
            ).toEqual({ status: 'ready' });
            expect(
                (await post({ action: 'claim', transferToken: senderToken }))
                    .status
            ).toBe(410);
            const responses = await Promise.all([
                post({ action: 'claim', transferToken: receiverToken }),
                post({ action: 'claim', transferToken: receiverToken }),
            ]);
            expect(responses.map(({ status }) => status).sort()).toEqual([
                200, 410,
            ]);
            const claimed = responses.find(({ status }) => status === 200);
            if (!claimed) throw new Error('Claim did not succeed');
            expect(claimed.headers.get('cache-control')).toBe('no-store');
            expect(await claimed.json()).toEqual({ apiKey: key });
            expect(
                (
                    await post({
                        action: 'send',
                        transferToken: senderToken,
                        apiKey: key,
                    })
                ).status
            ).toBe(410);
        }));

    it('retains the original sender capability for clients without a format preference', () =>
        withTransfer(async (post) => {
            const { senderToken } = (await (
                await post({ action: 'start' })
            ).json()) as TmdbTransferSession;
            expect(isTmdbTransferCapability(senderToken)).toBe(true);
            expect(
                (await post({ action: 'check', transferToken: senderToken }))
                    .status
            ).toBe(200);
        }));

    it('limits short code checks and sends together without affecting receiver polling', () =>
        withTransfer(async (post) => {
            const { senderToken, receiverToken } = (await (
                await post({ action: 'start', codeFormat: 'short' })
            ).json()) as TmdbTransferSession;
            const wrongCode = senderToken === '2222' ? '3333' : '2222';
            for (let attempt = 0; attempt < 12; attempt++) {
                const response = await post({
                    action: 'check',
                    transferToken: wrongCode,
                });
                expect(response.status).toBe(410);
            }
            expect(
                (
                    await post({
                        action: 'send',
                        transferToken: senderToken,
                        apiKey: key,
                    })
                ).status
            ).toBe(429);
            expect(
                await (
                    await post({
                        action: 'status',
                        transferToken: receiverToken,
                    })
                ).json()
            ).toEqual({ status: 'waiting' });
        }));

    it.each(['cancel', 'expire'] as const)(
        'discards a pending key after %s',
        (action) =>
            withTransfer(async (post) => {
                const { senderToken, receiverToken, expiresInMs } = (await (
                    await post({ action: 'start', codeFormat: 'short' })
                ).json()) as TmdbTransferSession;
                expect(
                    (
                        await post({
                            action: 'send',
                            transferToken: senderToken,
                            apiKey: key,
                        })
                    ).status
                ).toBe(200);
                const clock =
                    action === 'expire'
                        ? jest
                              .spyOn(Date, 'now')
                              .mockReturnValue(Date.now() + expiresInMs + 1)
                        : undefined;
                try {
                    if (action === 'cancel')
                        expect(
                            (
                                await post({
                                    action: 'cancel',
                                    transferToken: receiverToken,
                                })
                            ).status
                        ).toBe(200);
                    expect(
                        (
                            await post({
                                action: 'claim',
                                transferToken: receiverToken,
                            })
                        ).status
                    ).toBe(410);
                    expect(
                        (
                            await post({
                                action: 'check',
                                transferToken: senderToken,
                            })
                        ).status
                    ).toBe(410);
                } finally {
                    clock?.mockRestore();
                }
            })
    );
});

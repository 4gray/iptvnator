import { firstValueFrom, of, Subject, throwError } from 'rxjs';
import { ProviderTargetClient } from './provider-target-client';

const missing = () => ({
    status: 404,
    error: { code: 'PROVIDER_TARGET_NOT_FOUND' },
});

describe('provider target recovery', () => {
    it('bounds cached URLs and registers evicted URLs normally', async () => {
        const register = jest.fn().mockResolvedValue('id');
        const client = new ProviderTargetClient(register);
        for (let index = 0; index <= 256; index++) {
            await firstValueFrom(
                client.request(`https://provider.test/${index}`, () => of('ok'))
            );
        }
        await firstValueFrom(
            client.request('https://provider.test/0', () => of('ok'))
        );
        expect(register).toHaveBeenCalledTimes(258);
    });

    it('registers again once after a backend restart', async () => {
        const register = jest
            .fn()
            .mockResolvedValueOnce('old')
            .mockResolvedValue('new');
        const client = new ProviderTargetClient(register);
        const send = jest.fn((id: string) =>
            id === 'old' ? throwError(missing) : of('catalog')
        );
        await expect(
            firstValueFrom(client.request('https://provider.test', send))
        ).resolves.toBe('catalog');
        expect(register).toHaveBeenCalledTimes(2);
        expect(send.mock.calls.map(([id]) => id)).toEqual(['old', 'new']);
    });

    it('coalesces concurrent recovery even when IDs remain deterministic', async () => {
        const register = jest.fn().mockResolvedValue('same-id');
        const client = new ProviderTargetClient(register);
        const staleA = new Subject<string>();
        const staleB = new Subject<string>();
        const sendA = jest
            .fn()
            .mockReturnValueOnce(staleA)
            .mockReturnValue(of('A'));
        const sendB = jest
            .fn()
            .mockReturnValueOnce(staleB)
            .mockReturnValue(of('B'));
        const a = firstValueFrom(
            client.request('https://provider.test', sendA)
        );
        const b = firstValueFrom(
            client.request('https://provider.test', sendB)
        );
        await Promise.resolve();
        staleA.error(missing());
        await Promise.resolve();
        staleB.error(missing());
        await expect(Promise.all([a, b])).resolves.toEqual(['A', 'B']);
        expect(register).toHaveBeenCalledTimes(2);
    });

    it('does not loop or retry ordinary provider errors', async () => {
        const register = jest.fn().mockResolvedValue('id');
        const client = new ProviderTargetClient(register);
        const send = jest.fn(() => throwError(missing));
        await expect(
            firstValueFrom(client.request('https://one.test', send))
        ).rejects.toEqual(missing());
        expect(send).toHaveBeenCalledTimes(2);
        const ordinary = {
            status: 404,
            error: { message: 'Channel not found' },
        };
        const provider404 = jest.fn(() => throwError(() => ordinary));
        await expect(
            firstValueFrom(client.request('https://two.test', provider404))
        ).rejects.toBe(ordinary);
        expect(provider404).toHaveBeenCalledTimes(1);
    });

    it('preserves cancellation of a subscribed HTTP request', async () => {
        const pending = new Subject<string>();
        const client = new ProviderTargetClient(async () => 'id');
        const subscription = client
            .request('https://one.test', () => pending)
            .subscribe();
        await Promise.resolve();
        expect(pending.observed).toBe(true);
        subscription.unsubscribe();
        expect(pending.observed).toBe(false);
    });

    it('recovers fetch-based Stalker calls and accepts the older backend message', async () => {
        const register = jest.fn().mockResolvedValue('id');
        const client = new ProviderTargetClient(register);
        const send = jest
            .fn()
            .mockResolvedValueOnce({
                status: 404,
                json: async () => ({ message: 'Provider target not found' }),
            })
            .mockResolvedValue({ status: 200 });
        await expect(
            client.fetch('https://one.test', send)
        ).resolves.toMatchObject({ status: 200 });
        expect(register).toHaveBeenCalledTimes(2);
    });
});

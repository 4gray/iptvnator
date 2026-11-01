import { firstValueFrom, of } from 'rxjs';
import { EpgLookupLoader } from './epg-lookup-loader';
import type { EpgLookupContext } from './epg-lookup-context';
import type { EpgLookups } from './epg-lookups';

describe('Lazy EPG read helpers', () => {
    const context = { guard: () => (source) => source } as EpgLookupContext;
    const lookups = {} as EpgLookups;
    const module = { createEpgLookups: jest.fn(() => lookups) };
    let enabled: boolean;
    let revision: number;

    beforeEach(() => {
        enabled = true;
        revision = 0;
        module.createEpgLookups.mockClear();
    });

    it('loads only for a subscribed lookup and shares one module across concurrent reads', async () => {
        const load = jest.fn().mockResolvedValue(module);
        const loader = new EpgLookupLoader(
            context,
            () => enabled,
            () => revision,
            load
        );
        const query = jest.fn(() => of('synthetic result'));
        const first = loader.run(query, 'empty');
        expect(load).not.toHaveBeenCalled();

        expect(
            await Promise.all([
                firstValueFrom(first),
                firstValueFrom(loader.run(query, 'empty')),
            ])
        ).toEqual(['synthetic result', 'synthetic result']);
        expect(load).toHaveBeenCalledTimes(1);
        expect(module.createEpgLookups).toHaveBeenCalledTimes(1);
        expect(query).toHaveBeenCalledWith(lookups);
    });

    it('does not load code or request guide data while disabled', async () => {
        enabled = false;
        const load = jest.fn().mockResolvedValue(module);
        const loader = new EpgLookupLoader(
            context,
            () => enabled,
            () => revision,
            load
        );
        const query = jest.fn(() => of('synthetic result'));

        expect(
            await firstValueFrom(loader.run(query, 'empty'), {
                defaultValue: 'cancelled',
            })
        ).toBe('cancelled');
        expect(load).not.toHaveBeenCalled();
        expect(query).not.toHaveBeenCalled();
    });

    it('retires a request before subscription if its sources changed', async () => {
        const load = jest.fn().mockResolvedValue(module);
        const loader = new EpgLookupLoader(
            context,
            () => enabled,
            () => revision,
            load
        );
        const query = jest.fn(() => of('synthetic result'));
        const request = loader.run(query, 'empty');
        revision++;

        expect(
            await firstValueFrom(request, { defaultValue: 'cancelled' })
        ).toBe('cancelled');
        expect(load).not.toHaveBeenCalled();
        expect(query).not.toHaveBeenCalled();
    });

    it('does not start a retired lookup after an off/on cycle during chunk loading', async () => {
        let finish!: (loaded: typeof module) => void;
        const load = jest.fn(
            () =>
                new Promise<typeof module>((resolve) => {
                    finish = resolve;
                })
        );
        const loader = new EpgLookupLoader(
            context,
            () => enabled,
            () => revision,
            load
        );
        const query = jest.fn(() => of('synthetic result'));
        const pending = firstValueFrom(loader.run(query, 'empty'), {
            defaultValue: 'cancelled',
        });
        enabled = false;
        revision++;
        enabled = true;
        revision++;
        finish(module);

        expect(await pending).toBe('cancelled');
        expect(query).not.toHaveBeenCalled();
        expect(await firstValueFrom(loader.run(query, 'empty'))).toBe(
            'synthetic result'
        );
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('retries a failed chunk on the next lookup without requesting guide data on failure', async () => {
        const load = jest
            .fn()
            .mockRejectedValueOnce(new Error('Synthetic chunk unavailable'))
            .mockResolvedValue(module);
        const loader = new EpgLookupLoader(
            context,
            () => enabled,
            () => revision,
            load
        );
        const query = jest.fn(() => of('synthetic result'));

        expect(await firstValueFrom(loader.run(query, 'empty'))).toBe('empty');
        expect(query).not.toHaveBeenCalled();
        expect(await firstValueFrom(loader.run(query, 'empty'))).toBe(
            'synthetic result'
        );
        expect(load).toHaveBeenCalledTimes(2);
    });
});

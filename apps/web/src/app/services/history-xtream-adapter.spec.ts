import type { IXtreamDataSource } from '@iptvnator/portal/xtream/data-access';
import type { HistorySyncClient } from '@iptvnator/services/history-sync';
import { HistoryXtreamAdapter } from './history-xtream-adapter';

describe('Xtream confirmations in portable history', () => {
    it.each([
        ['2026-01-01T00:00:00.000Z', { viewedAt: 1767225600000 }],
        ['invalid', {}],
        [undefined, {}],
    ])('forwards the confirmation time when valid: %s', async (date, time) => {
        const command = jest.fn().mockResolvedValue(undefined);
        const client = {
            scope: jest.fn().mockResolvedValue({}),
            current: jest.fn(),
            options: { consent: () => 'synthetic-consent' },
            command,
        } as unknown as HistorySyncClient;
        const adapter = new HistoryXtreamAdapter(client, true, {
            active: () => false,
            withholdsEverything: () => false,
            version: () => 0,
        });
        const raw = {
            getContentByXtreamId: jest
                .fn()
                .mockResolvedValue({ title: 'Synthetic live channel' }),
        } as unknown as IXtreamDataSource;

        await adapter.invoke(raw, 'addRecentItem', [
            { id: 9, type: 'live', providerId: 42 },
            'synthetic-source',
            undefined,
            undefined,
            date,
        ]);

        expect(command).toHaveBeenCalledWith(
            'synthetic-source',
            {
                kind: 'touch',
                reference: { provider: 'xtream', kind: 'live', id: '42' },
                snapshot: { title: 'Synthetic live channel' },
                ...time,
            },
            false
        );
    });
});

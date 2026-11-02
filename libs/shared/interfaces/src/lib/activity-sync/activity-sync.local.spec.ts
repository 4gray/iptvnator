import {
    appendActivityIntent,
    assertActivityLocalRecord,
} from './activity-sync.local';
import { emptyActivityState } from './activity-sync.reducer';
import type {
    ActivityAddress,
    ActivityPendingOperation,
} from './activity-sync.contract';
const address: ActivityAddress = {
    instanceId: 'synthetic-instance',
    scope: 'shared',
    sourceId: 'synthetic-source',
    sourceIncarnation: 'synthetic-incarnation',
    content: { provider: 'xtream', kind: 'vod', id: '1' },
};
const pending: ActivityPendingOperation = {
    address,
    consentGeneration: 'synthetic-consent',
    operation: {
        kind: 'reset',
        operationId: 'synthetic-operation',
        deviceId: 'synthetic-device',
        expectedRevision: 0,
    },
};
describe('local activity delivery metadata', () => {
    it('accepts historical records without a lease and preserves optional ownership', () => {
        expect(() =>
            assertActivityLocalRecord(
                address,
                appendActivityIntent(null, emptyActivityState(), pending)
            )
        ).not.toThrow();
        const leased = {
            ...pending,
            deliveryLease: { owner: 'synthetic-origin', expiresAt: 1000 },
        };
        expect(
            appendActivityIntent(null, emptyActivityState(), leased).pending[0]
        ).toEqual(leased);
    });
    it.each([-1, NaN, Infinity, 0.5])(
        'rejects invalid lease time %s',
        (expiresAt) => {
            expect(() =>
                appendActivityIntent(null, emptyActivityState(), {
                    ...pending,
                    deliveryLease: { owner: 'synthetic-origin', expiresAt },
                })
            ).toThrow('Invalid activity delivery lease');
        }
    );
    it('rejects an invalid owner token', () => {
        expect(() =>
            appendActivityIntent(null, emptyActivityState(), {
                ...pending,
                deliveryLease: { owner: '', expiresAt: 1000 },
            })
        ).toThrow();
    });
});

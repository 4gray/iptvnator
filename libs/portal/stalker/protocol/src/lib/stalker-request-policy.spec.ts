import {
    STALKER_APPLICATION_OPERATIONS,
    validateStalkerApplicationRequest,
} from './stalker-request-policy';

describe('Stalker application request policy', () => {
    it.each(['handshake', 'get_profile', 'do_auth'])(
        'rejects the raw auth action %s',
        (operation) => {
            expect(
                validateStalkerApplicationRequest({ operation, parameters: {} })
            ).toEqual({
                kind: 'rejected',
                reason: 'unsupported-operation',
            });
        }
    );

    it.each([
        'action',
        'token',
        'prehash',
        'auth_second_step',
        'login',
        'password',
        'mac',
        'serial',
        'device_id',
        'signature',
        'metrics',
        'stb_lang',
        'timezone',
        'JsHttpRequest',
    ])('rejects the reserved parameter %s', (parameter) => {
        expect(
            validateStalkerApplicationRequest({
                operation: STALKER_APPLICATION_OPERATIONS.CatalogItems,
                parameters: { [parameter]: 'renderer-value' },
            })
        ).toEqual({
            field: parameter,
            kind: 'rejected',
            reason: 'reserved-parameter',
        });
    });

    it.each([
        'Authorization',
        'Cookie',
        'X-User-Agent',
        'SN',
        'User-Agent',
        'Origin',
        'Referer',
        'Accept-Language',
    ])('rejects the managed header %s', (header) => {
        expect(
            validateStalkerApplicationRequest({
                headers: { [header]: 'renderer-value' },
                operation: STALKER_APPLICATION_OPERATIONS.CreateLink,
                parameters: {},
            })
        ).toEqual({
            field: header,
            kind: 'rejected',
            reason: 'reserved-header',
        });
    });

    it('accepts an allowlisted operation with non-reserved parameters', () => {
        expect(
            validateStalkerApplicationRequest({
                operation: STALKER_APPLICATION_OPERATIONS.CatalogItems,
                parameters: {
                    category: '10',
                    page: 2,
                    search: 'News',
                },
            })
        ).toEqual({ kind: 'accepted' });
    });
});

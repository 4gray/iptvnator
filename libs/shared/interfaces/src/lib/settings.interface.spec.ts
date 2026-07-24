import {
    DEFAULT_LOCAL_TIMESHIFT_SETTINGS,
    normalizeLocalTimeshiftSettings,
} from './settings.interface';

describe('normalizeLocalTimeshiftSettings', () => {
    it('returns safe defaults when settings are missing', () => {
        expect(normalizeLocalTimeshiftSettings()).toEqual(
            DEFAULT_LOCAL_TIMESHIFT_SETTINGS
        );
        expect(normalizeLocalTimeshiftSettings(null)).toEqual(
            DEFAULT_LOCAL_TIMESHIFT_SETTINGS
        );
    });

    it('keeps a valid local timeshift configuration', () => {
        expect(
            normalizeLocalTimeshiftSettings({
                enabled: true,
                maxDurationMinutes: 90,
                bufferDirectory: '  /tmp/iptvnator-timeshift  ',
            })
        ).toEqual({
            enabled: true,
            maxDurationMinutes: 90,
            bufferDirectory: '/tmp/iptvnator-timeshift',
        });
    });

    it.each([4, 181, 30.5, Number.NaN, Number.POSITIVE_INFINITY])(
        'falls back for invalid duration %s',
        (maxDurationMinutes) => {
            expect(
                normalizeLocalTimeshiftSettings({ maxDurationMinutes })
                    .maxDurationMinutes
            ).toBe(DEFAULT_LOCAL_TIMESHIFT_SETTINGS.maxDurationMinutes);
        }
    );

    it('normalizes invalid persisted field types independently', () => {
        expect(
            normalizeLocalTimeshiftSettings({
                enabled: 'yes',
                maxDurationMinutes: '60',
                bufferDirectory: 42,
            })
        ).toEqual(DEFAULT_LOCAL_TIMESHIFT_SETTINGS);
    });
});

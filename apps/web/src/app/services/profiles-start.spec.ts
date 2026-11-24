import {
    DEFAULT_PROFILE_ID,
    type ServerProfileList,
} from '@iptvnator/shared/interfaces/profiles';
import {
    needsPicker,
    resolveActiveProfileId,
    type ProfilesStartInput,
} from './profiles-start';

const ADULT = '11111111-1111-4111-8111-111111111111';
const PIN_ADULT = '22222222-2222-4222-8222-222222222222';
const STALE = '33333333-3333-4333-8333-333333333333';

const onlyDefault = [{ id: DEFAULT_PROFILE_ID, hasPin: false }];
const household = [
    { id: DEFAULT_PROFILE_ID, hasPin: false },
    { id: ADULT, hasPin: false },
    { id: PIN_ADULT, hasPin: true },
];

const base: ProfilesStartInput = {
    uiEnabled: true,
    connected: true,
    capable: true,
    enabled: true,
    startPref: 'last',
    lastId: ADULT,
    profiles: household,
};

/** Written independently of the implementation, as a truth table. */
function expected(input: ProfilesStartInput): boolean {
    const gate =
        input.uiEnabled && input.connected && input.capable && input.enabled;
    if (!gate) return false;
    if (input.profiles.length < 2) return false;
    if (input.startPref === 'ask') return true;
    switch (input.lastId) {
        case DEFAULT_PROFILE_ID:
        case ADULT:
            return false;
        default:
            // No last profile, a stale one, or one with a PIN.
            return true;
    }
}

describe('needsPicker', () => {
    const flags = [true, false];
    const cases: ProfilesStartInput[] = [];
    for (const uiEnabled of flags)
        for (const connected of flags)
            for (const capable of flags)
                for (const enabled of flags)
                    for (const startPref of ['ask', 'last'] as const)
                        for (const lastId of [
                            null,
                            DEFAULT_PROFILE_ID,
                            ADULT,
                            PIN_ADULT,
                            STALE,
                        ])
                            for (const profiles of [onlyDefault, household])
                                cases.push({
                                    uiEnabled,
                                    connected,
                                    capable,
                                    enabled,
                                    startPref,
                                    lastId,
                                    profiles,
                                });

    it('covers the whole input space', () => {
        expect(cases).toHaveLength(2 * 2 * 2 * 2 * 2 * 5 * 2);
    });

    it.each(cases)('matches the truth table for %j', (input) => {
        expect(needsPicker(input)).toBe(expected(input));
    });

    it('never asks while the UI constant is off', () => {
        expect(
            needsPicker({ ...base, uiEnabled: false, startPref: 'ask' })
        ).toBe(false);
    });

    it('never blocks start-up without a connected, capable server', () => {
        expect(needsPicker({ ...base, connected: false, lastId: null })).toBe(
            false
        );
        expect(needsPicker({ ...base, capable: false, lastId: null })).toBe(
            false
        );
    });

    it('does not ask while profiles are off for the household', () => {
        expect(needsPicker({ ...base, enabled: false, startPref: 'ask' })).toBe(
            false
        );
    });

    it('does not ask when Default is the only profile', () => {
        expect(
            needsPicker({ ...base, profiles: onlyDefault, startPref: 'ask' })
        ).toBe(false);
    });

    it('asks on "ask" even with a valid last profile', () => {
        expect(needsPicker({ ...base, startPref: 'ask' })).toBe(true);
    });

    it('reuses a valid last profile on "last"', () => {
        expect(needsPicker(base)).toBe(false);
        expect(needsPicker({ ...base, lastId: DEFAULT_PROFILE_ID })).toBe(
            false
        );
    });

    it('asks on "last" without a last profile or with a stale one', () => {
        expect(needsPicker({ ...base, lastId: null })).toBe(true);
        expect(needsPicker({ ...base, lastId: STALE })).toBe(true);
    });

    it('asks on "last" when the last profile has a PIN', () => {
        expect(needsPicker({ ...base, lastId: PIN_ADULT })).toBe(true);
    });
});

describe('resolveActiveProfileId', () => {
    const list = (enabled: boolean): ServerProfileList => ({
        enabled,
        revision: 3,
        profiles: [
            {
                id: DEFAULT_PROFILE_ID,
                scope: 'shared',
                name: 'Household',
                colour: '#336699',
                hasPin: false,
                kids: false,
                sortOrder: 0,
            },
            {
                id: ADULT,
                scope: `profile:${ADULT}`,
                name: 'Synthetic adult',
                colour: '#993366',
                hasPin: false,
                kids: false,
                sortOrder: 1,
            },
        ],
    });

    it.each([
        ['no list', null, ADULT],
        ['a disabled list', list(false), ADULT],
        ['no stored id', list(true), null],
        ['a stale stored id', list(true), STALE],
    ])('falls back to Default with %s', (_name, value, stored) => {
        expect(resolveActiveProfileId(value, stored)).toBe(DEFAULT_PROFILE_ID);
    });

    it('keeps a stored id that is in an enabled list', () => {
        expect(resolveActiveProfileId(list(true), ADULT)).toBe(ADULT);
        expect(resolveActiveProfileId(list(true), DEFAULT_PROFILE_ID)).toBe(
            DEFAULT_PROFILE_ID
        );
    });
});

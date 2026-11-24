import {
    activityAddressKey,
    activityScopeKeyRange,
} from '../activity-sync/activity-sync.identity';
import { parseActivityAddress } from '../activity-sync/activity-sync.wire';
import type { ActivityAddress } from '../activity-sync/activity-sync.contract';
import {
    favoriteAddressKey,
    favoriteScopeKeyRange,
    parseFavoriteAddress,
} from '../favorites-sync/favorites-sync.validation';
import type { FavoriteAddress } from '../favorites-sync/favorites-sync.contract';
import {
    historyScopeKey,
    parseHistoryScope,
} from '../history-sync/history.validation';
import type { HistoryScope } from '../history-sync/history.contract';
import {
    parsePersonalScope,
    profileIdOfScope,
    profileScope,
} from './profile-scope';

const PROFILE_ID = '0b6f3c1e-2d4a-4e8b-9c7d-1a2b3c4d5e6f';
const PROFILE = `profile:${PROFILE_ID}` as const;

const activity: ActivityAddress = {
    instanceId: 'instance-1',
    scope: 'shared',
    sourceId: 'source-1',
    sourceIncarnation: 'incarnation-1',
    content: { provider: 'xtream', kind: 'vod', id: '101' },
};

const favorite: FavoriteAddress = {
    instanceId: 'instance-1',
    scope: 'shared',
    sourceId: 'source-1',
    sourceIncarnation: 'incarnation-1',
    content: { provider: 'xtream', kind: 'movie', id: '101' },
} as FavoriteAddress;

const history: HistoryScope = {
    instanceId: 'instance-1',
    sourceId: 'source-1',
    sourceIncarnation: 'incarnation-1',
    provider: 'xtream',
};

describe('personal scope', () => {
    it('accepts the Default scope and profile scopes with a lowercase UUID', () => {
        expect(parsePersonalScope('shared')).toBe('shared');
        expect(parsePersonalScope(PROFILE)).toBe(PROFILE);
        expect(profileScope(PROFILE_ID)).toBe(PROFILE);
        expect(profileIdOfScope(PROFILE)).toBe(PROFILE_ID);
        expect(profileIdOfScope('shared')).toBeNull();
    });

    it.each([
        '',
        'Shared',
        'profile:',
        'profile:abc',
        `profile:${PROFILE_ID.toUpperCase()}`,
        `profile:${PROFILE_ID} `,
        `household:${PROFILE_ID}`,
        null,
        undefined,
        42,
    ])('rejects %p', (value) => {
        expect(() => parsePersonalScope(value)).toThrow(
            'Invalid personal scope'
        );
    });
});

describe('storage keys', () => {
    it('keeps the Default activity key exactly as before profiles', () => {
        expect(activityAddressKey(activity)).toBe(
            '["activity-v1","instance-1","source-1","incarnation-1","shared","xtream","vod","101"]'
        );
    });

    it('gives a profile its own activity key and keeps the scope through parsing', () => {
        const mine = { ...activity, scope: PROFILE } as ActivityAddress;
        expect(activityAddressKey(mine)).not.toBe(activityAddressKey(activity));
        expect(parseActivityAddress(mine).scope).toBe(PROFILE);
        expect(() =>
            activityAddressKey({ ...activity, scope: 'profile:x' } as never)
        ).toThrow('Invalid activity scope');
    });

    it('keeps the Default favorite key and separates profiles', () => {
        expect(favoriteAddressKey(favorite)).toBe(
            JSON.stringify([
                'instance-1',
                'shared',
                'source-1',
                'incarnation-1',
                parseFavoriteAddress(favorite).content,
            ])
        );
        const mine = { ...favorite, scope: PROFILE } as FavoriteAddress;
        expect(parseFavoriteAddress(mine).scope).toBe(PROFILE);
        expect(favoriteAddressKey(mine)).not.toBe(favoriteAddressKey(favorite));
        expect(() =>
            parseFavoriteAddress({ ...favorite, scope: 'other' } as never)
        ).toThrow('Invalid favorite scope');
    });

    it('keeps the four-field Default history key, with or without an explicit shared scope', () => {
        const before = '["instance-1","source-1","incarnation-1","xtream"]';
        expect(historyScopeKey(history)).toBe(before);
        expect(historyScopeKey({ ...history, personalScope: 'shared' })).toBe(
            before
        );
        expect(
            parseHistoryScope({ ...history, personalScope: 'shared' })
        ).toEqual(history);
    });

    it('appends a profile to the history key and rejects a bad one', () => {
        const mine: HistoryScope = { ...history, personalScope: PROFILE };
        expect(historyScopeKey(mine)).toBe(
            `["instance-1","source-1","incarnation-1","xtream","${PROFILE}"]`
        );
        expect(parseHistoryScope(mine).personalScope).toBe(PROFILE);
        expect(() =>
            parseHistoryScope({ ...history, personalScope: 'profile:x' })
        ).toThrow('Invalid history scope');
    });
});

describe('scope key ranges', () => {
    const inRange = (key: string, [from, to]: readonly [string, string]) =>
        key > from && key < to;
    const OTHER = 'profile:1b6f3c1e-2d4a-4e8b-9c7d-1a2b3c4d5e6f' as const;

    it('holds exactly the activity keys of one scope and source', () => {
        const range = (scope: typeof PROFILE | 'shared') =>
            activityScopeKeyRange(
                'instance-1',
                'source-1',
                'incarnation-1',
                scope
            );
        const contents: ActivityAddress['content'][] = [
            { provider: 'xtream', kind: 'vod', id: '101' },
            {
                provider: 'xtream',
                kind: 'episode',
                seriesId: '9',
                id: '3',
            },
        ];
        for (const content of contents) {
            for (const scope of ['shared', PROFILE, OTHER] as const) {
                const key = activityAddressKey({ ...activity, scope, content });
                expect(inRange(key, range('shared'))).toBe(scope === 'shared');
                expect(inRange(key, range(PROFILE))).toBe(scope === PROFILE);
            }
            const otherSource = activityAddressKey({
                ...activity,
                sourceId: 'source-10',
                content,
            });
            expect(inRange(otherSource, range('shared'))).toBe(false);
        }
    });

    it('holds exactly the favorite keys of one scope and source', () => {
        const range = favoriteScopeKeyRange(
            'instance-1',
            'source-1',
            'incarnation-1',
            PROFILE
        );
        const base = parseFavoriteAddress(favorite);
        for (const scope of ['shared', PROFILE, OTHER] as const) {
            const key = favoriteAddressKey({ ...base, scope });
            expect(inRange(key, range)).toBe(scope === PROFILE);
        }
        const otherIncarnation = favoriteAddressKey({
            ...base,
            scope: PROFILE,
            sourceIncarnation: 'incarnation-10',
        });
        expect(inRange(otherIncarnation, range)).toBe(false);
    });
});

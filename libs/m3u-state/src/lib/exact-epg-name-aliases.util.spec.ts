import type { Channel } from '@iptvnator/shared/interfaces';
import { buildExactEpgNameAliases } from './exact-epg-name-aliases.util';
import {
    replaceExactEpgNameAliases,
    resolveChannelEpgLookupKey,
    resolveRawChannelEpgLookupKey,
} from './channel-epg-lookup.util';

function channel(
    name: string,
    tvgId: string,
    tvgName = name
): Channel {
    return { name, tvg: { id: tvgId, name: tvgName } } as Channel;
}

describe('exact XMLTV display name fallback', () => {
    afterEach(() => replaceExactEpgNameAliases(new Map()));

    it('matches an unrelated tvg-id by its exact XMLTV display name', () => {
        const a2 = channel('A2 HD', 'A2.tr');
        const aliases = buildExactEpgNameAliases([a2], [
            { id: 'playlist.a2tr.f39e741cf633', displayName: 'A2 HD' },
        ]);
        expect(aliases.get('A2.tr')).toBe('playlist.a2tr.f39e741cf633');
        replaceExactEpgNameAliases(aliases);
        expect(resolveRawChannelEpgLookupKey(a2)).toBe('A2.tr');
        expect(resolveChannelEpgLookupKey(a2)).toBe(
            'playlist.a2tr.f39e741cf633'
        );
    });

    it('preserves a tvg-id already present in the guide', () => {
        expect(
            buildExactEpgNameAliases([channel('Other', 'valid.id')], [
                { id: 'valid.id', displayName: 'Something else' },
                { id: 'another.id', displayName: 'Other' },
            ], {}, ['tvg-id', 'tvg-name', 'channel-name']).size
        ).toBe(0);
    });

    it('prefers A2 HD name over an unrelated, valid TVG ID by default', () => {
        const aliases = buildExactEpgNameAliases([channel('A2 HD', 'A2.tr')], [
            { id: 'A2.tr', displayName: 'Other channel' },
            { id: 'playlist.a2', displayName: 'A2 HD' },
        ]);
        expect(aliases.get('A2.tr')).toBe('playlist.a2');
    });

    it('preserves manually configured mappings', () => {
        expect(
            buildExactEpgNameAliases(
                [channel('A2 HD', 'A2.tr')],
                [{ id: 'epg.a2', displayName: 'A2 HD' }],
                { 'A2.tr': 'manual.a2' }
            ).size
        ).toBe(0);
    });

    it('does not select an ambiguous XMLTV display name', () => {
        expect(
            buildExactEpgNameAliases([channel('A2 HD', 'A2.tr')], [
                { id: 'one', displayName: 'A2 HD' },
                { id: 'two', displayName: 'A2 HD' },
            ]).size
        ).toBe(0);
    });

    it('automatically maps three duplicated names when only one is on air', () => {
        const aliases = buildExactEpgNameAliases(
            [channel('BEINSPORTS 1 HD', 'unrelated.provider.id')],
            [
                { id: 'playlist.ligtvtr.a', displayName: 'BEINSPORTS 1 HD' },
                { id: 'playlist.ligtvtr.b', displayName: 'BEINSPORTS 1 HD' },
                { id: 'playlist.ligtvtr.c', displayName: 'BEINSPORTS 1 HD' },
            ],
            {},
            ['channel-name', 'tvg-name', 'tvg-id'],
            new Map([['beinsports 1 hd', 'playlist.ligtvtr.b']]),
        );
        expect(aliases.get('unrelated.provider.id')).toBe('playlist.ligtvtr.b');
    });

    it('still respects a manual override with unique active coverage', () => {
        const aliases = buildExactEpgNameAliases(
            [channel('BEINSPORTS 1 HD', 'provider.id')],
            [
                { id: 'a', displayName: 'BEINSPORTS 1 HD' },
                { id: 'b', displayName: 'BEINSPORTS 1 HD' },
            ],
            { 'provider.id': 'manual.selected' },
            undefined,
            new Map([['beinsports 1 hd', 'b']]),
        );
        expect(aliases.size).toBe(0);
    });

    it('uses tvg-name before channel name and supports case-insensitive exact names', () => {
        expect(
            buildExactEpgNameAliases(
                [channel('TR:A2 HD', 'old-id', '  a2 hd  ')],
                [{ id: 'new-id', displayName: 'A2 HD' }]
            ).get('old-id')
        ).toBe('new-id');
    });

    it('falls back to visible channel name when tvg-name has no match', () => {
        expect(
            buildExactEpgNameAliases(
                [channel('A2 HD', 'old-id', 'Unknown')],
                [{ id: 'new-id', displayName: 'A2 HD' }]
            ).get('old-id')
        ).toBe('new-id');
    });

    it('avoids conflicting mappings for a shared tvg-id', () => {
        expect(
            buildExactEpgNameAliases(
                [channel('A2 HD', 'shared'), channel('BBC', 'shared')],
                [
                    { id: 'a2', displayName: 'A2 HD' },
                    { id: 'bbc', displayName: 'BBC' },
                ]
            ).size
        ).toBe(0);
    });

    it('keeps the original lookup behavior until an alias exists', () => {
        const a2 = channel('A2 HD', 'A2.tr');
        expect(resolveChannelEpgLookupKey(a2)).toBe('A2.tr');
        replaceExactEpgNameAliases(new Map([['A2.tr', 'epg.a2']]));
        expect(resolveChannelEpgLookupKey(a2)).toBe('epg.a2');
        replaceExactEpgNameAliases(new Map());
        expect(resolveChannelEpgLookupKey(a2)).toBe('A2.tr');
    });
});

import type { Channel } from '@iptvnator/shared/interfaces';
import { buildExactEpgNameAliases } from './exact-epg-name-aliases.util';
import {
    getChannelEpgAliasKey,
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

function aliasKey(name: string, tvgId: string, tvgName = name): string {
    return getChannelEpgAliasKey(channel(name, tvgId, tvgName));
}

describe('exact XMLTV display name fallback', () => {
    afterEach(() => replaceExactEpgNameAliases(new Map()));

    it('matches an unrelated tvg-id by its exact XMLTV display name', () => {
        const a2 = channel('A2 HD', 'A2.tr');
        const aliases = buildExactEpgNameAliases([a2], [
            { id: 'playlist.a2tr.f39e741cf633', displayName: 'A2 HD' },
        ]);
        expect(aliases.get(aliasKey('A2 HD', 'A2.tr'))).toBe('playlist.a2tr.f39e741cf633');
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
        expect(aliases.get(aliasKey('A2 HD', 'A2.tr'))).toBe('playlist.a2');
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

    it('takes the first exact display name even if two XMLTV IDs share it', () => {
        expect(
            buildExactEpgNameAliases([channel('A2 HD', 'A2.tr')], [
                { id: 'one', displayName: 'A2 HD' },
                { id: 'two', displayName: 'A2 HD' },
            ]).get(aliasKey('A2 HD', 'A2.tr'))
        ).toBe('one');
    });

    it('maps the first of three BEINSPORTS 1 HD IDs regardless of current coverage', () => {
        const aliases = buildExactEpgNameAliases(
            [channel('BEINSPORTS 1 HD', 'unrelated.provider.id')],
            [
                { id: 'playlist.ligtvtr.88f04beb2605', displayName: 'BEINSPORTS 1 HD' },
                { id: 'playlist.ligtvtr.2be172194bf4', displayName: 'BEINSPORTS 1 HD' },
                { id: 'playlist.ligtvtr.6c12cd1eb0f7', displayName: 'BEINSPORTS 1 HD' },
            ]
        );
        expect(aliases.get(aliasKey('BEINSPORTS 1 HD', 'unrelated.provider.id'))).toBe('playlist.ligtvtr.88f04beb2605');
    });

    it('never overrides a saved manual association', () => {
        const aliases = buildExactEpgNameAliases(
            [channel('BEINSPORTS 1 HD', 'provider.id')],
            [
                { id: 'a', displayName: 'BEINSPORTS 1 HD' },
                { id: 'b', displayName: 'BEINSPORTS 1 HD' },
            ],
            { 'provider.id': 'manual.selected' }
        );
        expect(aliases.size).toBe(0);
    });

    it('uses tvg-name before channel name and supports case-insensitive exact names', () => {
        expect(
            buildExactEpgNameAliases(
                [channel('TR:A2 HD', 'old-id', '  a2 hd  ')],
                [{ id: 'new-id', displayName: 'A2 HD' }]
            ).get(aliasKey('TR:A2 HD', 'old-id', '  a2 hd  '))
        ).toBe('new-id');
    });

    it('falls back to visible channel name when tvg-name has no match', () => {
        expect(
            buildExactEpgNameAliases(
                [channel('A2 HD', 'old-id', 'Unknown')],
                [{ id: 'new-id', displayName: 'A2 HD' }]
            ).get(aliasKey('A2 HD', 'old-id', 'Unknown'))
        ).toBe('new-id');
    });

    it('keeps independent exact matches for distinct channels sharing a tvg-id', () => {
        const aliases = buildExactEpgNameAliases(
            [channel('A2 HD', 'shared'), channel('BBC', 'shared')],
            [
                { id: 'a2', displayName: 'A2 HD' },
                { id: 'bbc', displayName: 'BBC' },
            ]
        );
        expect(aliases.get(aliasKey('A2 HD', 'shared'))).toBe('a2');
        expect(aliases.get(aliasKey('BBC', 'shared'))).toBe('bbc');
    });

    it('keeps the original lookup behavior until an alias exists', () => {
        const a2 = channel('A2 HD', 'A2.tr');
        expect(resolveChannelEpgLookupKey(a2)).toBe('A2.tr');
        replaceExactEpgNameAliases(new Map([[getChannelEpgAliasKey(a2), 'epg.a2']]));
        expect(resolveChannelEpgLookupKey(a2)).toBe('epg.a2');
        replaceExactEpgNameAliases(new Map());
        expect(resolveChannelEpgLookupKey(a2)).toBe('A2.tr');
    });
    it('keeps A2 HD and A2 UHD independent despite identical tvg-name and tvg-id', () => {
        const hd = channel('A2 HD', 'A2.tr', 'A2 HD');
        const uhd = channel('A2 UHD', 'A2.tr', 'A2 HD');
        const aliases = buildExactEpgNameAliases([hd, uhd], [
            { id: 'playlist.a2tr.f39e741cf633', displayName: 'A2 HD' },
            { id: 'playlist.a2tr.c62dce8da7cc', displayName: 'A2 UHD' },
        ]);
        expect(aliases.size).toBe(2);
        expect(aliases.get(getChannelEpgAliasKey(hd))).toBe('playlist.a2tr.f39e741cf633');
        expect(aliases.get(getChannelEpgAliasKey(uhd))).toBe('playlist.a2tr.c62dce8da7cc');
        replaceExactEpgNameAliases(aliases);
        expect(resolveChannelEpgLookupKey(hd)).toBe('playlist.a2tr.f39e741cf633');
        expect(resolveChannelEpgLookupKey(uhd)).toBe('playlist.a2tr.c62dce8da7cc');
    });

    it('matches three BEINSPORTS HD streams and one SD variant sharing a tvg-id', () => {
        const hd = [1, 2, 3].map((i) => ({
            ...channel('BEINSPORTS 1 HD', 'LIGTV.tr', 'beIN SPORTS 1'),
            id: String(i),
            url: `https://example.invalid/${i}.ts`,
        }));
        const sd = channel('BEINSPORTS 1 SD', 'LIGTV.tr', 'beIN SPORTS 1');
        const aliases = buildExactEpgNameAliases([...hd, sd], [
            { id: 'playlist.ligtvtr.88f04beb2605', displayName: 'BEINSPORTS 1 HD' },
            { id: 'playlist.ligtvtr.2be172194bf4', displayName: 'BEINSPORTS 1 HD' },
            { id: 'playlist.ligtvtr.6c12cd1eb0f7', displayName: 'BEINSPORTS 1 HD' },
            { id: 'playlist.ligtvtr.d78ce86d9d48', displayName: 'BEINSPORTS 1 SD' },
        ]);
        expect(aliases.size).toBe(4);
        for (const stream of hd) {
            expect(aliases.get(getChannelEpgAliasKey(stream))).toBe('playlist.ligtvtr.88f04beb2605');
        }
        expect(aliases.get(getChannelEpgAliasKey(sd))).toBe('playlist.ligtvtr.d78ce86d9d48');
    });

    it('does not override a saved legacy mapping even for shared tvg-ids', () => {
        const aliases = buildExactEpgNameAliases(
            [channel('A2 HD', 'A2.tr'), channel('A2 UHD', 'A2.tr')],
            [{ id: 'hd', displayName: 'A2 HD' }, { id: 'uhd', displayName: 'A2 UHD' }],
            { 'A2.tr': 'manual.a2' }
        );
        expect(aliases.size).toBe(0);
    });

});

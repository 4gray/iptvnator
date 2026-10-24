import { createXmltvIdentityIndex, DEFAULT_EPG_MATCH_ORDER, normalizeEpgMatchOrder, resolveOrderedXmltvId } from './epg-match-priority.util';

describe('EPG matching priority', () => {
    const guide = createXmltvIdentityIndex([
        { id: 'playlist.a2', displayName: 'A2 HD' },
        { id: 'A2.tr', displayName: 'A Different Channel' },
        { id: 'duplicate.one', displayName: 'Duplicate' },
        { id: 'duplicate.two', displayName: 'Duplicate' },
    ]);

    it('defaults to channel name first and preserves custom field order', () => {
        expect(normalizeEpgMatchOrder(null)).toEqual(DEFAULT_EPG_MATCH_ORDER);
        expect(normalizeEpgMatchOrder(['tvg-id', 'channel-name', 'tvg-name']))
            .toEqual(['tvg-id', 'channel-name', 'tvg-name']);
    });
    it('rejects duplicate, incomplete or unknown preferences', () => {
        expect(normalizeEpgMatchOrder(['tvg-id','tvg-id','channel-name']))
            .toEqual(DEFAULT_EPG_MATCH_ORDER);
        expect(normalizeEpgMatchOrder(['tvg-id'])).toEqual(DEFAULT_EPG_MATCH_ORDER);
    });
    it('makes display name win over a valid but different provider ID', () => {
        expect(resolveOrderedXmltvId(
            { channelName: 'A2 HD', tvgName: 'A2 HD', tvgId: 'A2.tr' },
            guide.ids, guide.names,
        )).toBe('playlist.a2');
    });
    it('can explicitly prioritize tvg-id instead', () => {
        expect(resolveOrderedXmltvId(
            { channelName: 'A2 HD', tvgName: 'A2 HD', tvgId: 'A2.tr' },
            guide.ids, guide.names, ['tvg-id', 'tvg-name', 'channel-name'],
        )).toBe('A2.tr');
    });
    it('falls through a missing ID to a valid name', () => {
        expect(resolveOrderedXmltvId(
            { channelName: 'A2 HD', tvgId: 'unknown' },
            guide.ids, guide.names, ['tvg-id', 'tvg-name', 'channel-name'],
        )).toBe('playlist.a2');
    });
    it('avoids ambiguous names', () => {
        expect(resolveOrderedXmltvId(
            { channelName: 'Duplicate', tvgId: 'unknown' }, guide.ids, guide.names,
        )).toBeNull();
    });
});

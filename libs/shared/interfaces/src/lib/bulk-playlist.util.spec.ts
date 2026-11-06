import {
    bulkEntriesFromJson,
    bulkEntryIssue,
    bulkEntryToPlaylist,
    candidatesToBulkEntries,
    dedupeBulkCandidates,
    isDirectBulkPlaylistEntry,
    isImportableCandidate,
} from './bulk-playlist.util';

describe('bulk playlist entries', () => {
    it('maps candidates to editable rows that default to live only', () => {
        const [xtream, stalker] = candidatesToBulkEntries([
            {
                kind: 'xtream',
                confidence: 'high',
                serverUrl: 'http://panel.example',
                username: 'user',
                password: 'pass',
                suggestedTitle: 'panel.example',
            },
            {
                kind: 'stalker',
                confidence: 'high',
                portalUrl: 'http://portal.example/c/',
                macAddress: '00:11:22:33:44:55',
            },
        ]);

        expect(xtream.title).toBe('panel.example');
        expect(xtream.valid).toBe(true);
        // VOD is a per-row opt-in: bulk sources start live-only.
        expect(xtream.importLive).toBe(true);
        expect(xtream.importVod).toBe(false);
        expect(stalker.title).toBe('Source 2');
        expect(isDirectBulkPlaylistEntry(xtream)).toBe(true);
        expect(xtream.id).not.toBe(stalker.id);
    });

    it('flags incomplete rows as invalid', () => {
        expect(
            isImportableCandidate({ kind: 'xtream', confidence: 'low' })
        ).toBe(false);
        expect(
            isImportableCandidate({
                kind: 'm3u-url',
                confidence: 'high',
                url: 'http://x.example/list.m3u',
            })
        ).toBe(true);
        expect(
            isImportableCandidate({
                kind: 'm3u-text',
                confidence: 'high',
                text: '   ',
            })
        ).toBe(false);
    });

    it('names why a row cannot be imported', () => {
        const [complete, macOnly, portalOnly, brokenXtream] =
            candidatesToBulkEntries([
                {
                    kind: 'stalker',
                    confidence: 'high',
                    portalUrl: 'http://portal.example/c',
                    macAddress: '00:11:22:33:44:55',
                },
                {
                    kind: 'stalker',
                    confidence: 'low',
                    macAddress: '00:11:22:33:44:55',
                },
                {
                    kind: 'stalker',
                    confidence: 'low',
                    portalUrl: 'http://portal.example/c',
                },
                { kind: 'xtream', confidence: 'low', username: 'user' },
            ]);

        expect(bulkEntryIssue(complete)).toBeNull();
        expect(bulkEntryIssue(macOnly)).toBe('no-portal');
        expect(bulkEntryIssue(portalOnly)).toBe('no-mac');
        expect(bulkEntryIssue(brokenXtream)).toBe('missing-details');
    });

    it('builds portal playlists carrying a partial scope', () => {
        const [entry] = candidatesToBulkEntries([
            {
                kind: 'xtream',
                confidence: 'high',
                serverUrl: 'http://panel.example',
                username: 'user',
                password: 'pass',
            },
        ]);
        const playlist = bulkEntryToPlaylist({
            ...entry,
            importVod: false,
        });

        expect(playlist?.serverUrl).toBe('http://panel.example');
        expect(playlist?.importVod).toBe(false);
        expect(playlist?.importLive).toBeUndefined();
    });

    it('returns null for M3U rows and incomplete portal rows', () => {
        const [m3u, broken] = candidatesToBulkEntries([
            {
                kind: 'm3u-url',
                confidence: 'high',
                url: 'http://x.example/list.m3u',
            },
            { kind: 'xtream', confidence: 'low' },
        ]);
        expect(isDirectBulkPlaylistEntry(m3u)).toBe(false);
        expect(bulkEntryToPlaylist(m3u)).toBeNull();
        expect(bulkEntryToPlaylist(broken)).toBeNull();
    });

    it('parses a structured JSON source list', () => {
        const entries = bulkEntriesFromJson({
            sources: [
                {
                    type: 'xtream',
                    title: 'Gold',
                    serverUrl: 'http://panel.example',
                    username: 'user',
                    password: 'pass',
                    importVod: false,
                },
                {
                    type: 'm3u-url',
                    url: 'http://x.example/list.m3u',
                },
                { type: 'unknown-thing' },
            ],
        });

        expect(entries).toHaveLength(2);
        expect(entries?.[0]).toMatchObject({
            kind: 'xtream',
            title: 'Gold',
            importVod: false,
            valid: true,
        });
        // An unspecified VOD flag stays off, like detected rows.
        expect(entries?.[1]).toMatchObject({ importVod: false });
        expect(entries?.[1].title).toBe('Source 2');
    });

    it('honors an explicit VOD opt-in in a structured file', () => {
        const entries = bulkEntriesFromJson({
            sources: [
                {
                    type: 'm3u-url',
                    title: 'Everything',
                    url: 'http://x.example/list.m3u',
                    importVod: true,
                },
            ],
        });

        expect(entries?.[0]).toMatchObject({
            importLive: true,
            importVod: true,
            valid: true,
        });
    });

    it('rejects JSON that is not a source list', () => {
        expect(bulkEntriesFromJson({ playlists: [] })).toBeNull();
        expect(bulkEntriesFromJson('just text')).toBeNull();
    });

    it('drops the m3u-url fallback when an xtream candidate claims the same account', () => {
        const deduped = dedupeBulkCandidates([
            {
                kind: 'xtream',
                confidence: 'high',
                serverUrl: 'http://panel.example',
                username: 'user',
                password: 'pass',
                suggestedTitle: 'panel.example',
            },
            {
                kind: 'm3u-url',
                confidence: 'low',
                url: 'http://panel.example/get.php?username=user&password=pass&type=m3u_plus',
            },
        ]);

        expect(deduped).toHaveLength(1);
        expect(deduped[0].kind).toBe('xtream');
    });

    it('keeps a fallback whose credentials only match on another server', () => {
        const deduped = dedupeBulkCandidates([
            {
                kind: 'xtream',
                confidence: 'high',
                serverUrl: 'http://panel.example',
                username: 'user',
                password: 'pass',
                suggestedTitle: 'panel.example',
            },
            {
                kind: 'm3u-url',
                confidence: 'low',
                url: 'http://other.example/get.php?username=user&password=pass&type=m3u_plus',
            },
        ]);

        expect(deduped.map((candidate) => candidate.kind)).toEqual([
            'xtream',
            'm3u-url',
        ]);
    });

    it('keeps m3u-url links with credentials no xtream candidate uses', () => {
        const deduped = dedupeBulkCandidates([
            {
                kind: 'xtream',
                confidence: 'high',
                serverUrl: 'http://panel.example',
                username: 'user',
                password: 'pass',
                suggestedTitle: 'panel.example',
            },
            {
                kind: 'm3u-url',
                confidence: 'low',
                url: 'http://other.example/get.php?username=someoneelse&password=pass&type=m3u_plus',
            },
            {
                kind: 'm3u-url',
                confidence: 'low',
                url: 'http://other.example/get.php?username=user&password=DifferentPass&type=m3u_plus',
            },
        ]);

        expect(deduped).toHaveLength(3);
        expect(deduped.map((candidate) => candidate.kind)).toEqual([
            'xtream',
            'm3u-url',
            'm3u-url',
        ]);
    });
});

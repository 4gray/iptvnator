import { type Playlist } from '@iptvnator/shared/interfaces';
import { applySourceDefinition } from '@iptvnator/shared/interfaces/source-definition';
import {
    preserveUnchangedDeviceFields,
    snapshotSourceRow,
} from './source-row-snapshot';
import { retainSourceProjection } from './retain-source-projection';

describe('legacy EPG provenance during source projection', () => {
    const guide = 'https://guide.example.test/legacy.xml';
    const manual = 'https://guide.example.test/manual.xml';
    const definition = {
        id: 'synthetic-legacy',
        title: 'Synthetic legacy source',
        kind: 'm3u-text' as const,
        rawM3u: '#EXTM3U',
    };
    const legacy = (): Playlist => ({
        ...applySourceDefinition(definition),
        sourceSyncBase: definition,
        epgUrls: [guide],
    });

    it('retains an unknown-origin guide during an awaited rename', () => {
        const current = legacy();
        const original = snapshotSourceRow(current);
        const renamed = preserveUnchangedDeviceFields(
            current,
            original,
            { ...current, title: 'Synthetic renamed source' },
            true
        );
        expect(renamed.epgUrls).toEqual([guide]);
        expect(renamed.detectedEpgUrls).toEqual([]);
        expect(renamed.manualEpgUrls).toEqual([]);
    });

    it('retains unknown provenance when a delayed write keeps a current projection', () => {
        const current = legacy();
        const result = retainSourceProjection(current, current);
        expect(result.epgUrls).toEqual([guide]);
        expect(result.detectedEpgUrls).toEqual([]);
        expect(result.manualEpgUrls).toEqual([]);
    });

    it('does not resurrect a removed manual source while retaining an unknown one', () => {
        const current = {
            ...legacy(),
            epgUrls: [guide, manual],
            manualEpgUrls: [manual],
        };
        const original = snapshotSourceRow(current);
        original.manualEpgUrls = [];
        const next = { ...original, epgUrls: [guide] };
        expect(
            preserveUnchangedDeviceFields(current, original, next, true).epgUrls
        ).toEqual([guide]);
        expect(retainSourceProjection(current, next).epgUrls).toEqual([guide]);
    });
});

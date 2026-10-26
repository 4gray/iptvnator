import { Readable } from 'stream';
import type { ParsedChannel, ParsedProgram } from './epg-streaming-parser';

const postMessage = jest.fn();
const insertChannels = jest.fn();
const insertPrograms = jest.fn();
const closeDatabase = jest.fn();
const commitImport = jest.fn();
const openEpgSourceStream = jest.fn();
let handleMessage: (message: { type: string; url: string }) => Promise<void>;

jest.mock('worker_threads', () => ({
    workerData: {},
    parentPort: {
        on: (_event: string, listener: typeof handleMessage) => {
            handleMessage = listener;
        },
        postMessage: (...args: unknown[]) => postMessage(...args),
    },
}));
jest.mock('./worker-runtime-paths', () => ({
    getWorkerDataNativeModuleSearchPaths: () => [],
    getNativeModuleSearchPaths: () => [],
    registerNativeModuleSearchPaths: jest.fn(),
    loadNativeModuleFromSearchPaths: () => jest.fn(),
}));
jest.mock('./epg-database', () => ({
    EpgDatabase: jest.fn().mockImplementation(() => ({
        createImport: () => ({
            insertChannels,
            insertPrograms,
            commit: commitImport,
        }),
        close: closeDatabase,
    })),
}));
jest.mock('./epg-source-stream', () => ({
    openEpgSourceStream: (...args: unknown[]) => openEpgSourceStream(...args),
}));
jest.mock('../util/network-defaults', () => ({
    applyElectronNetworkDefaults: jest.fn(),
}));
jest.mock('../util/epg-logger', () => ({
    epgLogger: { log: jest.fn(), error: jest.fn() },
}));

import './epg-parser.worker';

const sourceUrl = 'https://example.com/guide.xml';
const channelId = 'café-東京-📺';
const channelName = 'Новости café 東京 📺';
const title = 'Été 日本 🎬';
const description = 'Программа café 東京 📻';
const xml = `<?xml version="1.0" encoding="UTF-8"?><tv>
<channel id="${channelId}"><display-name>${channelName}</display-name></channel>
<programme start="20261015080000 +0000" stop="20261015090000 +0000" channel="${channelId}"><title>${title}</title><desc>${description}</desc></programme>
</tv>`;

function storedChannels(): ParsedChannel[] {
    return insertChannels.mock.calls.flatMap(([channels]) => channels);
}

function storedPrograms(): ParsedProgram[] {
    return insertPrograms.mock.calls.flatMap(([programs]) => programs);
}

describe('EPG worker UTF-8 input', () => {
    beforeEach(() => jest.clearAllMocks());

    it.each([1, 2, 3, 7])(
        'preserves XMLTV identifiers and text with %i-byte chunks',
        async (chunkSize) => {
            const bytes = Buffer.from(xml);
            const chunks: Buffer[] = [];
            for (let offset = 0; offset < bytes.length; offset += chunkSize) {
                chunks.push(bytes.subarray(offset, offset + chunkSize));
            }
            openEpgSourceStream.mockResolvedValue(Readable.from(chunks));

            await handleMessage({ type: 'FETCH_EPG', url: sourceUrl });

            expect(storedChannels()).toEqual([
                expect.objectContaining({
                    id: channelId,
                    displayName: [{ lang: '', value: channelName }],
                }),
            ]);
            expect(storedPrograms()).toEqual([
                expect.objectContaining({
                    channel: channelId,
                    title: [{ lang: '', value: title }],
                    desc: [{ lang: '', value: description }],
                }),
            ]);
            expect(postMessage).toHaveBeenCalledWith({
                type: 'EPG_COMPLETE',
                url: sourceUrl,
                stats: { totalChannels: 1, totalPrograms: 1 },
            });
            expect(commitImport).toHaveBeenCalledTimes(1);
            expect(closeDatabase).toHaveBeenCalledTimes(1);
        }
    );

    it('reports a stream failure while a UTF-8 character is incomplete', async () => {
        openEpgSourceStream.mockResolvedValue(
            Readable.from(
                (async function* () {
                    yield Buffer.from('<tv><channel id="');
                    yield Buffer.from([0xf0, 0x9f]);
                    throw new Error('interrupted source');
                })()
            )
        );

        await handleMessage({ type: 'FETCH_EPG', url: sourceUrl });

        expect(postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'EPG_ERROR',
                error: 'interrupted source',
            })
        );
        expect(postMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'EPG_COMPLETE' })
        );
        expect(commitImport).not.toHaveBeenCalled();
        expect(insertChannels).not.toHaveBeenCalled();
        expect(closeDatabase).toHaveBeenCalled();
    });
});

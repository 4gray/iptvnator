import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import { pathToFileURL } from 'url';
import { gzipSync } from 'zlib';

const requestWithValidatedRedirects = jest.fn();

jest.mock('../util/validated-axios', () => ({
    requestWithValidatedRedirects: (...args: unknown[]) =>
        requestWithValidatedRedirects(...args),
}));
jest.mock('../util/secure-https', () => ({
    createPlaylistAgentFactory: () => ({}),
}));
jest.mock('../events/url-safety', () => ({
    isPrivateNetworkUrlAccessAllowed: () => false,
}));
jest.mock('../util/epg-logger', () => ({
    epgLogger: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

import {
    openEpgSourceStream,
    resolveLocalEpgSourcePath,
} from './epg-source-stream';

const xmltv =
    '<?xml version="1.0" encoding="utf-8"?><tv><channel id="c1">' +
    '<display-name>One</display-name></channel></tv>';

async function readAll(stream: Readable): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf-8');
}

describe('openEpgSourceStream', () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'iptvnator-epg-source-'));
        requestWithValidatedRedirects.mockReset();
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it('reads a plain XML file from an absolute path', async () => {
        const file = join(dir, 'guide.xml');
        writeFileSync(file, xmltv);

        await expect(readAll(await openEpgSourceStream(file))).resolves.toBe(
            xmltv
        );
        expect(requestWithValidatedRedirects).not.toHaveBeenCalled();
    });

    it('gunzips a .xml.gz file', async () => {
        const file = join(dir, 'guide.xml.gz');
        writeFileSync(file, gzipSync(xmltv));

        await expect(readAll(await openEpgSourceStream(file))).resolves.toBe(
            xmltv
        );
    });

    it('detects gzip by signature when the extension is missing', async () => {
        const file = join(dir, 'guide');
        writeFileSync(file, gzipSync(xmltv));

        await expect(readAll(await openEpgSourceStream(file))).resolves.toBe(
            xmltv
        );
    });

    it('accepts a file: URL with percent-encoded characters', async () => {
        const file = join(dir, 'guide v2.xml');
        writeFileSync(file, xmltv);

        await expect(
            readAll(await openEpgSourceStream(pathToFileURL(file).href))
        ).resolves.toBe(xmltv);
    });

    it('tolerates surrounding whitespace in the stored value', async () => {
        const file = join(dir, 'guide.xml');
        writeFileSync(file, xmltv);

        await expect(
            readAll(await openEpgSourceStream(`  ${file}  `))
        ).resolves.toBe(xmltv);
    });

    it('reports a missing file with its path instead of an ENOENT code', async () => {
        const file = join(dir, 'missing.xml');

        await expect(openEpgSourceStream(file)).rejects.toThrow(
            `EPG file not found: ${file}`
        );
    });

    it('refuses a directory', async () => {
        const folder = join(dir, 'epg');
        mkdirSync(folder);

        await expect(openEpgSourceStream(folder)).rejects.toThrow(
            `EPG source is not a file: ${folder}`
        );
    });

    it('fails a truncated gzip file instead of parsing it as XML', async () => {
        const file = join(dir, 'guide.xml.gz');
        writeFileSync(file, gzipSync(xmltv).subarray(0, 20));

        await expect(
            readAll(await openEpgSourceStream(file))
        ).rejects.toThrow();
    });

    it('routes remote links through the validated HTTP client', async () => {
        requestWithValidatedRedirects.mockResolvedValue({
            config: { url: 'https://epg.example.org/guide.xml' },
            data: Readable.from([Buffer.from(xmltv)]),
            headers: {},
            status: 200,
        });

        const stream = await openEpgSourceStream(
            'https://epg.example.org/guide.xml',
            { trustedPrivateNetworkEpgUrls: [] }
        );

        await expect(readAll(stream)).resolves.toBe(xmltv);
        expect(requestWithValidatedRedirects).toHaveBeenCalledWith(
            'https://epg.example.org/guide.xml',
            expect.objectContaining({ responseType: 'stream' }),
            { allowPrivateNetworks: false }
        );
    });

    it('never reads a relative path from disk', async () => {
        await expect(openEpgSourceStream('guide.xml')).rejects.toThrow();
        expect(requestWithValidatedRedirects).toHaveBeenCalledTimes(1);
    });
});

describe('resolveLocalEpgSourcePath', () => {
    it('converts file URLs and keeps absolute paths', () => {
        const file = join(tmpdir(), 'guide v2.xml.gz');
        expect(resolveLocalEpgSourcePath(pathToFileURL(file).href)).toBe(file);
        expect(resolveLocalEpgSourcePath(` ${file} `)).toBe(file);
    });

    it('rejects relative paths', () => {
        expect(() => resolveLocalEpgSourcePath('epg/guide.xml')).toThrow(
            'EPG file path must be absolute'
        );
    });
});

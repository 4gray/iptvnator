import {
    mkdtempSync,
    lstatSync,
    readFileSync,
    renameSync,
    rmSync,
    writeFileSync,
    unlinkSync,
    linkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeJournaledCatchupPartial } from './download-catchup-removal';
import type { ArchivePartialProof } from './download-catchup-journal';
jest.mock('node:fs', () => {
    const actual = jest.requireActual('node:fs');
    return {
        ...actual,
        renameSync: jest.fn(actual.renameSync),
        unlinkSync: jest.fn(actual.unlinkSync),
        linkSync: jest.fn(actual.linkSync),
    };
});
const actual = jest.requireActual<typeof import('node:fs')>('node:fs');
let directory: string, filePath: string, proof: ArchivePartialProof;
beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'archive-remove-'));
    filePath = join(directory, 'show.ts');
    writeFileSync(filePath + '.part', 'owned bytes');
    proof = {
        version: 1,
        phase: 'transfer',
        filePath,
        partialIdentity: lstatSync(filePath + '.part'),
    };
    jest.mocked(renameSync).mockReset().mockImplementation(actual.renameSync);
    jest.mocked(unlinkSync).mockReset().mockImplementation(actual.unlinkSync);
    jest.mocked(linkSync).mockReset().mockImplementation(actual.linkSync);
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));
function recordCapture(path: string) {
    proof = { ...proof, partialCleanupPath: path };
}
it('removes only the journaled partial', () => {
    removeJournaledCatchupPartial(filePath, proof, recordCapture);
    expect(() => lstatSync(filePath + '.part')).toThrow();
});
it('preserves entries without proof', () => {
    removeJournaledCatchupPartial(filePath, undefined, recordCapture);
    expect(readFileSync(filePath + '.part', 'utf8')).toBe('owned bytes');
});
it('preserves a replaced regular partial in place', () => {
    renameSync(filePath + '.part', join(directory, 'original'));
    writeFileSync(filePath + '.part', 'unrelated bytes');
    removeJournaledCatchupPartial(filePath, proof, recordCapture);
    expect(readFileSync(filePath + '.part', 'utf8')).toBe('unrelated bytes');
});
it('restores a replacement captured at the cleanup boundary', () => {
    jest.mocked(renameSync).mockImplementationOnce((from, to) => {
        actual.renameSync(from, join(directory, 'original'));
        writeFileSync(from, 'unrelated bytes');
        actual.renameSync(from, to);
    });
    removeJournaledCatchupPartial(filePath, proof, recordCapture);
    expect(readFileSync(filePath + '.part', 'utf8')).toBe('unrelated bytes');
});
it('retries a durable capture after an I/O error without needing hardlinks', () => {
    jest.mocked(unlinkSync).mockImplementationOnce(() => {
        throw Object.assign(new Error('locked'), { code: 'EACCES' });
    });
    jest.mocked(linkSync).mockImplementation(() => {
        throw Object.assign(new Error('unsupported'), { code: 'ENOTSUP' });
    });
    expect(() =>
        removeJournaledCatchupPartial(filePath, proof, recordCapture)
    ).toThrow('locked');
    expect(() => lstatSync(filePath + '.part')).toThrow();
    expect(proof.partialCleanupPath).toBeDefined();
    expect(readFileSync(proof.partialCleanupPath!, 'utf8')).toBe('owned bytes');
    removeJournaledCatchupPartial(filePath, proof, recordCapture);
    expect(() => lstatSync(proof.partialCleanupPath!)).toThrow();
    expect(linkSync).not.toHaveBeenCalled();
});
it('does not capture the entry when write-ahead persistence fails', () => {
    expect(() =>
        removeJournaledCatchupPartial(filePath, proof, (capture) => {
            expect(readFileSync(filePath + '.part', 'utf8')).toBe(
                'owned bytes'
            );
            expect(() => lstatSync(capture)).toThrow();
            throw new Error('SQLITE_BUSY');
        })
    ).toThrow('SQLITE_BUSY');
    expect(renameSync).not.toHaveBeenCalled();
    expect(readFileSync(filePath + '.part', 'utf8')).toBe('owned bytes');
});

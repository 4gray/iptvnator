import {
    mkdtempSync,
    lstatSync,
    readFileSync,
    renameSync,
    rmSync,
    writeFileSync,
    unlinkSync,
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
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));
it('removes only the journaled partial', () => {
    removeJournaledCatchupPartial(filePath, proof);
    expect(() => lstatSync(filePath + '.part')).toThrow();
});
it('preserves entries without proof', () => {
    removeJournaledCatchupPartial(filePath, undefined);
    expect(readFileSync(filePath + '.part', 'utf8')).toBe('owned bytes');
});
it('preserves a replaced regular partial in place', () => {
    renameSync(filePath + '.part', join(directory, 'original'));
    writeFileSync(filePath + '.part', 'unrelated bytes');
    removeJournaledCatchupPartial(filePath, proof);
    expect(readFileSync(filePath + '.part', 'utf8')).toBe('unrelated bytes');
});
it('restores a replacement captured at the cleanup boundary', () => {
    jest.mocked(renameSync).mockImplementationOnce((from, to) => {
        actual.renameSync(from, join(directory, 'original'));
        writeFileSync(from, 'unrelated bytes');
        actual.renameSync(from, to);
    });
    removeJournaledCatchupPartial(filePath, proof);
    expect(readFileSync(filePath + '.part', 'utf8')).toBe('unrelated bytes');
});
it('restores an owned partial and reports an I/O error for retry', () => {
    jest.mocked(unlinkSync).mockImplementationOnce(() => {
        throw Object.assign(new Error('locked'), { code: 'EACCES' });
    });
    expect(() => removeJournaledCatchupPartial(filePath, proof)).toThrow(
        'locked'
    );
    expect(readFileSync(filePath + '.part', 'utf8')).toBe('owned bytes');
});

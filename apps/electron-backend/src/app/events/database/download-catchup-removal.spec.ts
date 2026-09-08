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
import {
    removeJournaledCatchupPartial,
    cleanupStoredCatchupFinal,
} from './download-catchup-removal';
import type {
    ArchivePartialProof,
    ArchiveFinalizationProof,
} from './download-catchup-journal';
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

it('journals a failed final-file capture without confusing it with the source', async () => {
    writeFileSync(filePath, 'partial final copy');
    let journal: ArchiveFinalizationProof = {
        version: 1,
        filePath,
        partialIdentity: proof.partialIdentity,
        finalIdentity: lstatSync(filePath),
        size: 100,
    };
    const db = {
        select: () => ({
            from: () => ({
                where: async () => [
                    { downloadId: 1, proof: JSON.stringify(journal) },
                ],
            }),
        }),
        update: () => ({
            set: (value: { proof: string }) => ({
                where: () => ({
                    run: () => {
                        journal = JSON.parse(value.proof);
                        return { changes: 1 };
                    },
                }),
            }),
        }),
    };
    jest.mocked(unlinkSync).mockImplementationOnce(() => {
        throw new Error('locked copy');
    });
    await expect(
        cleanupStoredCatchupFinal(
            db as never,
            1,
            filePath,
            journal.finalIdentity
        )
    ).resolves.toBe(false);
    expect(journal.finalCleanupPath).toBeDefined();
    expect(readFileSync(journal.finalCleanupPath!, 'utf8')).toBe(
        'partial final copy'
    );
    expect(readFileSync(filePath + '.part', 'utf8')).toBe('owned bytes');
    await expect(
        cleanupStoredCatchupFinal(db as never, 1, filePath)
    ).resolves.toBe(true);
    expect(() => lstatSync(journal.finalCleanupPath!)).toThrow();
    expect(readFileSync(filePath + '.part', 'utf8')).toBe('owned bytes');
});

it.each([false, true])(
    'cleans an owned final only for an abandoned attempt (removeFinal=%s)',
    (removeFinal) => {
        writeFileSync(filePath, 'unfinished copy');
        let journal: ArchiveFinalizationProof = {
            ...proof,
            phase: 'finalization',
            size: 100,
            finalIdentity: lstatSync(filePath),
        };
        const record = (path: string, kind = 'partial') => {
            journal = {
                ...journal,
                [kind === 'final' ? 'finalCleanupPath' : 'partialCleanupPath']:
                    path,
            };
        };
        if (removeFinal) {
            jest.mocked(unlinkSync).mockImplementationOnce(() => {
                throw new Error('locked final');
            });
            expect(() =>
                removeJournaledCatchupPartial(filePath, journal, record, true)
            ).toThrow('locked final');
            expect(readFileSync(journal.finalCleanupPath!, 'utf8')).toBe(
                'unfinished copy'
            );
            expect(readFileSync(filePath + '.part', 'utf8')).toBe(
                'owned bytes'
            );
        }
        removeJournaledCatchupPartial(filePath, journal, record, removeFinal);
        expect(() => lstatSync(filePath + '.part')).toThrow();
        if (removeFinal) {
            expect(() => lstatSync(filePath)).toThrow();
            expect(() => lstatSync(journal.finalCleanupPath!)).toThrow();
        } else expect(readFileSync(filePath, 'utf8')).toBe('unfinished copy');
    }
);

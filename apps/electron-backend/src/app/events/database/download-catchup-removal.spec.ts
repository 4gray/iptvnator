import { openCatchupOutput } from './download-catchup-output';
import {
    verifiedArchiveSize,
    parseArchiveFinalization,
} from './download-catchup-journal';
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
    cleanupStoredCatchupPartial,
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
    expect(() =>
        removeJournaledCatchupPartial(filePath, proof, recordCapture)
    ).toThrow('preserved an unrelated recovery file');
    expect(readFileSync(filePath + '.part', 'utf8')).toBe('unrelated bytes');
    expect(readFileSync(proof.partialCleanupPath!, 'utf8')).toBe(
        'unrelated bytes'
    );
});
it('retains a replacement capture until explicit recovery-copy cleanup', () => {
    jest.mocked(renameSync).mockImplementationOnce((from, to) => {
        actual.renameSync(from, join(directory, 'original'));
        writeFileSync(from, 'foreign bytes');
        actual.renameSync(from, to);
    });
    jest.mocked(linkSync).mockImplementation(() => {
        throw Object.assign(new Error('hardlinks unavailable'), {
            code: 'ENOTSUP',
        });
    });
    expect(() =>
        removeJournaledCatchupPartial(filePath, proof, recordCapture)
    ).toThrow('hardlinks unavailable');
    const capture = proof.partialCleanupPath!;
    expect(readFileSync(capture, 'utf8')).toBe('foreign bytes');
    expect(() =>
        removeJournaledCatchupPartial(filePath, proof, recordCapture)
    ).toThrow('hardlinks unavailable');
    expect(proof.partialCleanupPath).toBe(capture);
    jest.mocked(linkSync).mockImplementationOnce(() => {
        throw Object.assign(new Error('destination parent missing'), {
            code: 'ENOENT',
        });
    });
    expect(() =>
        removeJournaledCatchupPartial(filePath, proof, recordCapture)
    ).toThrow('destination parent missing');
    expect(readFileSync(capture, 'utf8')).toBe('foreign bytes');
    jest.mocked(linkSync).mockImplementation(actual.linkSync);
    writeFileSync(filePath + '.part', 'newer public bytes');
    expect(() =>
        removeJournaledCatchupPartial(filePath, proof, recordCapture)
    ).toThrow();
    expect(readFileSync(filePath + '.part', 'utf8')).toBe('newer public bytes');
    expect(readFileSync(capture, 'utf8')).toBe('foreign bytes');
    actual.unlinkSync(filePath + '.part');
    expect(() =>
        removeJournaledCatchupPartial(filePath, proof, recordCapture)
    ).toThrow('preserved an unrelated recovery file');
    expect(readFileSync(filePath + '.part', 'utf8')).toBe('foreign bytes');
    expect(readFileSync(capture, 'utf8')).toBe('foreign bytes');
    // The restored public entry may disappear immediately; its recovery copy
    // must survive and remain journaled across another cleanup attempt.
    actual.unlinkSync(filePath + '.part');
    expect(() =>
        removeJournaledCatchupPartial(filePath, proof, recordCapture)
    ).toThrow('preserved an unrelated recovery file');
    expect(readFileSync(capture, 'utf8')).toBe('foreign bytes');
    actual.unlinkSync(capture); // explicit recovery-copy cleanup by the user
    removeJournaledCatchupPartial(filePath, proof, recordCapture);
    expect(() => lstatSync(capture)).toThrow();
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

it.each([false, true])(
    'restart cleanup preserves completed promotion and removes unfinished copies (complete=%s)',
    async (complete) => {
        writeFileSync(filePath, 'archive');
        let journal: ArchiveFinalizationProof = {
            ...proof,
            phase: 'finalization',
            size: complete ? 7 : 100,
            finalIdentity: lstatSync(filePath),
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
        await expect(
            cleanupStoredCatchupPartial(db as never, 1, filePath, 'incomplete')
        ).resolves.toBe(true);
        expect(() => lstatSync(filePath + '.part')).toThrow();
        if (complete) expect(readFileSync(filePath, 'utf8')).toBe('archive');
        else expect(() => lstatSync(filePath)).toThrow();
    }
);

it('preserves a replacement when the filesystem reuses its predecessor inode', () => {
    proof.partialIdentity = {
        ...proof.partialIdentity,
        birthtimeMs: proof.partialIdentity.birthtimeMs - 1,
    };
    removeJournaledCatchupPartial(filePath, proof, recordCapture);
    expect(readFileSync(filePath + '.part', 'utf8')).toBe('owned bytes');
    expect(renameSync).not.toHaveBeenCalled();
});

it('rejects a reused inode before truncating or replacing the journal proof', async () => {
    const previous = {
        ...proof.partialIdentity,
        birthtimeMs: proof.partialIdentity.birthtimeMs - 1,
    };
    const record = jest.fn();
    await expect(
        openCatchupOutput(filePath + '.part', previous, record)
    ).rejects.toThrow('changed');
    expect(record).not.toHaveBeenCalled();
    expect(readFileSync(filePath + '.part', 'utf8')).toBe('owned bytes');
});

it('does not recover a same-size final from a reused inode or a legacy proof without creation time', () => {
    writeFileSync(filePath, 'foreign archive');
    const final = lstatSync(filePath);
    const journal: ArchiveFinalizationProof = {
        ...proof,
        phase: 'finalization',
        size: final.size,
        finalIdentity: { ...final, birthtimeMs: final.birthtimeMs - 1 },
    };
    expect(verifiedArchiveSize(filePath, journal)).toBeNull();
    expect(
        parseArchiveFinalization(
            JSON.stringify({
                ...journal,
                finalIdentity: { dev: final.dev, ino: final.ino },
            })
        )
    ).toBeUndefined();
});

it('never truncates a preexisting file without expected ownership', async () => {
    const record = jest.fn();
    await expect(
        openCatchupOutput(filePath + '.part', undefined, record)
    ).rejects.toThrow('changed');
    expect(record).not.toHaveBeenCalled();
    expect(readFileSync(filePath + '.part', 'utf8')).toBe('owned bytes');
});

it.each([false, true])(
    'does not relocate an unproved fallback target (replaced=%s)',
    async (replaced) => {
        writeFileSync(filePath, '');
        const createdIdentity = lstatSync(filePath);
        if (replaced) {
            renameSync(filePath, join(directory, 'empty-original'));
            writeFileSync(filePath, 'foreign final');
        }
        const db = {
            select: () => ({ from: () => ({ where: async () => [] }) }),
        };
        jest.mocked(renameSync).mockClear();
        await expect(
            cleanupStoredCatchupFinal(db as never, 1, filePath, createdIdentity)
        ).resolves.toBe(false);
        expect(readFileSync(filePath, 'utf8')).toBe(
            replaced ? 'foreign final' : ''
        );
        expect(renameSync).not.toHaveBeenCalled();
    }
);

it.each([false, true])(
    'preserves the last foreign link if the restored public entry is immediately removed (retry=%s)',
    (retry) => {
        if (retry) {
            const capture = join(directory, 'foreign-capture');
            writeFileSync(capture, 'foreign bytes');
            proof.partialCleanupPath = capture;
            actual.unlinkSync(filePath + '.part');
        } else {
            jest.mocked(renameSync).mockImplementationOnce((from, to) => {
                actual.renameSync(from, join(directory, 'original'));
                writeFileSync(from, 'foreign bytes');
                actual.renameSync(from, to);
            });
        }
        jest.mocked(linkSync).mockImplementationOnce((from, to) => {
            actual.linkSync(from, to);
            actual.unlinkSync(to);
        });
        expect(() =>
            removeJournaledCatchupPartial(filePath, proof, recordCapture)
        ).toThrow('preserved an unrelated recovery file');
        expect(readFileSync(proof.partialCleanupPath!, 'utf8')).toBe(
            'foreign bytes'
        );
    }
);

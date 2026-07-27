import {
    link,
    mkdtemp,
    mkdir,
    rename,
    rm,
    symlink,
    utimes,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    HAR_READER_ERROR_CODES,
    HAR_READER_LIMITS,
    HarReaderError,
    decodeHarBase64,
    parseGitWorktreeList,
    readHarFile,
} from './har-reader';

function minimalHar(): string {
    return JSON.stringify({
        log: {
            version: '1.2',
            entries: [],
        },
    });
}

async function expectReaderCode(
    operation: Promise<unknown> | (() => unknown),
    code: string
): Promise<void> {
    try {
        if (typeof operation === 'function') {
            operation();
        } else {
            await operation;
        }
        throw new Error('HAR input unexpectedly passed');
    } catch (error) {
        expect(error).toBeInstanceOf(HarReaderError);
        expect((error as HarReaderError).code).toBe(code);
        expect((error as Error).message).toBe(
            `Stalker HAR conversion failed: ${code}.`
        );
    }
}

describe('safe HAR reader', () => {
    let captureRoot: string;

    beforeEach(async () => {
        captureRoot = await mkdtemp(join(tmpdir(), 'stalker-har-'));
    });

    afterEach(async () => {
        await rm(captureRoot, { force: true, recursive: true });
    });

    it('reads a bounded external regular file with fatal UTF-8 decoding', async () => {
        const capturePath = join(captureRoot, 'capture.har');
        await writeFile(capturePath, minimalHar());

        await expect(
            readHarFile(capturePath, { worktreeRoots: [] })
        ).resolves.toEqual({
            log: {
                version: '1.2',
                entries: [],
            },
        });
    });

    it('rejects a capture inside any injected Git worktree root', async () => {
        const capturePath = join(captureRoot, 'capture.har');
        await writeFile(capturePath, minimalHar());

        await expectReaderCode(
            readHarFile(capturePath, { worktreeRoots: [captureRoot] }),
            HAR_READER_ERROR_CODES.InputInsideWorktree
        );
    });

    it('parses only bounded worktree records from NUL porcelain output', () => {
        expect(
            parseGitWorktreeList(
                'worktree /repo/main\0HEAD abc\0branch refs/heads/main\0\0' +
                    'worktree /repo/linked\0HEAD def\0detached\0\0'
            )
        ).toEqual(['/repo/main', '/repo/linked']);
    });

    it('rejects symlink, hardlink, and directory inputs', async () => {
        const sourcePath = join(captureRoot, 'source.har');
        await writeFile(sourcePath, minimalHar());
        const symlinkPath = join(captureRoot, 'symlink.har');
        await symlink(sourcePath, symlinkPath);
        const hardlinkPath = join(captureRoot, 'hardlink.har');
        await link(sourcePath, hardlinkPath);
        const directoryPath = join(captureRoot, 'directory.har');
        await mkdir(directoryPath);

        for (const unsafePath of [symlinkPath, hardlinkPath, directoryPath]) {
            await expectReaderCode(
                readHarFile(unsafePath, { worktreeRoots: [] }),
                HAR_READER_ERROR_CODES.UnsafeInputPath
            );
        }
    });

    it('rejects a file swapped between preflight and open', async () => {
        const capturePath = join(captureRoot, 'capture.har');
        const replacementPath = join(captureRoot, 'replacement.har');
        await writeFile(capturePath, minimalHar());
        await writeFile(replacementPath, minimalHar());

        await expectReaderCode(
            readHarFile(capturePath, {
                worktreeRoots: [],
                beforeOpen: async () => {
                    await rename(
                        capturePath,
                        join(captureRoot, 'original.har')
                    );
                    await rename(replacementPath, capturePath);
                },
            }),
            HAR_READER_ERROR_CODES.UnsafeInputPath
        );
    });

    it('rejects same-inode same-size mutation after preflight', async () => {
        const capturePath = join(captureRoot, 'capture.har');
        const original = minimalHar();
        await writeFile(capturePath, original);

        await expectReaderCode(
            readHarFile(capturePath, {
                worktreeRoots: [],
                beforeOpen: async () => {
                    await writeFile(
                        capturePath,
                        original.replace('"1.2"', '"1.1"')
                    );
                    await utimes(capturePath, new Date(0), new Date(0));
                },
            }),
            HAR_READER_ERROR_CODES.UnsafeInputPath
        );
    });

    it('rejects raw captures above the fixed byte ceiling', async () => {
        const capturePath = join(captureRoot, 'capture.har');
        await writeFile(
            capturePath,
            Buffer.alloc(HAR_READER_LIMITS.MaxRawBytes + 1, 0x20)
        );

        await expectReaderCode(
            readHarFile(capturePath, { worktreeRoots: [] }),
            HAR_READER_ERROR_CODES.HarTooLarge
        );
    });

    it('rejects malformed UTF-8 and a UTF-8 BOM', async () => {
        const malformedPath = join(captureRoot, 'malformed.har');
        await writeFile(malformedPath, Buffer.from([0xc3, 0x28]));
        await expectReaderCode(
            readHarFile(malformedPath, { worktreeRoots: [] }),
            HAR_READER_ERROR_CODES.InvalidUtf8
        );

        const bomPath = join(captureRoot, 'bom.har');
        await writeFile(
            bomPath,
            Buffer.concat([
                Buffer.from([0xef, 0xbb, 0xbf]),
                Buffer.from(minimalHar()),
            ])
        );
        await expectReaderCode(
            readHarFile(bomPath, { worktreeRoots: [] }),
            HAR_READER_ERROR_CODES.InvalidHarJson
        );
    });

    it('rejects excessive JSON nesting before parsing', async () => {
        const capturePath = join(captureRoot, 'nested.har');
        const depth = HAR_READER_LIMITS.MaxJsonDepth + 1;
        await writeFile(
            capturePath,
            `${'['.repeat(depth)}null${']'.repeat(depth)}`
        );

        await expectReaderCode(
            readHarFile(capturePath, { worktreeRoots: [] }),
            HAR_READER_ERROR_CODES.HarTooDeep
        );
    });

    it('rejects oversized JSON collections and strings', async () => {
        const collectionPath = join(captureRoot, 'collection.har');
        await writeFile(
            collectionPath,
            JSON.stringify(
                Array.from(
                    { length: HAR_READER_LIMITS.MaxCollectionItems + 1 },
                    () => 0
                )
            )
        );
        await expectReaderCode(
            readHarFile(collectionPath, { worktreeRoots: [] }),
            HAR_READER_ERROR_CODES.HarCollectionTooLarge
        );

        const stringPath = join(captureRoot, 'string.har');
        await writeFile(
            stringPath,
            JSON.stringify('x'.repeat(HAR_READER_LIMITS.MaxStringBytes + 1))
        );
        await expectReaderCode(
            readHarFile(stringPath, { worktreeRoots: [] }),
            HAR_READER_ERROR_CODES.HarStringTooLarge
        );
    });

    it('rejects malformed JSON with one stable sanitized code', async () => {
        const capturePath = join(captureRoot, 'capture.har');
        await writeFile(capturePath, '{"log":');

        await expectReaderCode(
            readHarFile(capturePath, { worktreeRoots: [] }),
            HAR_READER_ERROR_CODES.InvalidHarJson
        );
    });
});

describe('strict HAR base64 decoding', () => {
    it('accepts canonical base64 within the decoded-body ceiling', () => {
        expect(
            decodeHarBase64(Buffer.from('hello').toString('base64'))
        ).toEqual(Buffer.from('hello'));
    });

    it.each(['a', 'a===', 'aGVsbG8', 'aGVs bG8=', 'aGVsbG8===', '****'])(
        'rejects noncanonical base64 %s',
        async (value) => {
            await expectReaderCode(
                () => decodeHarBase64(value),
                HAR_READER_ERROR_CODES.InvalidBase64
            );
        }
    );

    it('rejects decoded bodies over their independent ceiling', async () => {
        const encoded = Buffer.alloc(
            HAR_READER_LIMITS.MaxDecodedBodyBytes + 1
        ).toString('base64');

        await expectReaderCode(
            () => decodeHarBase64(encoded),
            HAR_READER_ERROR_CODES.DecodedBodyTooLarge
        );
    });
});

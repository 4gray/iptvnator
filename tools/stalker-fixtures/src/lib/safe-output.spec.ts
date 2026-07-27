import {
    chmod,
    lstat,
    mkdtemp,
    readFile,
    readdir,
    rename,
    rm,
    symlink,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    REPLAY_MAX_FIXTURE_BYTES,
    type ReplayFixtureV1,
} from '@iptvnator/portal/stalker/replay-fixtures';
import { validateReplayFixtureText } from './fixture-validator';
import {
    SAFE_OUTPUT_ERROR_CODES,
    SafeOutputError,
    writeReplayDraftSafely,
} from './safe-output';

function canonicalFixture(): string {
    const fixture: ReplayFixtureV1 = {
        schemaVersion: 1,
        scenarioId: 'safe-output-contract',
        description: 'Synthetic safe output fixture.',
        origins: { portal: {} },
        entry: { origin: 'portal', path: '/c/' },
        expectedEndpoint: { origin: 'portal', path: '/portal.php' },
        initialState: 'start',
        terminalState: 'complete',
        failOnUnexpectedRequest: true,
        symbols: [],
        phases: [
            {
                name: 'resolve',
                state: 'start',
                nextState: 'complete',
                mode: 'ordered',
                expectations: [
                    {
                        id: 'landing',
                        operation: 'landing',
                        origin: 'portal',
                        method: 'GET',
                        path: '/c/',
                        request: {
                            query: { exact: {}, present: [], absent: [] },
                            headers: {
                                exact: {},
                                present: [],
                                absent: [],
                            },
                            cookies: {
                                exact: {},
                                present: [],
                                absent: [],
                                attributes: {},
                            },
                            body: { kind: 'absent' },
                        },
                        response: {
                            status: 200,
                            headers: {
                                'content-type': ['application/json'],
                            },
                            body: { kind: 'json', value: { js: true } },
                        },
                        cardinality: { min: 1, max: 1 },
                    },
                ],
            },
        ],
    };
    return validateReplayFixtureText(JSON.stringify(fixture)).formatted;
}

async function expectOutputCode(
    operation: Promise<unknown>,
    code: string
): Promise<void> {
    try {
        await operation;
        throw new Error('draft output unexpectedly passed');
    } catch (error) {
        expect(error).toBeInstanceOf(SafeOutputError);
        expect((error as SafeOutputError).code).toBe(code);
        expect((error as Error).message).toBe(
            `Stalker HAR conversion failed: ${code}.`
        );
    }
}

describe('safe replay draft output', () => {
    let outputRoot: string;

    beforeEach(async () => {
        outputRoot = await mkdtemp(join(tmpdir(), 'stalker-draft-output-'));
    });

    afterEach(async () => {
        await chmod(outputRoot, 0o700).catch(() => undefined);
        await rm(outputRoot, { force: true, recursive: true });
    });

    it('publishes a canonical fixture atomically with private permissions', async () => {
        const outputPath = join(outputRoot, 'draft.json');
        const formatted = canonicalFixture();

        await writeReplayDraftSafely(outputPath, formatted);

        await expect(readFile(outputPath, 'utf8')).resolves.toBe(formatted);
        const stat = await lstat(outputPath);
        expect(stat.isFile()).toBe(true);
        expect(stat.isSymbolicLink()).toBe(false);
        expect(stat.nlink).toBe(1);
        expect(stat.mode & 0o777).toBe(0o600);
        expect(await readdir(outputRoot)).toEqual(['draft.json']);
    });

    it('refuses to overwrite an existing destination', async () => {
        const outputPath = join(outputRoot, 'draft.json');
        await writeFile(outputPath, 'owner-data');

        await expectOutputCode(
            writeReplayDraftSafely(outputPath, canonicalFixture()),
            SAFE_OUTPUT_ERROR_CODES.OutputExists
        );
        await expect(readFile(outputPath, 'utf8')).resolves.toBe('owner-data');
    });

    it('refuses a destination symlink without touching its target', async () => {
        const targetPath = join(outputRoot, 'owner-data.txt');
        const outputPath = join(outputRoot, 'draft.json');
        await writeFile(targetPath, 'owner-data');
        await symlink(targetPath, outputPath);

        await expectOutputCode(
            writeReplayDraftSafely(outputPath, canonicalFixture()),
            SAFE_OUTPUT_ERROR_CODES.OutputExists
        );
        await expect(readFile(targetPath, 'utf8')).resolves.toBe('owner-data');
    });

    it('rejects a symlink destination parent', async () => {
        const actualParent = join(outputRoot, 'actual');
        await import('node:fs/promises').then(({ mkdir }) =>
            mkdir(actualParent)
        );
        const linkedParent = join(outputRoot, 'linked');
        await symlink(actualParent, linkedParent);

        await expectOutputCode(
            writeReplayDraftSafely(
                join(linkedParent, 'draft.json'),
                canonicalFixture()
            ),
            SAFE_OUTPUT_ERROR_CODES.UnsafeOutputPath
        );
    });

    it('does not overwrite a symlink created during publication', async () => {
        const targetPath = join(outputRoot, 'owner-data.txt');
        const outputPath = join(outputRoot, 'draft.json');
        await writeFile(targetPath, 'owner-data');

        await expectOutputCode(
            writeReplayDraftSafely(outputPath, canonicalFixture(), {
                beforePublish: async () => {
                    await symlink(targetPath, outputPath);
                },
            }),
            SAFE_OUTPUT_ERROR_CODES.OutputExists
        );
        await expect(readFile(targetPath, 'utf8')).resolves.toBe('owner-data');
        expect((await readdir(outputRoot)).sort()).toEqual([
            'draft.json',
            'owner-data.txt',
        ]);
    });

    it('rejects a temporary file swapped before publication', async () => {
        const ownerPath = join(outputRoot, 'owner-data.txt');
        const outputPath = join(outputRoot, 'draft.json');
        await writeFile(ownerPath, 'owner-data');

        await expectOutputCode(
            writeReplayDraftSafely(outputPath, canonicalFixture(), {
                beforePublish: async (temporaryPath) => {
                    await rename(
                        temporaryPath,
                        join(outputRoot, 'displaced.tmp')
                    );
                    await symlink(ownerPath, temporaryPath);
                },
            }),
            SAFE_OUTPUT_ERROR_CODES.OutputPublishFailed
        );
        await expect(readFile(ownerPath, 'utf8')).resolves.toBe('owner-data');
        await expect(lstat(outputPath)).rejects.toThrow();
    });

    it('rejects oversized, invalid, and noncanonical draft text before opening output', async () => {
        const outputPath = join(outputRoot, 'draft.json');
        await expectOutputCode(
            writeReplayDraftSafely(
                outputPath,
                'x'.repeat(REPLAY_MAX_FIXTURE_BYTES + 1)
            ),
            SAFE_OUTPUT_ERROR_CODES.OutputTooLarge
        );
        await expectOutputCode(
            writeReplayDraftSafely(outputPath, '{}'),
            SAFE_OUTPUT_ERROR_CODES.InvalidDraft
        );
        await expectOutputCode(
            writeReplayDraftSafely(
                outputPath,
                JSON.stringify(
                    validateReplayFixtureText(canonicalFixture()).fixture
                )
            ),
            SAFE_OUTPUT_ERROR_CODES.InvalidDraft
        );
        await expect(lstat(outputPath)).rejects.toThrow();
    });

    it('rejects unsafe output names before creating temporary files', async () => {
        await expectOutputCode(
            writeReplayDraftSafely(
                join(outputRoot, '.draft.json'),
                canonicalFixture()
            ),
            SAFE_OUTPUT_ERROR_CODES.UnsafeOutputPath
        );
        expect(await readdir(outputRoot)).toEqual([]);
    });
});

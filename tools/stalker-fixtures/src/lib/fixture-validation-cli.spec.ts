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
import { join, resolve } from 'node:path';
import {
    REPLAY_MAX_FIXTURE_BYTES,
    type ReplayFixtureV1,
} from '@iptvnator/portal/stalker/replay-fixtures';
import {
    FIXTURE_VALIDATION_CLI_ERROR_CODES,
    FixtureValidationCliError,
    readFixtureFileBoundedForValidation,
    validateReplayFixtureDirectory,
} from './fixture-validation-cli';
import {
    FIXTURE_VALIDATION_ERROR_CODES,
    FixtureValidationError,
    validateReplayFixtureText,
} from './fixture-validator';

function replayFixture(): ReplayFixtureV1 {
    return {
        schemaVersion: 1,
        scenarioId: 'fixture-cli-contract',
        description: 'Synthetic resolver fixture.',
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
                            headers: { exact: {}, present: [], absent: [] },
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
}

async function expectCliCode(
    operation: Promise<unknown>,
    code: string
): Promise<void> {
    try {
        await operation;
        throw new Error('fixture directory unexpectedly passed');
    } catch (error) {
        expect(error).toBeInstanceOf(FixtureValidationCliError);
        expect((error as FixtureValidationCliError).code).toBe(code);
        expect((error as Error).message).toBe(
            `Stalker fixture validation failed: ${code}.`
        );
    }
}

async function expectValidationCode(
    operation: Promise<unknown>,
    code: string
): Promise<void> {
    try {
        await operation;
        throw new Error('fixture directory unexpectedly passed');
    } catch (error) {
        expect(error).toBeInstanceOf(FixtureValidationError);
        expect((error as FixtureValidationError).code).toBe(code);
        expect((error as Error).message).toBe(
            `Stalker fixture validation failed: ${code}.`
        );
    }
}

describe('fixture validation CLI', () => {
    let fixtureRoot: string;

    beforeEach(async () => {
        fixtureRoot = await mkdtemp(join(tmpdir(), 'stalker-fixtures-'));
    });

    afterEach(async () => {
        await rm(fixtureRoot, { force: true, recursive: true });
    });

    it('validates canonical JSON fixtures recursively', async () => {
        const resolverDirectory = join(fixtureRoot, 'resolver');
        await mkdir(resolverDirectory);
        const formatted = validateReplayFixtureText(
            JSON.stringify(replayFixture())
        ).formatted;
        await writeFile(join(resolverDirectory, 'root-landing.json'), formatted);

        await expect(validateReplayFixtureDirectory(fixtureRoot)).resolves.toBe(
            1
        );
    });

    it('rejects valid but noncanonical JSON', async () => {
        await writeFile(
            join(fixtureRoot, 'root-landing.json'),
            JSON.stringify(replayFixture())
        );

        await expectCliCode(
            validateReplayFixtureDirectory(fixtureRoot),
            FIXTURE_VALIDATION_CLI_ERROR_CODES.NoncanonicalFormat
        );
    });

    it('rejects symlinks instead of following them', async () => {
        const formatted = validateReplayFixtureText(
            JSON.stringify(replayFixture())
        ).formatted;
        const sourcePath = join(fixtureRoot, 'source.json');
        await writeFile(sourcePath, formatted);
        await symlink(sourcePath, join(fixtureRoot, 'linked.json'));

        await expectCliCode(
            validateReplayFixtureDirectory(fixtureRoot),
            FIXTURE_VALIDATION_CLI_ERROR_CODES.UnsafeFixturePath
        );
    });

    it('rejects an oversized file before materializing its contents', async () => {
        await writeFile(
            join(fixtureRoot, 'oversized.json'),
            'x'.repeat(REPLAY_MAX_FIXTURE_BYTES + 1)
        );

        await expectValidationCode(
            validateReplayFixtureDirectory(fixtureRoot),
            FIXTURE_VALIDATION_ERROR_CODES.FixtureTooLarge
        );
    });

    it('rejects multiply linked fixture files', async () => {
        const formatted = validateReplayFixtureText(
            JSON.stringify(replayFixture())
        ).formatted;
        const sourcePath = join(fixtureRoot, 'source.json');
        await writeFile(sourcePath, formatted);
        await link(sourcePath, join(fixtureRoot, 'linked.json'));

        await expectCliCode(
            validateReplayFixtureDirectory(fixtureRoot),
            FIXTURE_VALIDATION_CLI_ERROR_CODES.UnsafeFixturePath
        );
    });

    it('rejects a file swapped between preflight and open', async () => {
        const formatted = validateReplayFixtureText(
            JSON.stringify(replayFixture())
        ).formatted;
        const fixturePath = join(fixtureRoot, 'fixture.json');
        const replacementPath = join(fixtureRoot, 'replacement.json');
        await writeFile(fixturePath, formatted);
        await writeFile(replacementPath, formatted);

        await expectCliCode(
            readFixtureFileBoundedForValidation(fixturePath, async () => {
                await rename(fixturePath, join(fixtureRoot, 'original.json'));
                await rename(replacementPath, fixturePath);
            }),
            FIXTURE_VALIDATION_CLI_ERROR_CODES.UnsafeFixturePath
        );
    });

    it('rejects same-inode same-size mutation after preflight', async () => {
        const formatted = validateReplayFixtureText(
            JSON.stringify(replayFixture())
        ).formatted;
        const fixturePath = join(fixtureRoot, 'fixture.json');
        await writeFile(fixturePath, formatted);

        await expectCliCode(
            readFixtureFileBoundedForValidation(fixturePath, async () => {
                await writeFile(
                    fixturePath,
                    formatted.replace('Synthetic', 'Fynthetic')
                );
                await utimes(fixturePath, new Date(0), new Date(0));
            }),
            FIXTURE_VALIDATION_CLI_ERROR_CODES.UnsafeFixturePath
        );
    });

    it('rejects malformed UTF-8 without replacement decoding', async () => {
        await writeFile(
            join(fixtureRoot, 'invalid-utf8.json'),
            Buffer.from([0xc3, 0x28])
        );

        await expectCliCode(
            validateReplayFixtureDirectory(fixtureRoot),
            FIXTURE_VALIDATION_CLI_ERROR_CODES.InvalidUtf8
        );
    });

    it('rejects a UTF-8 BOM instead of silently normalizing it', async () => {
        const formatted = validateReplayFixtureText(
            JSON.stringify(replayFixture())
        ).formatted;
        await writeFile(
            join(fixtureRoot, 'bom.json'),
            Buffer.concat([
                Buffer.from([0xef, 0xbb, 0xbf]),
                Buffer.from(formatted),
            ])
        );

        await expectValidationCode(
            validateReplayFixtureDirectory(fixtureRoot),
            FIXTURE_VALIDATION_ERROR_CODES.InvalidSchema
        );
    });
});

describe('committed fixture corpus validation', () => {
    it('runs the fail-closed validator over every committed fixture', async () => {
        const fixtureRoot = resolve(
            process.cwd(),
            'apps/stalker-mock-server/fixtures/replay'
        );

        await expect(
            validateReplayFixtureDirectory(fixtureRoot)
        ).resolves.toBeGreaterThan(0);
    });
});

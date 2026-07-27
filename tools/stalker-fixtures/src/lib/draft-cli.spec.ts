import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { validateReplayFixtureText } from './fixture-validator';

interface CliResult {
    exitCode: number;
    stderr: string;
    stdout: string;
}

function minimalHar(): string {
    return JSON.stringify({
        log: {
            version: '1.2',
            entries: [
                {
                    request: {
                        method: 'GET',
                        url: 'https://captured-origin.private/c/',
                        headers: [],
                        cookies: [],
                    },
                    response: {
                        status: 200,
                        headers: [
                            {
                                name: 'Content-Type',
                                value: 'application/json',
                            },
                        ],
                        cookies: [],
                        content: {
                            mimeType: 'application/json',
                            text: JSON.stringify({ js: true }),
                        },
                    },
                },
            ],
        },
    });
}

function runCli(arguments_: readonly string[]): Promise<CliResult> {
    const executable = resolve(process.cwd(), 'node_modules/.bin/tsx');
    const environment = { ...process.env };
    delete environment['FORCE_COLOR'];
    delete environment['NO_COLOR'];
    return new Promise((resolvePromise) => {
        execFile(
            executable,
            [
                '--tsconfig',
                'tools/stalker-fixtures/tsconfig.json',
                'tools/stalker-fixtures/src/cli.ts',
                ...arguments_,
            ],
            {
                cwd: process.cwd(),
                encoding: 'utf8',
                env: environment,
                maxBuffer: 1024 * 1024,
                timeout: 15_000,
            },
            (error, stdout, stderr) => {
                resolvePromise({
                    exitCode:
                        error === null
                            ? 0
                            : typeof error.code === 'number'
                              ? error.code
                              : 1,
                    stdout,
                    stderr,
                });
            }
        );
    });
}

describe('HAR draft CLI', () => {
    let captureRoot: string;

    beforeEach(async () => {
        captureRoot = await mkdtemp(join(tmpdir(), 'stalker-draft-cli-'));
    });

    afterEach(async () => {
        await rm(captureRoot, { force: true, recursive: true });
    });

    it('converts an external HAR without printing either path', async () => {
        const inputPath = join(captureRoot, 'private-capture.har');
        const outputPath = join(captureRoot, 'sanitized-draft.json');
        await writeFile(inputPath, minimalHar());

        const result = await runCli(['draft', inputPath, outputPath]);

        expect(result).toEqual({
            exitCode: 0,
            stdout: 'Created sanitized Stalker replay draft.\n',
            stderr: '',
        });
        expect(result.stdout).not.toContain(inputPath);
        expect(result.stdout).not.toContain(outputPath);
        const output = await readFile(outputPath, 'utf8');
        expect(() => validateReplayFixtureText(output)).not.toThrow();
        expect(output).not.toContain('captured-origin.private');
    });

    it('emits only a stable sanitized error for invalid input', async () => {
        const secret = 'private-captured-secret';
        const inputPath = join(captureRoot, `${secret}.har`);
        const outputPath = join(captureRoot, 'sanitized-draft.json');
        await writeFile(inputPath, `{"${secret}":`);

        const result = await runCli(['draft', inputPath, outputPath]);

        expect(result.exitCode).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr).toBe(
            'Stalker HAR conversion failed: invalid-har-json.\n'
        );
        expect(result.stderr).not.toContain(secret);
        expect(result.stderr).not.toContain(inputPath);
        expect(result.stderr).not.toContain(outputPath);
    });
});

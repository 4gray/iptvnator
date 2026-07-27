import { resolve } from 'node:path';
import {
    FIXTURE_VALIDATION_CLI_ERROR_CODES,
    FixtureValidationCliError,
    validateReplayFixtureDirectory,
} from './lib/fixture-validation-cli';
import { FixtureValidationError } from './lib/fixture-validator';
import {
    HAR_TO_DRAFT_ERROR_CODES,
    HarToDraftError,
    convertHarToReplayDraft,
} from './lib/har-to-draft';
import { HarReaderError, readHarFile } from './lib/har-reader';
import { SafeOutputError, writeReplayDraftSafely } from './lib/safe-output';

const FIXTURE_ROOT = resolve(
    process.cwd(),
    'apps/stalker-mock-server/fixtures/replay'
);

async function main(): Promise<void> {
    const arguments_ = process.argv.slice(2);
    if (arguments_.length === 1 && arguments_[0] === 'validate') {
        const fixtureCount = await validateReplayFixtureDirectory(FIXTURE_ROOT);
        process.stdout.write(
            `Validated ${fixtureCount} Stalker replay fixture(s).\n`
        );
        return;
    }

    if (arguments_.length === 3 && arguments_[0] === 'draft') {
        const inputPath = arguments_[1];
        const outputPath = arguments_[2];
        if (inputPath === undefined || outputPath === undefined) {
            throw new HarToDraftError(
                HAR_TO_DRAFT_ERROR_CODES.UnsupportedCommand
            );
        }
        const har = await readHarFile(inputPath);
        const draft = convertHarToReplayDraft(har);
        await writeReplayDraftSafely(outputPath, draft.formatted);
        process.stdout.write('Created sanitized Stalker replay draft.\n');
        return;
    }

    if (arguments_[0] === 'draft') {
        throw new HarToDraftError(HAR_TO_DRAFT_ERROR_CODES.UnsupportedCommand);
    }
    throw new FixtureValidationCliError(
        FIXTURE_VALIDATION_CLI_ERROR_CODES.UnsupportedCommand
    );
}

void main().catch((error: unknown) => {
    const safeError =
        error instanceof FixtureValidationCliError ||
        error instanceof FixtureValidationError ||
        error instanceof HarReaderError ||
        error instanceof HarToDraftError ||
        error instanceof SafeOutputError
            ? error
            : process.argv[2] === 'draft'
              ? new HarToDraftError(HAR_TO_DRAFT_ERROR_CODES.InternalError)
              : new FixtureValidationCliError(
                    FIXTURE_VALIDATION_CLI_ERROR_CODES.InternalError
                );
    process.stderr.write(`${safeError.message}\n`);
    process.exitCode = 1;
});

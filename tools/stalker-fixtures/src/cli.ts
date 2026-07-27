import { resolve } from 'node:path';
import {
    FIXTURE_VALIDATION_CLI_ERROR_CODES,
    FixtureValidationCliError,
    validateReplayFixtureDirectory,
} from './lib/fixture-validation-cli';
import { FixtureValidationError } from './lib/fixture-validator';

const FIXTURE_ROOT = resolve(
    process.cwd(),
    'apps/stalker-mock-server/fixtures/replay'
);

async function main(): Promise<void> {
    const arguments_ = process.argv.slice(2);
    if (arguments_.length !== 1 || arguments_[0] !== 'validate') {
        throw new FixtureValidationCliError(
            FIXTURE_VALIDATION_CLI_ERROR_CODES.UnsupportedCommand
        );
    }

    const fixtureCount = await validateReplayFixtureDirectory(FIXTURE_ROOT);
    process.stdout.write(
        `Validated ${fixtureCount} Stalker replay fixture(s).\n`
    );
}

void main().catch((error: unknown) => {
    const safeError =
        error instanceof FixtureValidationCliError ||
        error instanceof FixtureValidationError
            ? error
            : new FixtureValidationCliError(
                  FIXTURE_VALIDATION_CLI_ERROR_CODES.InternalError
              );
    process.stderr.write(`${safeError.message}\n`);
    process.exitCode = 1;
});

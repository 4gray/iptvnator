import { resolve } from 'node:path';

import {
    ensureLargeLibraryProfile,
    largeLibraryProfileCacheKey,
    largeLibraryProfileCacheKeyInputs,
} from './large-library-profile-cache';
import { resolveLargeLibraryProfileSpec } from './large-library-profile';

/**
 * Builds (or finds) the large-library profile of the `launch-large` journey:
 *
 *   pnpm nx run electron-backend-e2e:large-library-profile
 *   pnpm nx run electron-backend-e2e:large-library-profile --args=--print-cache-key
 *
 * `--print-cache-key` prints the key only, for the CI cache step. Runs in
 * plain Node: the generator itself is spawned under Electron as Node.
 */
const workspaceRoot = resolve(__dirname, '../../../..');

async function main(): Promise<void> {
    if (process.argv.includes('--print-cache-key')) {
        const spec = resolveLargeLibraryProfileSpec(process.env);
        process.stdout.write(
            `${largeLibraryProfileCacheKey(
                largeLibraryProfileCacheKeyInputs(workspaceRoot, spec)
            )}\n`
        );
        return;
    }
    const profile = await ensureLargeLibraryProfile(workspaceRoot);
    process.stdout.write(
        `${JSON.stringify(
            {
                cached: profile.cached,
                cacheKey: profile.cacheKey,
                directory: profile.directory,
                manifest: profile.manifest,
            },
            null,
            2
        )}\n`
    );
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});

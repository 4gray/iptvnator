import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const EXACT_SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function validateNxVersionSync({ packageJson, lockfile }) {
    const diagnostics = [];
    const expectedVersion = packageJson.devDependencies?.nx;

    if (!expectedVersion) {
        diagnostics.push('package.json: devDependencies.nx is required');
    } else if (!EXACT_SEMVER.test(expectedVersion)) {
        diagnostics.push(
            `package.json: nx must use an exact semantic version, found "${expectedVersion}"`
        );
    }

    if (!expectedVersion || !EXACT_SEMVER.test(expectedVersion)) {
        return { diagnostics, expectedVersion };
    }

    for (const sectionName of [
        'dependencies',
        'devDependencies',
        'optionalDependencies',
    ]) {
        const section = packageJson[sectionName] ?? {};
        for (const [packageName, specifier] of Object.entries(section)) {
            if (
                packageName.startsWith('@nx/') &&
                specifier !== expectedVersion
            ) {
                diagnostics.push(
                    `package.json: ${sectionName}["${packageName}"] must match nx@${expectedVersion}, found "${specifier}"`
                );
            }
        }
    }

    let foundExpectedNx = false;
    for (const packageKey of Object.keys(lockfile.packages ?? {}).sort()) {
        const nxMatch = /^nx@(.+)$/.exec(packageKey);
        if (nxMatch) {
            const resolvedVersion = nxMatch[1];
            if (resolvedVersion === expectedVersion) {
                foundExpectedNx = true;
            } else {
                diagnostics.push(
                    `pnpm-lock.yaml: resolved nx@${resolvedVersion} must match nx@${expectedVersion}`
                );
            }
            continue;
        }

        const officialPackageMatch = /^(@nx\/[^@]+)@(.+)$/.exec(packageKey);
        if (
            officialPackageMatch &&
            officialPackageMatch[2] !== expectedVersion
        ) {
            diagnostics.push(
                `pnpm-lock.yaml: resolved ${officialPackageMatch[1]}@${officialPackageMatch[2]} must match nx@${expectedVersion}`
            );
        }
    }

    if (!foundExpectedNx) {
        diagnostics.push(
            `pnpm-lock.yaml: expected nx@${expectedVersion} to be resolved`
        );
    }

    return { diagnostics, expectedVersion };
}

const isMain =
    process.argv[1] &&
    resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
    const rootDir = process.cwd();
    const packageJson = JSON.parse(
        await readFile(resolve(rootDir, 'package.json'), 'utf8')
    );
    const lockfile = parse(
        await readFile(resolve(rootDir, 'pnpm-lock.yaml'), 'utf8')
    );
    const { diagnostics, expectedVersion } = validateNxVersionSync({
        packageJson,
        lockfile,
    });

    if (diagnostics.length > 0) {
        console.error('Nx dependency version policy failed:');
        for (const diagnostic of diagnostics) console.error(`- ${diagnostic}`);
        process.exitCode = 1;
    } else {
        console.log(
            `Nx dependency versions are synchronized at ${expectedVersion}.`
        );
    }
}

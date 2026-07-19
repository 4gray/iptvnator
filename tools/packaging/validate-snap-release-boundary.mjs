#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    collectEmbeddedMpvNativeArchiveEntries,
    listAsarPackageEntries,
} from './asar-dependency-closure.mjs';
import { validateExtractedSnapMetadata } from './verify-linux-frame-copy-runtime.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const SNAP_RELEASE_BOUNDARY_SCHEMA_VERSION = 1;

export function validateExtractedSnapReleaseBoundary(
    extractionRoot,
    { asarListPackage = listAsarPackageEntries } = {}
) {
    const errors = [...validateExtractedSnapMetadata(extractionRoot)];
    const asarPath = path.join(
        extractionRoot,
        'usr',
        'lib',
        'iptvnator',
        'resources',
        'app.asar'
    );
    let asarStat;
    try {
        asarStat = fs.lstatSync(asarPath);
    } catch {
        errors.push(
            `Public-release Snap must contain its canonical app.asar: ${asarPath}`
        );
        return errors;
    }
    if (
        !asarStat.isFile() ||
        asarStat.isSymbolicLink() ||
        asarStat.size === 0
    ) {
        errors.push(
            `Public-release Snap app.asar must be a non-empty regular file: ${asarPath}`
        );
        return errors;
    }

    let nativeEntries;
    try {
        nativeEntries = collectEmbeddedMpvNativeArchiveEntries(
            asarListPackage(asarPath)
        );
    } catch (error) {
        errors.push(
            `Unable to inspect public-release Snap app.asar at ${asarPath}: ${
                error instanceof Error ? error.message : String(error)
            }`
        );
        return errors;
    }
    if (nativeEntries.length > 0) {
        errors.push(
            `Public-release Snap app.asar must not contain embedded MPV native payloads: ${nativeEntries.join(
                ', '
            )}`
        );
    }
    return errors;
}

function main() {
    const args = process.argv.slice(2);
    if (args.length !== 1 || args[0].length === 0) {
        throw new Error(
            'Usage: validate-snap-release-boundary.mjs <extracted-snap-root>'
        );
    }
    const errors = validateExtractedSnapReleaseBoundary(path.resolve(args[0]));
    process.stdout.write(
        `${JSON.stringify({
            schemaVersion: SNAP_RELEASE_BOUNDARY_SCHEMA_VERSION,
            errors,
        })}\n`
    );
}

function isMainModule() {
    if (!process.argv[1]) {
        return false;
    }
    try {
        return fs.realpathSync(process.argv[1]) === fs.realpathSync(scriptPath);
    } catch {
        return false;
    }
}

if (isMainModule()) {
    try {
        main();
    } catch (error) {
        process.stderr.write(
            `${error instanceof Error ? error.message : String(error)}\n`
        );
        process.exitCode = 1;
    }
}

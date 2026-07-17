import { createHash } from 'crypto';
import * as nodeFileSystem from 'fs';
import path from 'path';
import {
    FRAME_COPY_ADDON_NAME,
    FRAME_COPY_HELPER_NAME,
    FRAME_COPY_READER_NAME,
} from './contracts';
import {
    validateDevelopmentManifest,
    validatePackagedManifest,
} from './manifest-validator';
import type {
    EmbeddedMpvFrameCopyManifestContract,
    EmbeddedMpvFrameCopyRuntimeFileSystem,
    RuntimeFile,
    ValidatedPackage,
    ValidationResult,
} from './types';
import {
    isMissingFileError,
    isValidationFailure,
    readManifest,
    validationFailure,
} from './validation-primitives';

function validateRegularArtifact(
    filePath: string,
    accessMode: number,
    expectedMode: number | null,
    fileSystem: EmbeddedMpvFrameCopyRuntimeFileSystem
): ValidationResult<nodeFileSystem.Stats> {
    let stat: nodeFileSystem.Stats;
    try {
        stat = fileSystem.lstatSync(filePath);
    } catch (error) {
        return validationFailure(
            isMissingFileError(error)
                ? 'runtime-artifact-missing'
                : 'runtime-artifact-invalid'
        );
    }

    if (
        stat.isSymbolicLink() ||
        !stat.isFile() ||
        (expectedMode !== null && (stat.mode & 0o777) !== expectedMode)
    ) {
        return validationFailure('runtime-artifact-invalid');
    }
    try {
        fileSystem.accessSync(filePath, accessMode);
    } catch {
        return validationFailure('runtime-artifact-invalid');
    }
    return { value: stat };
}

function pathExistsByLstat(
    filePath: string,
    fileSystem: EmbeddedMpvFrameCopyRuntimeFileSystem
): boolean {
    try {
        fileSystem.lstatSync(filePath);
        return true;
    } catch (error) {
        if (isMissingFileError(error)) {
            return false;
        }
        throw error;
    }
}

function validateBundledRuntimeFiles(
    nativeDir: string,
    runtimeFiles: RuntimeFile[],
    fileSystem: EmbeddedMpvFrameCopyRuntimeFileSystem
): ValidationResult<true> {
    const libDir = path.join(nativeDir, 'lib');
    let libStat: nodeFileSystem.Stats;
    try {
        libStat = fileSystem.lstatSync(libDir);
    } catch {
        return validationFailure('runtime-library-directory-invalid');
    }
    if (libStat.isSymbolicLink() || !libStat.isDirectory()) {
        return validationFailure('runtime-library-directory-invalid');
    }

    let packagedNames: string[];
    try {
        packagedNames = fileSystem.readdirSync(libDir) as string[];
    } catch {
        return validationFailure('runtime-library-directory-invalid');
    }
    const declaredNames = new Set(runtimeFiles.map(({ name }) => name));
    if (packagedNames.some((name) => !declaredNames.has(name))) {
        return validationFailure('runtime-library-undeclared');
    }

    for (const runtimeFile of runtimeFiles) {
        const runtimePath = path.join(libDir, runtimeFile.name);
        let stat: nodeFileSystem.Stats;
        try {
            stat = fileSystem.lstatSync(runtimePath);
        } catch (error) {
            return validationFailure(
                isMissingFileError(error)
                    ? 'runtime-library-missing'
                    : 'runtime-library-invalid'
            );
        }
        if (stat.isSymbolicLink() || !stat.isFile()) {
            return validationFailure('runtime-library-invalid');
        }
        try {
            fileSystem.accessSync(runtimePath, nodeFileSystem.constants.R_OK);
        } catch {
            return validationFailure('runtime-library-invalid');
        }
        if (stat.size !== runtimeFile.size) {
            return validationFailure('runtime-library-size-mismatch');
        }

        let contents: Buffer;
        try {
            contents = fileSystem.readFileSync(runtimePath);
        } catch {
            return validationFailure('runtime-library-invalid');
        }
        if (contents.length !== runtimeFile.size) {
            return validationFailure('runtime-library-size-mismatch');
        }
        const actualSha256 = createHash('sha256')
            .update(contents)
            .digest('hex');
        if (actualSha256 !== runtimeFile.sha256) {
            return validationFailure('runtime-library-hash-mismatch');
        }
    }
    return { value: true };
}

export function validatePackage(
    helperPath: string,
    manifestPath: string,
    fileSystem: EmbeddedMpvFrameCopyRuntimeFileSystem,
    manifestContract: EmbeddedMpvFrameCopyManifestContract
): ValidationResult<ValidatedPackage> {
    const nativeDir = path.dirname(helperPath);
    if (
        path.basename(helperPath) !== FRAME_COPY_HELPER_NAME ||
        path.dirname(manifestPath) !== nativeDir
    ) {
        return validationFailure('runtime-artifact-invalid');
    }

    const manifestArtifact = validateRegularArtifact(
        manifestPath,
        nodeFileSystem.constants.R_OK,
        0o644,
        fileSystem
    );
    if (isValidationFailure(manifestArtifact)) {
        return validationFailure(
            manifestArtifact.reason === 'runtime-artifact-missing'
                ? 'runtime-manifest-missing'
                : 'runtime-manifest-invalid'
        );
    }
    const manifestResult = readManifest(manifestPath, fileSystem);
    if (isValidationFailure(manifestResult)) {
        return manifestResult;
    }
    const validManifest =
        manifestContract === 'packaged'
            ? validatePackagedManifest(manifestResult.value)
            : validateDevelopmentManifest(manifestResult.value);
    if (isValidationFailure(validManifest)) {
        return validManifest;
    }

    for (const [artifactPath, accessMode, expectedMode] of [
        [
            path.join(nativeDir, FRAME_COPY_ADDON_NAME),
            nodeFileSystem.constants.R_OK,
            null,
        ],
        [
            path.join(nativeDir, FRAME_COPY_READER_NAME),
            nodeFileSystem.constants.R_OK,
            0o644,
        ],
        [
            helperPath,
            nodeFileSystem.constants.R_OK | nodeFileSystem.constants.X_OK,
            0o755,
        ],
    ] as const) {
        const artifact = validateRegularArtifact(
            artifactPath,
            accessMode,
            expectedMode,
            fileSystem
        );
        if (isValidationFailure(artifact)) {
            return artifact;
        }
    }

    const libDir = path.join(nativeDir, 'lib');
    if (validManifest.value.runtimeMode === 'system') {
        try {
            if (pathExistsByLstat(libDir, fileSystem)) {
                return validationFailure('runtime-library-directory-invalid');
            }
        } catch {
            return validationFailure('runtime-library-directory-invalid');
        }
    } else {
        const bundledRuntime = validateBundledRuntimeFiles(
            nativeDir,
            validManifest.value.runtimeFiles,
            fileSystem
        );
        if (isValidationFailure(bundledRuntime)) {
            return bundledRuntime;
        }
    }

    return {
        value: {
            manifest: validManifest.value,
            helperPath,
            nativeDir,
        },
    };
}

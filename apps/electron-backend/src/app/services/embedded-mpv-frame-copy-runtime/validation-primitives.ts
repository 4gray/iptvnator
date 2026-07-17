import { createHash } from 'crypto';
import type * as nodeFileSystem from 'fs';
import path from 'path';
import { isDeepStrictEqual } from 'util';
import {
    SAFE_RUNTIME_NAME_PATTERN,
    SHA256_PATTERN,
    SHARED_LIBRARY_PATTERN,
} from './contracts';
import type {
    EmbeddedMpvFrameCopyRuntimeFailureReason,
    EmbeddedMpvFrameCopyRuntimeFileSystem,
    EmbeddedMpvFrameCopyRuntimeResult,
    RuntimeFile,
    ValidationFailure,
    ValidationResult,
} from './types';

export function failure(
    reason: EmbeddedMpvFrameCopyRuntimeFailureReason
): EmbeddedMpvFrameCopyRuntimeResult {
    return { usable: false, reason };
}

export function validationFailure(
    reason: EmbeddedMpvFrameCopyRuntimeFailureReason
): ValidationFailure {
    return { reason };
}

export function isValidationFailure<T>(
    result: ValidationResult<T>
): result is ValidationFailure {
    return 'reason' in result;
}

export function isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function hasExactFields(
    value: Record<string, unknown>,
    fields: readonly string[]
): boolean {
    return isDeepStrictEqual(Object.keys(value).sort(), [...fields].sort());
}

export function isSafeRuntimeName(value: unknown): value is string {
    return (
        typeof value === 'string' &&
        value.length > 0 &&
        value !== '.' &&
        value !== '..' &&
        path.basename(value) === value &&
        !value.includes('/') &&
        !value.includes('\\') &&
        SAFE_RUNTIME_NAME_PATTERN.test(value) &&
        SHARED_LIBRARY_PATTERN.test(value)
    );
}

export function isMissingFileError(error: unknown): boolean {
    return (
        isObject(error) &&
        typeof error.code === 'string' &&
        (error.code === 'ENOENT' || error.code === 'ENOTDIR')
    );
}

export function fileIdentity(
    filePath: string,
    stat: nodeFileSystem.Stats,
    contents: Buffer
): string {
    return [
        path.resolve(filePath),
        stat.dev,
        stat.ino,
        stat.mode,
        stat.size,
        stat.mtimeMs,
        stat.ctimeMs,
        createHash('sha256').update(contents).digest('hex'),
    ].join(':');
}

export function readManifest(
    manifestPath: string,
    fileSystem: EmbeddedMpvFrameCopyRuntimeFileSystem
): ValidationResult<Record<string, unknown>> {
    let contents: Buffer;
    try {
        contents = fileSystem.readFileSync(manifestPath);
    } catch {
        return validationFailure('runtime-manifest-invalid');
    }

    try {
        const parsed: unknown = JSON.parse(contents.toString('utf8'));
        return isObject(parsed)
            ? { value: parsed }
            : validationFailure('runtime-manifest-invalid');
    } catch {
        return validationFailure('runtime-manifest-invalid');
    }
}

export function validateTargets(
    targets: unknown,
    allowedTargets: ReadonlySet<string>
): boolean {
    const expectedTargets = [...allowedTargets].sort();
    if (
        !Array.isArray(targets) ||
        targets.length !== expectedTargets.length ||
        targets.some(
            (target) =>
                typeof target !== 'string' ||
                target.trim() !== target ||
                target.toLowerCase() !== target ||
                !allowedTargets.has(target)
        )
    ) {
        return false;
    }
    return isDeepStrictEqual(targets, expectedTargets);
}

export function validateRuntimeFiles(value: unknown): RuntimeFile[] | null {
    if (!Array.isArray(value) || value.length === 0) {
        return null;
    }

    const runtimeFiles: RuntimeFile[] = [];
    const names = new Set<string>();
    for (const candidate of value) {
        if (
            !isObject(candidate) ||
            !hasExactFields(candidate, ['name', 'sha256', 'size']) ||
            !isSafeRuntimeName(candidate.name) ||
            !Number.isSafeInteger(candidate.size) ||
            (candidate.size as number) <= 0 ||
            typeof candidate.sha256 !== 'string' ||
            !SHA256_PATTERN.test(candidate.sha256) ||
            names.has(candidate.name)
        ) {
            return null;
        }
        names.add(candidate.name);
        runtimeFiles.push({
            name: candidate.name,
            size: candidate.size as number,
            sha256: candidate.sha256,
        });
    }
    return isDeepStrictEqual(
        runtimeFiles.map(({ name }) => name).sort(),
        runtimeFiles.map(({ name }) => name)
    )
        ? runtimeFiles
        : null;
}

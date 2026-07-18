import { spawnSync as nodeSpawnSync } from 'child_process';
import * as nodeFileSystem from 'fs';
import path from 'path';
import {
    RUNTIME_MANIFEST_NAME,
    RUNTIME_PROBE_PROTOCOL,
    RUNTIME_PROBE_TIMEOUT_MS,
} from './contracts';
import { createLinuxFrameCopyHelperLaunch } from './helper-launch';
import { validatePackage } from './package-validator';
import type {
    EmbeddedMpvFrameCopyManifestContract,
    EmbeddedMpvFrameCopyRuntimeDependencies,
    EmbeddedMpvFrameCopyRuntimeFileSystem,
    EmbeddedMpvFrameCopyRuntimeResult,
    ValidManifest,
    ValidatedPackage,
} from './types';
import {
    failure,
    fileIdentity,
    hasExactFields,
    isMissingFileError,
    isObject,
    isValidationFailure,
} from './validation-primitives';

function parseSuccessfulProbe(
    stdout: unknown,
    manifest: ValidManifest
): EmbeddedMpvFrameCopyRuntimeResult {
    if (typeof stdout !== 'string' || !/^[^\r\n]+\n$/.test(stdout)) {
        return failure('helper-probe-invalid-output');
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(stdout.slice(0, -1));
    } catch {
        return failure('helper-probe-invalid-output');
    }
    if (!isObject(parsed)) {
        return failure('helper-probe-invalid-output');
    }
    if (parsed.protocol !== RUNTIME_PROBE_PROTOCOL) {
        return failure('helper-probe-protocol-mismatch');
    }
    if (parsed.usable !== true) {
        return failure(
            parsed.usable === false
                ? 'helper-probe-unusable'
                : 'helper-probe-invalid-output'
        );
    }
    if (
        !hasExactFields(parsed, [
            'libmpv',
            'protocol',
            'renderApi',
            'usable',
        ]) ||
        typeof parsed.libmpv !== 'string' ||
        parsed.libmpv.trim() === '' ||
        parsed.renderApi !== 'egl'
    ) {
        return failure('helper-probe-invalid-output');
    }
    return {
        usable: true,
        profile: manifest.profile,
        runtimeMode: manifest.runtimeMode,
        libmpv: parsed.libmpv,
        renderApi: parsed.renderApi,
    };
}

function runHelperProbe(
    runtimePackage: ValidatedPackage,
    dependencies: EmbeddedMpvFrameCopyRuntimeDependencies
): EmbeddedMpvFrameCopyRuntimeResult {
    const launch = createLinuxFrameCopyHelperLaunch({
        environment: dependencies.env,
        helperPath: runtimePackage.helperPath,
        helperArgs: ['--runtime-probe'],
        runtimeMode: runtimePackage.manifest.runtimeMode,
        fileSystem: dependencies.fileSystem,
    });
    if (launch.usable === false) {
        return failure(launch.reason);
    }

    let result: ReturnType<typeof nodeSpawnSync>;
    try {
        result = dependencies.spawnSync(launch.command, launch.args, {
            encoding: 'utf8',
            timeout: RUNTIME_PROBE_TIMEOUT_MS,
            killSignal: 'SIGKILL',
            windowsHide: true,
            env: launch.env,
        });
    } catch {
        return failure('helper-probe-spawn-error');
    }

    if (
        result.error &&
        'code' in result.error &&
        result.error.code === 'ETIMEDOUT'
    ) {
        return failure('helper-probe-timeout');
    }
    if (result.error) {
        return failure('helper-probe-spawn-error');
    }
    if (result.signal) {
        return failure('helper-probe-signaled');
    }
    if (result.status !== 0) {
        return failure('helper-probe-failed');
    }
    return parseSuccessfulProbe(result.stdout, runtimePackage.manifest);
}

/**
 * Creates an isolated probe/cache. Production uses the singleton below;
 * tests inject filesystem and spawn collaborators through this factory.
 */
export function createEmbeddedMpvFrameCopyRuntimeProbe(
    overrides: Partial<EmbeddedMpvFrameCopyRuntimeDependencies> = {}
): (
    helperPath: string,
    manifestContract?: EmbeddedMpvFrameCopyManifestContract
) => EmbeddedMpvFrameCopyRuntimeResult {
    const defaultFileSystem: EmbeddedMpvFrameCopyRuntimeFileSystem = {
        accessSync: (filePath, mode) =>
            nodeFileSystem.accessSync(filePath, mode),
        lstatSync: (filePath) => nodeFileSystem.lstatSync(filePath),
        readFileSync: (filePath) => nodeFileSystem.readFileSync(filePath),
        readdirSync: (filePath) => nodeFileSystem.readdirSync(filePath),
    };
    const dependencies: EmbeddedMpvFrameCopyRuntimeDependencies = {
        platform: process.platform,
        arch: process.arch,
        env: process.env,
        fileSystem: defaultFileSystem,
        spawnSync: nodeSpawnSync,
        ...overrides,
    };
    const resultCache = new Map<string, EmbeddedMpvFrameCopyRuntimeResult>();

    return (
        helperPath: string,
        manifestContract: EmbeddedMpvFrameCopyManifestContract = 'packaged'
    ): EmbeddedMpvFrameCopyRuntimeResult => {
        if (dependencies.platform !== 'linux') {
            return failure('unsupported-platform');
        }
        if (dependencies.arch !== 'x64') {
            return failure('unsupported-architecture');
        }

        const manifestPath = path.join(
            path.dirname(helperPath),
            RUNTIME_MANIFEST_NAME
        );
        let helperStat: nodeFileSystem.Stats;
        let manifestStat: nodeFileSystem.Stats;
        try {
            helperStat = dependencies.fileSystem.lstatSync(helperPath);
        } catch {
            return failure('runtime-artifact-missing');
        }
        try {
            manifestStat = dependencies.fileSystem.lstatSync(manifestPath);
        } catch (error) {
            return failure(
                isMissingFileError(error)
                    ? 'runtime-manifest-missing'
                    : 'runtime-manifest-invalid'
            );
        }

        let helperContents: Buffer;
        let manifestContents: Buffer;
        try {
            helperContents = dependencies.fileSystem.readFileSync(helperPath);
        } catch {
            return failure('runtime-artifact-invalid');
        }
        try {
            manifestContents =
                dependencies.fileSystem.readFileSync(manifestPath);
        } catch {
            return failure('runtime-manifest-invalid');
        }

        const cacheKey = `${manifestContract}\0${fileIdentity(
            helperPath,
            helperStat,
            helperContents
        )}\0${fileIdentity(manifestPath, manifestStat, manifestContents)}`;
        const cached = resultCache.get(cacheKey);
        if (cached) {
            return cached;
        }

        let result: EmbeddedMpvFrameCopyRuntimeResult;
        try {
            const runtimePackage = validatePackage(
                helperPath,
                manifestPath,
                dependencies.fileSystem,
                manifestContract
            );
            result = isValidationFailure(runtimePackage)
                ? failure(runtimePackage.reason)
                : runHelperProbe(runtimePackage.value, dependencies);
        } catch {
            result = failure('runtime-probe-internal-error');
        }
        resultCache.set(cacheKey, result);
        return result;
    };
}

const processRuntimeProbe = createEmbeddedMpvFrameCopyRuntimeProbe();

/**
 * Fail-closed, process-lifetime Linux runtime decision shared by startup and
 * the service gate. The helper and manifest identities scope cached results.
 */
export function probeEmbeddedMpvFrameCopyRuntime(
    helperPath: string,
    manifestContract: EmbeddedMpvFrameCopyManifestContract
): EmbeddedMpvFrameCopyRuntimeResult {
    return processRuntimeProbe(helperPath, manifestContract);
}

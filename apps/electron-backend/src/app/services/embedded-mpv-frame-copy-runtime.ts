import { spawnSync as nodeSpawnSync } from 'child_process';
import { createHash } from 'crypto';
import * as nodeFileSystem from 'fs';
import { isDeepStrictEqual } from 'util';
import path from 'path';

const RUNTIME_MANIFEST_NAME = 'embedded-mpv-runtime.json';
const FRAME_COPY_ADDON_NAME = 'embedded_mpv.node';
const FRAME_COPY_READER_NAME = 'embedded_mpv_frame_reader.node';
const FRAME_COPY_HELPER_NAME = 'iptvnator_mpv_helper';
const RUNTIME_PROBE_PROTOCOL = 1;
const RUNTIME_PROBE_TIMEOUT_MS = 3000;
const LINUX_LIBRARY_PATH_DELIMITER = ':';
const VERSIONED_LIBMPV_PATTERN = /^libmpv\.so\.\d+(?:\.\d+)*$/;
const SAFE_RUNTIME_NAME_PATTERN = /^[A-Za-z0-9_+.-]+$/;
const SHARED_LIBRARY_PATTERN = /\.so(?:\.\d+)*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

const EXPECTED_ARTIFACTS = {
    addon: {
        name: FRAME_COPY_ADDON_NAME,
        regularFile: true,
        readable: true,
    },
    frameReader: {
        name: FRAME_COPY_READER_NAME,
        regularFile: true,
        readable: true,
    },
    helper: {
        name: FRAME_COPY_HELPER_NAME,
        regularFile: true,
        readable: true,
        executable: true,
    },
};

const EXPECTED_PROCESS_ISOLATION = {
    addonLoadsLibmpv: false,
    readerLoadsLibmpv: false,
    electronLoadsLibmpv: false,
    helperLinksLibmpv: true,
    helperRunpath: ['$ORIGIN/lib'],
};

const SYSTEM_PACKAGE_DEPENDENCIES = {
    deb: 'libmpv2',
    rpm: 'mpv-libs',
    pacman: 'mpv',
};

const PROFILE_CONTRACTS = {
    system: {
        origin: 'system-libmpv-frame-copy',
        runtimeMode: 'system',
        targets: new Set(['deb', 'rpm', 'pacman']),
    },
    portable: {
        origin: 'bundled-lgpl-frame-copy',
        runtimeMode: 'bundled',
        targets: new Set(['appimage', 'snap']),
    },
    flatpak: {
        origin: 'bundled-lgpl-frame-copy',
        runtimeMode: 'bundled',
        targets: new Set(['flatpak']),
    },
} as const;

const BASE_MANIFEST_FIELDS = [
    'arch',
    'artifacts',
    'generatedAt',
    'libmpvSoname',
    'nativeViewFallback',
    'origin',
    'packageDependencies',
    'platform',
    'processIsolation',
    'profile',
    'runtimeFiles',
    'runtimeMode',
    'runtimeTotalBytes',
    'schemaVersion',
    'targets',
] as const;

const BUNDLED_MANIFEST_FIELDS = [
    ...BASE_MANIFEST_FIELDS,
    'externalSystemLibraries',
    'runtimeDependencyClosure',
    'sourceRuntime',
] as const;

export type EmbeddedMpvFrameCopyRuntimeFailureReason =
    | 'unsupported-platform'
    | 'unsupported-architecture'
    | 'runtime-manifest-missing'
    | 'runtime-manifest-invalid'
    | 'runtime-artifact-missing'
    | 'runtime-artifact-invalid'
    | 'runtime-library-directory-invalid'
    | 'runtime-library-missing'
    | 'runtime-library-undeclared'
    | 'runtime-library-invalid'
    | 'runtime-library-size-mismatch'
    | 'runtime-library-hash-mismatch'
    | 'helper-probe-timeout'
    | 'helper-probe-spawn-error'
    | 'helper-probe-signaled'
    | 'helper-probe-failed'
    | 'helper-probe-invalid-output'
    | 'helper-probe-protocol-mismatch'
    | 'helper-probe-unusable'
    | 'runtime-probe-internal-error';

export type EmbeddedMpvFrameCopyRuntimeResult =
    | {
          usable: true;
          profile: keyof typeof PROFILE_CONTRACTS;
          runtimeMode: 'system' | 'bundled';
          libmpv: string;
          renderApi: 'egl';
      }
    | {
          usable: false;
          reason: EmbeddedMpvFrameCopyRuntimeFailureReason;
      };

export interface EmbeddedMpvFrameCopyRuntimeFileSystem {
    accessSync(filePath: string, mode: number): void;
    lstatSync(filePath: string): nodeFileSystem.Stats;
    readFileSync(filePath: string): Buffer;
    readdirSync(filePath: string): string[];
}

export interface EmbeddedMpvFrameCopyRuntimeDependencies {
    platform: NodeJS.Platform;
    arch: string;
    env: NodeJS.ProcessEnv;
    fileSystem: EmbeddedMpvFrameCopyRuntimeFileSystem;
    spawnSync: typeof nodeSpawnSync;
}

type RuntimeProfile = keyof typeof PROFILE_CONTRACTS;

interface RuntimeFile {
    name: string;
    size: number;
    sha256: string;
}

interface ValidManifest {
    profile: RuntimeProfile;
    runtimeMode: 'system' | 'bundled';
    runtimeFiles: RuntimeFile[];
}

interface ValidatedPackage {
    manifest: ValidManifest;
    helperPath: string;
    nativeDir: string;
}

interface ValidationSuccess<T> {
    value: T;
}

interface ValidationFailure {
    reason: EmbeddedMpvFrameCopyRuntimeFailureReason;
}

type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

function failure(
    reason: EmbeddedMpvFrameCopyRuntimeFailureReason
): EmbeddedMpvFrameCopyRuntimeResult {
    return { usable: false, reason };
}

function validationFailure(
    reason: EmbeddedMpvFrameCopyRuntimeFailureReason
): ValidationFailure {
    return { reason };
}

function isValidationFailure<T>(
    result: ValidationResult<T>
): result is ValidationFailure {
    return 'reason' in result;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactFields(
    value: Record<string, unknown>,
    fields: readonly string[]
): boolean {
    return isDeepStrictEqual(Object.keys(value).sort(), [...fields].sort());
}

function isSafeRuntimeName(value: unknown): value is string {
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

function isMissingFileError(error: unknown): boolean {
    return (
        isObject(error) &&
        typeof error.code === 'string' &&
        (error.code === 'ENOENT' || error.code === 'ENOTDIR')
    );
}

function fileIdentity(filePath: string, stat: nodeFileSystem.Stats): string {
    return [
        path.resolve(filePath),
        stat.dev,
        stat.ino,
        stat.mode,
        stat.size,
        stat.mtimeMs,
        stat.ctimeMs,
    ].join(':');
}

function readManifest(
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

function validateTargets(
    targets: unknown,
    allowedTargets: ReadonlySet<string>
): boolean {
    if (
        !Array.isArray(targets) ||
        targets.length === 0 ||
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
    return (
        new Set(targets).size === targets.length &&
        isDeepStrictEqual([...targets].sort(), targets)
    );
}

function validateRuntimeFiles(value: unknown): RuntimeFile[] | null {
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

function validateRuntimeClosure(
    value: unknown,
    runtimeFiles: RuntimeFile[],
    libmpvSoname: string
): boolean {
    if (
        !isObject(value) ||
        !hasExactFields(value, ['entries', 'externalDependencies']) ||
        !Array.isArray(value.entries) ||
        !Array.isArray(value.externalDependencies) ||
        value.externalDependencies.some(
            (dependency) =>
                typeof dependency !== 'string' ||
                !SAFE_RUNTIME_NAME_PATTERN.test(dependency)
        )
    ) {
        return false;
    }

    const runtimeNames = runtimeFiles.map(({ name }) => name);
    const closureNames: string[] = [];
    for (const entry of value.entries) {
        if (
            !isObject(entry) ||
            !hasExactFields(entry, [
                'name',
                'needed',
                'rpath',
                'runpath',
                'soname',
            ]) ||
            !isSafeRuntimeName(entry.name) ||
            (entry.soname !== null && !isSafeRuntimeName(entry.soname)) ||
            !Array.isArray(entry.needed) ||
            entry.needed.some(
                (dependency) =>
                    typeof dependency !== 'string' ||
                    !SAFE_RUNTIME_NAME_PATTERN.test(dependency)
            ) ||
            !isDeepStrictEqual(entry.rpath, []) ||
            !isDeepStrictEqual(entry.runpath, ['$ORIGIN'])
        ) {
            return false;
        }
        closureNames.push(entry.name);
    }

    const linkerAlias = value.entries.find(
        (entry) => isObject(entry) && entry.name === 'libmpv.so'
    );
    return (
        isDeepStrictEqual([...closureNames].sort(), [...runtimeNames].sort()) &&
        new Set(closureNames).size === closureNames.length &&
        isObject(linkerAlias) &&
        linkerAlias.soname === libmpvSoname
    );
}

function validateManifest(
    manifest: Record<string, unknown>
): ValidationResult<ValidManifest> {
    if (
        manifest.schemaVersion !== 1 ||
        manifest.platform !== 'linux' ||
        manifest.arch !== 'x64' ||
        typeof manifest.profile !== 'string' ||
        !Object.prototype.hasOwnProperty.call(
            PROFILE_CONTRACTS,
            manifest.profile
        )
    ) {
        return validationFailure('runtime-manifest-invalid');
    }

    const profile = manifest.profile as RuntimeProfile;
    const contract = PROFILE_CONTRACTS[profile];
    if (
        manifest.origin !== contract.origin ||
        manifest.runtimeMode !== contract.runtimeMode ||
        !hasExactFields(
            manifest,
            contract.runtimeMode === 'bundled'
                ? BUNDLED_MANIFEST_FIELDS
                : BASE_MANIFEST_FIELDS
        ) ||
        typeof manifest.generatedAt !== 'string' ||
        manifest.generatedAt.trim() === '' ||
        Number.isNaN(Date.parse(manifest.generatedAt)) ||
        !validateTargets(manifest.targets, contract.targets) ||
        !isDeepStrictEqual(manifest.artifacts, EXPECTED_ARTIFACTS) ||
        !isDeepStrictEqual(
            manifest.processIsolation,
            EXPECTED_PROCESS_ISOLATION
        ) ||
        manifest.nativeViewFallback !== 'process-isolated mpv --wid' ||
        typeof manifest.libmpvSoname !== 'string' ||
        !VERSIONED_LIBMPV_PATTERN.test(manifest.libmpvSoname)
    ) {
        return validationFailure('runtime-manifest-invalid');
    }

    if (contract.runtimeMode === 'system') {
        if (
            !isDeepStrictEqual(
                manifest.packageDependencies,
                SYSTEM_PACKAGE_DEPENDENCIES
            ) ||
            !isDeepStrictEqual(manifest.runtimeFiles, []) ||
            manifest.runtimeTotalBytes !== 0
        ) {
            return validationFailure('runtime-manifest-invalid');
        }
        return {
            value: {
                profile,
                runtimeMode: 'system',
                runtimeFiles: [],
            },
        };
    }

    const runtimeFiles = validateRuntimeFiles(manifest.runtimeFiles);
    if (
        !runtimeFiles ||
        !isDeepStrictEqual(manifest.packageDependencies, {}) ||
        !runtimeFiles.some(({ name }) => name === 'libmpv.so') ||
        !runtimeFiles.some(({ name }) => name === manifest.libmpvSoname) ||
        manifest.runtimeTotalBytes !==
            runtimeFiles.reduce(
                (total, runtimeFile) => total + runtimeFile.size,
                0
            ) ||
        !validateRuntimeClosure(
            manifest.runtimeDependencyClosure,
            runtimeFiles,
            manifest.libmpvSoname
        ) ||
        !Array.isArray(manifest.externalSystemLibraries) ||
        !isObject(manifest.sourceRuntime)
    ) {
        return validationFailure('runtime-manifest-invalid');
    }

    const sourceRuntime = manifest.sourceRuntime;
    if (
        sourceRuntime.schemaVersion !== 1 ||
        sourceRuntime.origin !== 'vendored-lgpl-source-build' ||
        sourceRuntime.platform !== 'linux' ||
        sourceRuntime.arch !== 'x64' ||
        sourceRuntime.runtimeTotalBytes !== manifest.runtimeTotalBytes ||
        !isDeepStrictEqual(sourceRuntime.runtimeFiles, manifest.runtimeFiles) ||
        !isDeepStrictEqual(
            sourceRuntime.runtimeDependencyClosure,
            manifest.runtimeDependencyClosure
        ) ||
        !isDeepStrictEqual(
            sourceRuntime.externalSystemLibraries,
            manifest.externalSystemLibraries
        )
    ) {
        return validationFailure('runtime-manifest-invalid');
    }

    return {
        value: {
            profile,
            runtimeMode: 'bundled',
            runtimeFiles,
        },
    };
}

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

function validatePackage(
    helperPath: string,
    manifestPath: string,
    fileSystem: EmbeddedMpvFrameCopyRuntimeFileSystem
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
    const validManifest = validateManifest(manifestResult.value);
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
    const probeEnvironment = { ...dependencies.env };
    if (runtimePackage.manifest.runtimeMode === 'bundled') {
        const bundledLibDir = path.join(runtimePackage.nativeDir, 'lib');
        probeEnvironment.LD_LIBRARY_PATH =
            bundledLibDir +
            (probeEnvironment.LD_LIBRARY_PATH
                ? `${LINUX_LIBRARY_PATH_DELIMITER}${probeEnvironment.LD_LIBRARY_PATH}`
                : '');
    }

    let result: ReturnType<typeof nodeSpawnSync>;
    try {
        result = dependencies.spawnSync(
            runtimePackage.helperPath,
            ['--runtime-probe'],
            {
                encoding: 'utf8',
                timeout: RUNTIME_PROBE_TIMEOUT_MS,
                windowsHide: true,
                env: probeEnvironment,
            }
        );
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
): (helperPath: string) => EmbeddedMpvFrameCopyRuntimeResult {
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

    return (helperPath: string): EmbeddedMpvFrameCopyRuntimeResult => {
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

        const cacheKey = `${fileIdentity(
            helperPath,
            helperStat
        )}\0${fileIdentity(manifestPath, manifestStat)}`;
        const cached = resultCache.get(cacheKey);
        if (cached) {
            return cached;
        }

        let result: EmbeddedMpvFrameCopyRuntimeResult;
        try {
            const runtimePackage = validatePackage(
                helperPath,
                manifestPath,
                dependencies.fileSystem
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
    helperPath: string
): EmbeddedMpvFrameCopyRuntimeResult {
    return processRuntimeProbe(helperPath);
}

import type { spawnSync as nodeSpawnSync } from 'child_process';
import type * as nodeFileSystem from 'fs';

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

export type EmbeddedMpvFrameCopyManifestContract = 'packaged' | 'development';
export type EmbeddedMpvFrameCopyRuntimeMode = 'system' | 'bundled';

export type RuntimeProfile = 'system' | 'portable' | 'flatpak';
export type RuntimeProbeProfile = RuntimeProfile | 'development';

export type EmbeddedMpvFrameCopyRuntimeResult =
    | {
          usable: true;
          profile: RuntimeProbeProfile;
          runtimeMode: EmbeddedMpvFrameCopyRuntimeMode;
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

export interface RuntimeFile {
    name: string;
    size: number;
    sha256: string;
}

export interface ValidManifest {
    profile: RuntimeProbeProfile;
    runtimeMode: EmbeddedMpvFrameCopyRuntimeMode;
    runtimeFiles: RuntimeFile[];
}

export interface ValidatedPackage {
    manifest: ValidManifest;
    helperPath: string;
    nativeDir: string;
}

export interface ValidationSuccess<T> {
    value: T;
}

export interface ValidationFailure {
    reason: EmbeddedMpvFrameCopyRuntimeFailureReason;
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

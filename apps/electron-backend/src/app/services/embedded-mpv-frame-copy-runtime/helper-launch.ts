import {
    accessSync as nodeAccessSync,
    constants as fileSystemConstants,
    lstatSync as nodeLstatSync,
} from 'fs';
import type * as nodeFileSystem from 'fs';
import path from 'path';
import { createLinuxFrameCopyHelperEnvironment } from './helper-environment';
import { resolveTrustedSnapRoot } from './trusted-snap-root';
import type {
    EmbeddedMpvFrameCopyRuntimeFailureReason,
    EmbeddedMpvFrameCopyRuntimeMode,
} from './types';

export interface LinuxFrameCopyHelperLaunchFileSystem {
    lstatSync(filePath: string): nodeFileSystem.Stats;
    accessSync(filePath: string, mode: number): void;
}

interface CreateLinuxFrameCopyHelperLaunchOptions {
    environment: NodeJS.ProcessEnv;
    helperPath: string;
    helperArgs: string[];
    runtimeMode: EmbeddedMpvFrameCopyRuntimeMode;
    fileSystem?: LinuxFrameCopyHelperLaunchFileSystem;
}

export type LinuxFrameCopyHelperLaunch =
    | {
          usable: true;
          command: string;
          args: string[];
          env: NodeJS.ProcessEnv;
      }
    | {
          usable: false;
          reason: EmbeddedMpvFrameCopyRuntimeFailureReason;
      };

export function createLinuxFrameCopyHelperLaunch(
    options: CreateLinuxFrameCopyHelperLaunchOptions
): LinuxFrameCopyHelperLaunch {
    const nativeDir = path.dirname(options.helperPath);
    const env = createLinuxFrameCopyHelperEnvironment(
        options.environment,
        nativeDir,
        options.runtimeMode
    );
    const trustedSnapRoot =
        options.runtimeMode === 'bundled'
            ? resolveTrustedSnapRoot(options.environment, nativeDir)
            : null;
    if (!trustedSnapRoot) {
        return {
            usable: true,
            command: options.helperPath,
            args: options.helperArgs,
            env,
        };
    }

    const graphicsRoot = path.join(trustedSnapRoot, 'graphics');
    const providerWrapperPath = path.join(
        graphicsRoot,
        'bin',
        'graphics-core22-provider-wrapper'
    );
    const fileSystem = options.fileSystem ?? {
        lstatSync: nodeLstatSync,
        accessSync: nodeAccessSync,
    };
    try {
        const graphicsRootStat = fileSystem.lstatSync(graphicsRoot);
        const providerWrapperStat = fileSystem.lstatSync(providerWrapperPath);
        if (
            !graphicsRootStat.isDirectory() ||
            graphicsRootStat.isSymbolicLink() ||
            !providerWrapperStat.isFile() ||
            providerWrapperStat.isSymbolicLink()
        ) {
            return {
                usable: false,
                reason: 'snap-graphics-provider-unavailable',
            };
        }
        fileSystem.accessSync(
            providerWrapperPath,
            fileSystemConstants.R_OK | fileSystemConstants.X_OK
        );
    } catch {
        return {
            usable: false,
            reason: 'snap-graphics-provider-unavailable',
        };
    }

    return {
        usable: true,
        command: providerWrapperPath,
        args: [options.helperPath, ...options.helperArgs],
        env,
    };
}

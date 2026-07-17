import { spawnSync } from 'child_process';
import {
    accessSync,
    lstatSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
} from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
    createEmbeddedMpvFrameCopyRuntimeProbe,
    type EmbeddedMpvFrameCopyRuntimeDependencies,
} from '../embedded-mpv-frame-copy-runtime';
import { SUCCESS_OUTPUT } from './runtime.spec-data';

export interface RuntimeTestContext {
    rootDir: string;
    spawnRuntimeProbe: jest.Mock;
    fileSystem: EmbeddedMpvFrameCopyRuntimeDependencies['fileSystem'];
    createProbe(
        overrides?: Partial<EmbeddedMpvFrameCopyRuntimeDependencies>
    ): ReturnType<typeof createEmbeddedMpvFrameCopyRuntimeProbe>;
    dispose(): void;
}

export function createRuntimeTestContext(): RuntimeTestContext {
    const rootDir = mkdtempSync(path.join(tmpdir(), 'iptvnator-fc-runtime-'));
    const spawnRuntimeProbe = jest.fn(() => ({
        status: 0,
        signal: null,
        stdout: SUCCESS_OUTPUT,
        stderr: '',
    }));
    const fileSystem: EmbeddedMpvFrameCopyRuntimeDependencies['fileSystem'] = {
        accessSync: jest.fn((filePath: string, mode: number) =>
            accessSync(filePath, mode)
        ),
        lstatSync: jest.fn((filePath: string) => lstatSync(filePath)),
        readFileSync: jest.fn((filePath: string) => readFileSync(filePath)),
        readdirSync: jest.fn((filePath: string) => readdirSync(filePath)),
    };
    const context: RuntimeTestContext = {
        rootDir,
        spawnRuntimeProbe,
        fileSystem,
        createProbe(
            overrides: Partial<EmbeddedMpvFrameCopyRuntimeDependencies> = {}
        ) {
            return createEmbeddedMpvFrameCopyRuntimeProbe({
                platform: 'linux',
                arch: 'x64',
                env: {
                    PATH: '/usr/bin',
                    LD_LIBRARY_PATH: '/ambient/libs',
                    LD_PRELOAD: '/tmp/inject.so',
                },
                fileSystem: context.fileSystem,
                spawnSync: context.spawnRuntimeProbe as typeof spawnSync,
                ...overrides,
            });
        },
        dispose() {
            rmSync(context.rootDir, { recursive: true, force: true });
        },
    };
    return context;
}

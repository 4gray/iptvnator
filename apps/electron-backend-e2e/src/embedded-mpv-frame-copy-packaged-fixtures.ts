import type {
    EmbeddedMpvSession,
    EmbeddedMpvSupport,
} from '@iptvnator/shared/interfaces';
import { spawnSync } from 'child_process';
import { createServer, type Server } from 'http';
import { existsSync, readFileSync, renameSync, statSync } from 'fs';
import { join } from 'path';
import sharp = require('sharp');
import {
    closeElectronApp,
    expect,
    type LaunchedElectronApp,
} from './electron-test-fixtures';

declare global {
    interface Window {
        __packagedEmbeddedMpvSessions?: EmbeddedMpvSession[];
        __packagedEmbeddedMpvUnsubscribe?: () => void;
    }
}

export type LocalMediaServer = {
    close: () => Promise<void>;
    url: string;
};

export type RuntimeManifestGuard = {
    hide: () => void;
    restore: () => void;
};

export type PackagedRuntimeIdentity = {
    arch: string;
    platform: string;
    profile: string;
    runtimeMode: string;
};

function createTwoSecondY4mFixture(): Buffer {
    const width = 64;
    const height = 36;
    const framesPerSecond = 10;
    const frameCount = framesPerSecond * 2;
    const yPlaneBytes = width * height;
    const chromaPlaneBytes = (width / 2) * (height / 2);
    const chunks: Buffer[] = [
        Buffer.from(
            `YUV4MPEG2 W${width} H${height} F${framesPerSecond}:1 Ip A1:1 C420jpeg\n`,
            'ascii'
        ),
    ];

    for (let index = 0; index < frameCount; index += 1) {
        const evenFrame = index % 2 === 0;
        chunks.push(
            Buffer.from('FRAME\n', 'ascii'),
            Buffer.alloc(yPlaneBytes, evenFrame ? 76 : 150),
            Buffer.alloc(chromaPlaneBytes, evenFrame ? 84 : 44),
            Buffer.alloc(chromaPlaneBytes, evenFrame ? 255 : 21)
        );
    }

    return Buffer.concat(chunks);
}

async function listen(server: Server): Promise<void> {
    await new Promise<void>((resolvePromise, rejectPromise) => {
        const onError = (error: Error) => {
            server.off('listening', onListening);
            rejectPromise(error);
        };
        const onListening = () => {
            server.off('error', onError);
            resolvePromise();
        };

        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(0, '127.0.0.1');
    });
}

async function closeServer(server: Server): Promise<void> {
    await new Promise<void>((resolvePromise, rejectPromise) => {
        server.close((error) => {
            if (error) {
                rejectPromise(error);
                return;
            }
            resolvePromise();
        });
    });
}

export async function createLocalMediaServer(): Promise<LocalMediaServer> {
    const body = createTwoSecondY4mFixture();
    const resourcePath = '/embedded-mpv-frame-copy-smoke.y4m';
    const server = createServer((request, response) => {
        const pathname = (request.url ?? '').split('?')[0];
        if (pathname !== resourcePath) {
            response.writeHead(404).end();
            return;
        }

        const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
        if (!range) {
            response.writeHead(200, {
                'Accept-Ranges': 'bytes',
                'Content-Length': body.length,
                'Content-Type': 'video/x-yuv4mpeg',
            });
            response.end(request.method === 'HEAD' ? undefined : body);
            return;
        }

        const start = Number(range[1]);
        const requestedEnd = range[2] ? Number(range[2]) : body.length - 1;
        const end = Math.min(requestedEnd, body.length - 1);
        if (
            !Number.isSafeInteger(start) ||
            !Number.isSafeInteger(end) ||
            start < 0 ||
            start > end ||
            start >= body.length
        ) {
            response.writeHead(416, {
                'Content-Range': `bytes */${body.length}`,
            });
            response.end();
            return;
        }

        response.writeHead(206, {
            'Accept-Ranges': 'bytes',
            'Content-Length': end - start + 1,
            'Content-Range': `bytes ${start}-${end}/${body.length}`,
            'Content-Type': 'video/x-yuv4mpeg',
        });
        response.end(
            request.method === 'HEAD'
                ? undefined
                : body.subarray(start, end + 1)
        );
    });

    await listen(server);
    const address = server.address();
    if (!address || typeof address === 'string') {
        await closeServer(server);
        throw new Error('Unable to resolve the local media server address.');
    }

    return {
        close: () => closeServer(server),
        url: `http://127.0.0.1:${address.port}${resourcePath}`,
    };
}

export function createRuntimeManifestGuard(
    nativeDir: string
): RuntimeManifestGuard {
    const runtimeManifestPath = join(nativeDir, 'embedded-mpv-runtime.json');
    const hiddenRuntimeManifestPath = `${runtimeManifestPath}.e2e-hidden-${process.pid}`;
    let hidden = false;

    return {
        hide() {
            if (!statSync(runtimeManifestPath).isFile()) {
                throw new Error(
                    `Packaged runtime manifest is not a regular file: ${runtimeManifestPath}`
                );
            }
            if (existsSync(hiddenRuntimeManifestPath)) {
                throw new Error(
                    `Stale hidden runtime manifest exists: ${hiddenRuntimeManifestPath}`
                );
            }
            renameSync(runtimeManifestPath, hiddenRuntimeManifestPath);
            hidden = true;
        },
        restore() {
            if (!hidden) {
                return;
            }
            if (!existsSync(hiddenRuntimeManifestPath)) {
                throw new Error(
                    `Hidden runtime manifest disappeared before restore: ${hiddenRuntimeManifestPath}`
                );
            }
            if (existsSync(runtimeManifestPath)) {
                throw new Error(
                    `Refusing to overwrite runtime manifest during restore: ${runtimeManifestPath}`
                );
            }
            renameSync(hiddenRuntimeManifestPath, runtimeManifestPath);
            hidden = false;
        },
    };
}

export function readPackagedRuntimeIdentity(
    nativeDir: string
): PackagedRuntimeIdentity {
    const runtimeManifestPath = join(nativeDir, 'embedded-mpv-runtime.json');
    const parsed = JSON.parse(
        readFileSync(runtimeManifestPath, 'utf8')
    ) as Partial<PackagedRuntimeIdentity>;

    for (const field of [
        'arch',
        'platform',
        'profile',
        'runtimeMode',
    ] as const) {
        if (typeof parsed[field] !== 'string' || !parsed[field]) {
            throw new Error(
                `Packaged runtime manifest ${field} is invalid at ${runtimeManifestPath}.`
            );
        }
    }

    return parsed as PackagedRuntimeIdentity;
}

export function assertNativeFallbackPrerequisites(): void {
    if (!process.env['DISPLAY']) {
        throw new Error(
            'The packaged native-view fallback smoke requires DISPLAY (run it under Xvfb/X11).'
        );
    }

    const mpv = spawnSync('mpv', ['--version'], {
        stdio: 'ignore',
        timeout: 3000,
    });
    if (mpv.status !== 0) {
        throw new Error(
            'The packaged native-view fallback smoke requires a working system mpv CLI on PATH.'
        );
    }
}

export async function installFrameCanvasAndSessionCapture(
    app: LaunchedElectronApp
): Promise<void> {
    await app.mainWindow.evaluate(() => {
        window.__packagedEmbeddedMpvUnsubscribe?.();
        window.__packagedEmbeddedMpvSessions = [];
        window.__packagedEmbeddedMpvUnsubscribe =
            window.electron.onEmbeddedMpvSessionUpdate?.((session) => {
                window.__packagedEmbeddedMpvSessions?.push(session);
            });

        document.querySelector('canvas[data-embedded-mpv-frame]')?.remove();
        const canvas = document.createElement('canvas');
        canvas.dataset['embeddedMpvFrame'] = '';
        canvas.dataset['testId'] = 'packaged-embedded-mpv-frame';
        Object.assign(canvas.style, {
            background: '#000',
            height: '180px',
            left: '0',
            position: 'fixed',
            top: '0',
            width: '320px',
            zIndex: '2147483647',
        });
        document.body.append(canvas);
    });
}

export async function getEmbeddedMpvSupport(
    app: LaunchedElectronApp
): Promise<EmbeddedMpvSupport> {
    return app.mainWindow.evaluate(async () => {
        return window.electron.getEmbeddedMpvSupport();
    });
}

export async function getLatestSession(
    app: LaunchedElectronApp,
    sessionId: string
): Promise<EmbeddedMpvSession | null> {
    return app.mainWindow.evaluate((id) => {
        const sessions =
            window.__packagedEmbeddedMpvSessions?.filter(
                (session) => session.id === id
            ) ?? [];
        return sessions.at(-1) ?? null;
    }, sessionId);
}

export async function renderedFrameSignal(
    app: LaunchedElectronApp
): Promise<number> {
    const canvas = app.mainWindow.getByTestId('packaged-embedded-mpv-frame');
    const png = await canvas.screenshot();
    const { data, info } = await sharp(png)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    let signal = 0;

    for (let offset = 0; offset < data.length; offset += info.channels) {
        if (data[offset] + data[offset + 1] + data[offset + 2] > 30) {
            signal += 1;
        }
    }

    return signal;
}

export async function closeAndWaitForExit(
    app: LaunchedElectronApp
): Promise<void> {
    const processHandle = app.electronApp.process();
    await closeElectronApp(app);
    await expect
        .poll(
            () =>
                processHandle.exitCode !== null ||
                processHandle.signalCode !== null,
            { timeout: 10000 }
        )
        .toBe(true);
}

export async function cleanupPackagedFrameCopySmoke(options: {
    apps: Array<LaunchedElectronApp | undefined>;
    media: LocalMediaServer;
    runtimeManifest: RuntimeManifestGuard;
}): Promise<void> {
    const errors: unknown[] = [];

    for (const app of options.apps) {
        if (!app) {
            continue;
        }
        try {
            await closeAndWaitForExit(app);
        } catch (error) {
            errors.push(error);
        }
    }

    try {
        options.runtimeManifest.restore();
    } catch (error) {
        errors.push(error);
    }

    try {
        await options.media.close();
    } catch (error) {
        errors.push(error);
    }

    if (errors.length > 0) {
        throw new Error(
            `Packaged frame-copy smoke cleanup failed: ${errors
                .map((error) =>
                    error instanceof Error ? error.message : String(error)
                )
                .join('; ')}`
        );
    }
}

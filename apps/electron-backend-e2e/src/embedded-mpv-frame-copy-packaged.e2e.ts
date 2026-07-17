import {
    expect,
    launchPackagedElectronApp,
    resolvePackagedLinuxExecutable,
    test,
    type LaunchedElectronApp,
} from './electron-test-fixtures';
import {
    assertNativeFallbackPrerequisites,
    cleanupPackagedFrameCopySmoke,
    closeAndWaitForExit,
    createLocalMediaServer,
    getEmbeddedMpvSupport,
    getLatestSession,
    installEmbeddedMpvSessionCapture,
    installFrameCanvasAndSessionCapture,
    isMeaningfulNativePlaybackSnapshot,
    renderedFrameSignal,
    type LocalMediaServer,
} from './embedded-mpv-frame-copy-packaged-fixtures';
import {
    createDisposablePackagedLinuxApp,
    createRuntimeManifestGuard,
    readPackagedRuntimeIdentity,
    type DisposablePackagedLinuxApp,
    type RuntimeManifestGuard,
} from './embedded-mpv-frame-copy-packaged-filesystem';

const PACKAGED_FRAME_COPY_REQUIRED_ENV =
    'IPTVNATOR_E2E_REQUIRE_PACKAGED_FRAME_COPY';
const FRAME_COPY_OPT_IN_ENV = 'IPTVNATOR_ENABLE_EMBEDDED_MPV_FRAME_COPY';
const packagedExecutable = resolvePackagedLinuxExecutable();
const packagedFrameCopyRequired = isTruthy(
    process.env[PACKAGED_FRAME_COPY_REQUIRED_ENV]
);

function isTruthy(value: string | undefined): boolean {
    return ['1', 'true', 'yes', 'on'].includes(
        (value ?? '').trim().toLowerCase()
    );
}

// This smoke drives the public preload API directly so it exercises the real
// packaged main process, helper, frame reader, WebGL pump, and pause controls
// without coupling runtime validation to playlist import/settings UI state.
test.describe('Packaged Linux embedded MPV frame-copy runtime', () => {
    test.skip(
        process.platform !== 'linux',
        'The packaged frame-copy runtime is Linux-only.'
    );
    test.skip(
        !packagedExecutable && !packagedFrameCopyRequired,
        `Set IPTVNATOR_E2E_PACKAGED_EXECUTABLE or ${PACKAGED_FRAME_COPY_REQUIRED_ENV}=1 in the dedicated packaged-runtime job.`
    );

    test('@critical @electron @embedded-mpv uses packaged frame-copy and fails closed to native-view', async ({
        dataDir,
    }) => {
        expect(
            process.arch,
            'The official Linux frame-copy runtime is x64-only.'
        ).toBe('x64');
        expect(
            packagedExecutable,
            `The dedicated packaged-runtime job must provide a real unpacked x64 executable with IPTVNATOR_E2E_PACKAGED_EXECUTABLE when ${PACKAGED_FRAME_COPY_REQUIRED_ENV}=1.`
        ).toBeTruthy();

        const sourceExecutablePath = packagedExecutable as string;
        assertNativeFallbackPrerequisites();
        let packageClone: DisposablePackagedLinuxApp | undefined;
        let runtimeManifest: RuntimeManifestGuard | undefined;
        let media: LocalMediaServer | undefined;
        let frameCopyApp: LaunchedElectronApp | undefined;
        let fallbackApp: LaunchedElectronApp | undefined;

        try {
            packageClone =
                createDisposablePackagedLinuxApp(sourceExecutablePath);
            const executablePath = packageClone.executablePath;
            const nativeDir = packageClone.nativeDir;
            const runtimeIdentity = readPackagedRuntimeIdentity(nativeDir);
            runtimeManifest = createRuntimeManifestGuard(nativeDir);
            const mediaServer = await createLocalMediaServer();
            media = mediaServer;

            expect(runtimeIdentity).toMatchObject({
                arch: 'x64',
                platform: 'linux',
                runtimeMode: 'bundled',
            });
            expect(['portable', 'flatpak']).toContain(runtimeIdentity.profile);

            const launchedFrameCopyApp = await launchPackagedElectronApp(
                executablePath,
                dataDir,
                {
                    env: {
                        [FRAME_COPY_OPT_IN_ENV]: '1',
                    },
                }
            );
            frameCopyApp = launchedFrameCopyApp;

            await expect
                .poll(() => getEmbeddedMpvSupport(launchedFrameCopyApp))
                .toMatchObject({
                    engine: 'frame-copy',
                    frameCopyAvailable: true,
                    platform: 'linux',
                    supported: true,
                });

            await installFrameCanvasAndSessionCapture(launchedFrameCopyApp);
            const created = await launchedFrameCopyApp.mainWindow.evaluate(
                async () => {
                    return window.electron.createEmbeddedMpvSession(
                        { x: 0, y: 0, width: 320, height: 180 },
                        'Packaged frame-copy smoke',
                        0
                    );
                }
            );

            await launchedFrameCopyApp.mainWindow.evaluate(
                async ({ sessionId, streamUrl }) => {
                    await window.electron.setEmbeddedMpvPaused(sessionId, true);
                    await window.electron.loadEmbeddedMpvPlayback(sessionId, {
                        streamUrl,
                        title: 'Two-second generated Y4M fixture',
                        isLive: false,
                    });
                },
                { sessionId: created.id, streamUrl: mediaServer.url }
            );

            await expect
                .poll(
                    () => getLatestSession(launchedFrameCopyApp, created.id),
                    {
                        timeout: 15000,
                    }
                )
                .toMatchObject({
                    status: 'paused',
                    streamUrl: mediaServer.url,
                    videoHeight: 36,
                    videoWidth: 64,
                });

            const attached = await launchedFrameCopyApp.mainWindow.evaluate(
                async (sessionId) => {
                    return window.electron.attachEmbeddedMpvFrameView?.(
                        sessionId
                    );
                },
                created.id
            );
            expect(attached).toBe(true);
            await expect(
                launchedFrameCopyApp.mainWindow.getByTestId(
                    'packaged-embedded-mpv-frame'
                )
            ).toHaveAttribute('width', '320');
            await expect(
                launchedFrameCopyApp.mainWindow.getByTestId(
                    'packaged-embedded-mpv-frame'
                )
            ).toHaveAttribute('height', '180');
            await expect
                .poll(() => renderedFrameSignal(launchedFrameCopyApp), {
                    timeout: 15000,
                })
                .toBeGreaterThan(0);

            await launchedFrameCopyApp.mainWindow.evaluate(
                (sessionId) =>
                    window.electron.setEmbeddedMpvPaused(sessionId, false),
                created.id
            );
            await expect
                .poll(
                    async () =>
                        (
                            await getLatestSession(
                                launchedFrameCopyApp,
                                created.id
                            )
                        )?.status,
                    { timeout: 10000 }
                )
                .toBe('playing');

            await launchedFrameCopyApp.mainWindow.evaluate(
                (sessionId) =>
                    window.electron.setEmbeddedMpvPaused(sessionId, true),
                created.id
            );
            await expect
                .poll(
                    async () =>
                        (
                            await getLatestSession(
                                launchedFrameCopyApp,
                                created.id
                            )
                        )?.status,
                    { timeout: 10000 }
                )
                .toBe('paused');
            await launchedFrameCopyApp.mainWindow.evaluate(
                async (sessionId) => {
                    window.electron.detachEmbeddedMpvFrameView?.();
                    await window.electron.disposeEmbeddedMpvSession(sessionId);
                    window.__packagedEmbeddedMpvUnsubscribe?.();
                },
                created.id
            );

            await closeAndWaitForExit(launchedFrameCopyApp);
            frameCopyApp = undefined;

            runtimeManifest.hide();

            const launchedFallbackApp = await launchPackagedElectronApp(
                executablePath,
                dataDir,
                {
                    env: {
                        [FRAME_COPY_OPT_IN_ENV]: '1',
                    },
                }
            );
            fallbackApp = launchedFallbackApp;
            const fallbackSupport =
                await getEmbeddedMpvSupport(launchedFallbackApp);

            expect(fallbackSupport).toMatchObject({
                engine: 'native',
                frameCopyAvailable: false,
                frameCopyUnavailableReason: 'runtime-manifest-missing',
                platform: 'linux',
                supported: true,
            });

            await installEmbeddedMpvSessionCapture(launchedFallbackApp);
            const nativeSession = await launchedFallbackApp.mainWindow.evaluate(
                async () => {
                    return window.electron.createEmbeddedMpvSession(
                        { x: 0, y: 0, width: 320, height: 180 },
                        'Native-view fallback smoke',
                        0
                    );
                }
            );
            expect(nativeSession.id).toMatch(/^embedded-mpv-/);
            await launchedFallbackApp.mainWindow.evaluate(
                async ({ sessionId, streamUrl }) => {
                    await window.electron.loadEmbeddedMpvPlayback(sessionId, {
                        streamUrl,
                        title: 'Native-view generated Y4M fixture',
                        isLive: false,
                    });
                },
                { sessionId: nativeSession.id, streamUrl: mediaServer.url }
            );
            await expect
                .poll(
                    async () =>
                        isMeaningfulNativePlaybackSnapshot(
                            await getLatestSession(
                                launchedFallbackApp,
                                nativeSession.id
                            ),
                            mediaServer.url
                        ),
                    { timeout: 15000 }
                )
                .toBe(true);
            expect(
                launchedFallbackApp.electronApp.process().exitCode
            ).toBeNull();
            expect(
                launchedFallbackApp.electronApp.process().signalCode
            ).toBeNull();
            await launchedFallbackApp.mainWindow.evaluate(async (sessionId) => {
                await window.electron.disposeEmbeddedMpvSession(sessionId);
                window.__packagedEmbeddedMpvUnsubscribe?.();
            }, nativeSession.id);
            await expect
                .poll(() => launchedFallbackApp.mainWindow.title())
                .toContain('IPTVnator');
        } finally {
            await cleanupPackagedFrameCopySmoke({
                apps: [frameCopyApp, fallbackApp],
                media,
                packageClone,
                runtimeManifest,
            });
        }
    });
});

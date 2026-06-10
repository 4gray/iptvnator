import { readFileSync } from 'fs';
import path from 'path';

describe('Embedded MPV native source recording invariants', () => {
    const nativeSource = readFileSync(
        path.resolve(__dirname, '../../../native/src/embedded_mpv.mm'),
        'utf8'
    );
    const widCommonSource = readFileSync(
        path.resolve(
            __dirname,
            '../../../native/src/embedded_mpv_wid_common.h'
        ),
        'utf8'
    );
    const win32Source = readFileSync(
        path.resolve(__dirname, '../../../native/src/embedded_mpv_win32.cc'),
        'utf8'
    );
    const linuxSource = readFileSync(
        path.resolve(__dirname, '../../../native/src/embedded_mpv_linux.cc'),
        'utf8'
    );
    const buildScriptSource = readFileSync(
        path.resolve(__dirname, '../../../build-embedded-mpv.js'),
        'utf8'
    );
    const buildAndMakeWorkflowSource = readFileSync(
        path.resolve(
            __dirname,
            '../../../../../.github/workflows/build-and-make.yaml'
        ),
        'utf8'
    );

    function functionBody(name: string): string {
        const start = nativeSource.indexOf(`Napi::Value ${name}(`);
        expect(start).toBeGreaterThanOrEqual(0);

        const bodyStart = nativeSource.indexOf('{', start);
        expect(bodyStart).toBeGreaterThanOrEqual(0);

        let depth = 0;
        for (let index = bodyStart; index < nativeSource.length; index += 1) {
            if (nativeSource[index] === '{') {
                depth += 1;
            }
            if (nativeSource[index] === '}') {
                depth -= 1;
            }
            if (depth === 0) {
                return nativeSource.slice(bodyStart, index + 1);
            }
        }

        throw new Error(`Unable to read ${name} body.`);
    }

    it('tracks LoadPlayback recording auto-stop replies through the reconciler', () => {
        const body = functionBody('LoadPlayback');

        expect(body).toContain(
            'const uint64_t stopRecordingRequestId = nextAsyncRequestId();'
        );
        expect(body).toContain(
            'session->pendingRecordingStopRequestId = stopRecordingRequestId;'
        );
        expect(body).toContain(
            'session->pendingRecordingStopStartedAt =\n' +
                '                session->snapshot.recordingStartedAt;'
        );
        expect(body).toContain('stopRecordingRequestId,');
    });

    it('maps successful MPV end-file events to an ended session status', () => {
        expect(nativeSource).toContain('Ended,');
        expect(nativeSource).toContain('case SessionStatus::Ended:');

        const eventLoopBodyStart = nativeSource.indexOf('void runEventLoop(');
        expect(eventLoopBodyStart).toBeGreaterThanOrEqual(0);
        const endFileCaseStart = nativeSource.indexOf(
            'case MPV_EVENT_END_FILE',
            eventLoopBodyStart
        );
        expect(endFileCaseStart).toBeGreaterThanOrEqual(0);
        const nextCaseStart = nativeSource.indexOf(
            'case MPV_EVENT_PROPERTY_CHANGE',
            endFileCaseStart
        );
        expect(nextCaseStart).toBeGreaterThan(endFileCaseStart);

        const endFileCase = nativeSource.slice(endFileCaseStart, nextCaseStart);
        expect(endFileCase).toContain('SessionStatus::Ended');
        expect(endFileCase).toContain('MPV_END_FILE_REASON_EOF');
    });

    it('keeps Windows/Linux non-load async MPV command failures non-fatal', () => {
        expect(widCommonSource).toContain('pendingPlaybackLoadRequestId');
        expect(widCommonSource).toContain('reconcilePlaybackLoadReply');
        expect(widCommonSource).toContain(
            'session->snapshot.error = mpv_error_string(event->error);'
        );
        expect(widCommonSource).not.toContain(
            'if (event->error < 0) {\n' +
                '                    session->snapshot.status = SessionStatus::Error;'
        );
    });

    it('clears transient Windows/Linux MPV operation errors after healthy playback states', () => {
        const fileLoadedCaseStart = widCommonSource.indexOf(
            'case MPV_EVENT_FILE_LOADED:'
        );
        expect(fileLoadedCaseStart).toBeGreaterThanOrEqual(0);
        const endFileCaseStart = widCommonSource.indexOf(
            'case MPV_EVENT_END_FILE:',
            fileLoadedCaseStart
        );
        expect(endFileCaseStart).toBeGreaterThan(fileLoadedCaseStart);
        const fileLoadedCase = widCommonSource.slice(
            fileLoadedCaseStart,
            endFileCaseStart
        );

        expect(fileLoadedCase).toContain('session->snapshot.error.clear();');

        const pausePropertyStart = widCommonSource.indexOf(
            'const bool paused = *static_cast<int*>(property->data) != 0;'
        );
        expect(pausePropertyStart).toBeGreaterThanOrEqual(0);
        const volumePropertyStart = widCommonSource.indexOf(
            '} else if (name == "volume"',
            pausePropertyStart
        );
        expect(volumePropertyStart).toBeGreaterThan(pausePropertyStart);
        const pausePropertyBranch = widCommonSource.slice(
            pausePropertyStart,
            volumePropertyStart
        );

        expect(pausePropertyBranch).toContain(
            'session->snapshot.error.clear();'
        );
    });

    it('copies Windows runtime DLLs next to the addon for Windows loader lookup', () => {
        expect(buildScriptSource).toContain(
            "for (const windowsDllName of ['mpv-2.dll', 'mpv.dll'])"
        );
        expect(buildScriptSource).toContain(
            'path.join(outputDir, windowsDllName)'
        );
        expect(buildScriptSource).toContain("fileName.endsWith('.dll')");
        expect(buildScriptSource).toContain('path.join(outputDir, fileName)');
    });

    it('checks Win32 window class registration failures explicitly', () => {
        expect(win32Source).toContain(
            'const ATOM classAtom = RegisterClassExW'
        );
        expect(win32Source).toContain('ERROR_CLASS_ALREADY_EXISTS');
        expect(win32Source).toContain(
            'Failed to register embedded MPV child window class.'
        );
    });

    it('drains Linux X11 events after resizing the embedded window', () => {
        expect(linuxSource).toContain('void drainEvents()');
        expect(linuxSource).toContain('XPending(display_)');
        expect(linuxSource).toContain('XNextEvent(display_, &event)');
        expect(linuxSource).toContain('drainEvents();');
    });

    it('keeps Linux mpv child processes isolated from Wayland and inherited Electron descriptors', () => {
        expect(widCommonSource).toContain(
            'if (hasEnvPrefix(entry, "WAYLAND_DISPLAY="))'
        );
        expect(widCommonSource).toContain(
            'environment.push_back("XDG_SESSION_TYPE=x11");'
        );
        expect(widCommonSource).toContain(
            'arguments.push_back("--vo=gpu,x11");'
        );
        expect(widCommonSource).toContain(
            'arguments.push_back("--gpu-context=x11egl");'
        );
        expect(widCommonSource).toContain('closeInheritedFileDescriptors();');
        expect(widCommonSource).toContain('flags | FD_CLOEXEC');
    });

    it('drives Linux out-of-process MPV state and controls over JSON IPC', () => {
        expect(widCommonSource).toContain('mpvIpcSocketPath');
        expect(widCommonSource).toContain(
            'arguments.push_back("--input-ipc-server=" + ipcSocketPath);'
        );
        expect(widCommonSource).toContain('refreshLinuxMpvSnapshot(session);');
        expect(widCommonSource).toContain(
            'queryLinuxMpvNumber(socketPath, "time-pos")'
        );
        expect(widCommonSource).toContain(
            'queryLinuxMpvNumber(socketPath, "duration")'
        );
        expect(widCommonSource).toContain(
            'std::string("{\\"command\\":[\\"set_property\\",\\"pause\\",")'
        );
        expect(widCommonSource).toContain(
            '"{\\"command\\":[\\"seek\\"," + seconds + ",\\"absolute\\"]}\\n"'
        );
    });

    it('keeps dynamic libmpv symbol declarations compatible with distro headers', () => {
        expect(widCommonSource).toContain(
            '#if defined(IPTVNATOR_DYNAMIC_LIBMPV) && !defined(mpv_command_async)'
        );
        expect(widCommonSource).toContain(
            'IPTVNATOR_DECLARE_MPV_DYNAMIC_SYMBOL(mpv_command_async)'
        );
        expect(widCommonSource).toContain(
            '#define mpv_command_async pfn_mpv_command_async'
        );
        expect(buildScriptSource).toContain('cleanNativeBuildIntermediates();');
    });

    it('uses platform-specific embedded MPV runtime cache key inputs in CI', () => {
        expect(buildAndMakeWorkflowSource).toContain(
            "const targetPlatform = '${{ matrix.embedded_mpv_platform }}';"
        );
        expect(buildAndMakeWorkflowSource).toContain(
            "if (targetPlatform === 'darwin')"
        );
        expect(buildAndMakeWorkflowSource).toContain(
            "'tools/embedded-mpv/build-macos-runtime.mjs'"
        );
        expect(buildAndMakeWorkflowSource).toContain(
            "'tools/embedded-mpv/stage-runtime.mjs'"
        );
        expect(buildAndMakeWorkflowSource).not.toContain(
            '`macos${safeDeploymentTarget}`,\n' +
                '                    `xcode${xcodeHash}`,'
        );
    });

    it('requires Linux embedded MPV build inputs and validates process isolation in CI', () => {
        expect(buildAndMakeWorkflowSource).toContain(
            'libmpv-dev mpv pkg-config'
        );
        expect(buildAndMakeWorkflowSource).toContain(
            'Stage Linux embedded MPV build inputs'
        );
        expect(buildAndMakeWorkflowSource).toContain(
            "linuxBackend: 'process-isolated mpv --wid'"
        );
        expect(buildAndMakeWorkflowSource).toContain("matrix.os == 'linux'");
        expect(buildAndMakeWorkflowSource).toContain(
            'Linux embedded MPV addon must not link directly to libmpv'
        );
        expect(buildScriptSource).toContain("origin: 'external-mpv-process'");
        expect(buildScriptSource).toContain('writeLinuxProcessRuntimeManifest');
        expect(buildScriptSource).toContain('runtimeFiles: []');
    });
});

describe('Embedded MPV native build configuration', () => {
    const bindingGyp = JSON.parse(
        readFileSync(
            path.resolve(__dirname, '../../../native/binding.gyp'),
            'utf8'
        )
    );
    const target = bindingGyp.targets.find(
        (candidate: { target_name?: string }) =>
            candidate.target_name === 'embedded_mpv'
    );

    it('declares platform-specific native sources for macOS, Windows, and Linux', () => {
        expect(target).toBeDefined();
        expect(JSON.stringify(target)).toContain('src/embedded_mpv.mm');
        expect(JSON.stringify(target)).toContain('src/embedded_mpv_win32.cc');
        expect(JSON.stringify(target)).toContain('src/embedded_mpv_linux.cc');
    });
});

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
    const stageRuntimeSource = readFileSync(
        path.resolve(
            __dirname,
            '../../../../../tools/embedded-mpv/stage-runtime.mjs'
        ),
        'utf8'
    );

    function functionBody(name: string): string {
        return sourceFunctionBody(nativeSource, `Napi::Value ${name}(`, name);
    }

    function sourceFunctionBody(
        source: string,
        signature: string,
        name: string
    ): string {
        const start = source.indexOf(signature);
        expect(start).toBeGreaterThanOrEqual(0);

        const bodyStart = source.indexOf('{', start);
        expect(bodyStart).toBeGreaterThanOrEqual(0);

        let depth = 0;
        for (let index = bodyStart; index < source.length; index += 1) {
            if (source[index] === '{') {
                depth += 1;
            }
            if (source[index] === '}') {
                depth -= 1;
            }
            if (depth === 0) {
                return source.slice(bodyStart, index + 1);
            }
        }

        throw new Error(`Unable to read ${name} body.`);
    }

    function eventCase(
        source: string,
        eventName: string,
        nextEventName: string
    ): string {
        const eventLoopBodyStart = source.indexOf('void runEventLoop(');
        expect(eventLoopBodyStart).toBeGreaterThanOrEqual(0);
        const eventCaseStart = source.indexOf(
            `case ${eventName}`,
            eventLoopBodyStart
        );
        expect(eventCaseStart).toBeGreaterThanOrEqual(0);
        const nextCaseStart = source.indexOf(
            `case ${nextEventName}`,
            eventCaseStart
        );
        expect(nextCaseStart).toBeGreaterThan(eventCaseStart);

        return source.slice(eventCaseStart, nextCaseStart);
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
        expect(widCommonSource).toContain('Ended,');
        expect(widCommonSource).toContain('case SessionStatus::Ended:');

        const endFileCase = eventCase(
            nativeSource,
            'MPV_EVENT_END_FILE',
            'MPV_EVENT_PROPERTY_CHANGE'
        );
        expect(endFileCase).toContain('SessionStatus::Ended');
        expect(endFileCase).toContain('MPV_END_FILE_REASON_EOF');

        const widEndFileCase = eventCase(
            widCommonSource,
            'MPV_EVENT_END_FILE',
            'MPV_EVENT_PROPERTY_CHANGE'
        );
        expect(widEndFileCase).toContain('SessionStatus::Ended');
        expect(widEndFileCase).toContain('MPV_END_FILE_REASON_EOF');
    });

    it('keeps MPV redirect end-file events in loading state', () => {
        for (const endFileCase of [
            eventCase(
                nativeSource,
                'MPV_EVENT_END_FILE',
                'MPV_EVENT_PROPERTY_CHANGE'
            ),
            eventCase(
                widCommonSource,
                'MPV_EVENT_END_FILE',
                'MPV_EVENT_PROPERTY_CHANGE'
            ),
        ]) {
            const redirectBranchStart = endFileCase.indexOf(
                'MPV_END_FILE_REASON_REDIRECT'
            );
            expect(redirectBranchStart).toBeGreaterThanOrEqual(0);
            const idleFallbackStart = endFileCase.indexOf(
                'SessionStatus::Idle',
                redirectBranchStart
            );
            expect(idleFallbackStart).toBeGreaterThan(redirectBranchStart);

            const redirectBranch = endFileCase.slice(
                redirectBranchStart,
                idleFallbackStart
            );
            expect(redirectBranch).toContain('SessionStatus::Loading');
            expect(redirectBranch).toContain(
                'session->snapshot.error.clear();'
            );
        }
    });

    it('maps keep-open eof-reached property changes to an ended session status', () => {
        expect(nativeSource).toContain(
            'mpv_observe_property(session->handle, 11, "eof-reached", MPV_FORMAT_FLAG);'
        );
        expect(widCommonSource).toContain(
            'mpv_observe_property(session->handle, 11, "eof-reached", MPV_FORMAT_FLAG);'
        );

        const nativeEofBranchStart = nativeSource.indexOf(
            'propertyName == "eof-reached"'
        );
        expect(nativeEofBranchStart).toBeGreaterThanOrEqual(0);
        const nativeVolumeBranchStart = nativeSource.indexOf(
            'propertyName == "volume"',
            nativeEofBranchStart
        );
        expect(nativeVolumeBranchStart).toBeGreaterThan(nativeEofBranchStart);
        const nativeEofBranch = nativeSource.slice(
            nativeEofBranchStart,
            nativeVolumeBranchStart
        );
        expect(nativeEofBranch).toContain('SessionStatus::Ended');
        expect(nativeEofBranch).toContain('session->loadedPath');

        const widEofBranchStart = widCommonSource.indexOf(
            'name == "eof-reached"'
        );
        expect(widEofBranchStart).toBeGreaterThanOrEqual(0);
        const widVolumeBranchStart = widCommonSource.indexOf(
            'name == "volume"',
            widEofBranchStart
        );
        expect(widVolumeBranchStart).toBeGreaterThan(widEofBranchStart);
        const widEofBranch = widCommonSource.slice(
            widEofBranchStart,
            widVolumeBranchStart
        );
        expect(widEofBranch).toContain('SessionStatus::Ended');
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

    it('defers Linux X11 create failure cleanup until after the error trap scope closes', () => {
        const trapStart = linuxSource.indexOf(
            'ScopedX11ErrorTrap x11Errors(display_);'
        );
        expect(trapStart).toBeGreaterThanOrEqual(0);
        const deferredCleanupStart = linuxSource.indexOf(
            'if (createWindowFailed) {',
            trapStart
        );
        expect(deferredCleanupStart).toBeGreaterThan(trapStart);

        const trappedCreateBlock = linuxSource.slice(
            trapStart,
            deferredCleanupStart
        );
        const nextWindowGuardStart = linuxSource.indexOf(
            'if (!window_) {',
            deferredCleanupStart
        );
        expect(nextWindowGuardStart).toBeGreaterThan(deferredCleanupStart);
        const deferredCleanupBlock = linuxSource.slice(
            deferredCleanupStart,
            nextWindowGuardStart
        );

        expect(trappedCreateBlock).toContain('createWindowFailed = true;');
        expect(trappedCreateBlock).not.toContain('destroy();');
        expect(deferredCleanupBlock).toContain('destroy();');
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
        expect(widCommonSource).toContain(
            'void closeInheritedFileDescriptors()'
        );
        expect(widCommonSource).toContain('opendir("/proc/self/fd")');
        expect(widCommonSource).toContain('readdir(directory)');
        expect(widCommonSource).toContain(
            'fcntl(descriptor, F_SETFD, flags | FD_CLOEXEC)'
        );
        expect(widCommonSource).toContain('closeInheritedFileDescriptors();');
        expect(widCommonSource).not.toContain('inheritedFileDescriptorLimit()');
        expect(widCommonSource).not.toContain(
            'closeInheritedFileDescriptors(fileDescriptorLimit);'
        );
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

    it('keeps Linux MPV IPC volume readback in mpv percent units', () => {
        const refreshBody = sourceFunctionBody(
            widCommonSource,
            'void refreshLinuxMpvSnapshot(',
            'refreshLinuxMpvSnapshot'
        );
        expect(refreshBody).toContain(
            'queryLinuxMpvNumber(socketPath, "volume")'
        );
        expect(refreshBody).toContain(
            'session->snapshot.volumePercent =\n' +
                '            std::max(0.0, std::min(100.0, *volume));'
        );
        expect(refreshBody).not.toContain('clampVolumePercent(*volume)');
    });

    it('only marks open file descriptors close-on-exec before Linux MPV exec', () => {
        const closeDescriptorsBody = sourceFunctionBody(
            widCommonSource,
            'void closeInheritedFileDescriptors(',
            'closeInheritedFileDescriptors'
        );
        expect(closeDescriptorsBody).toContain('opendir("/proc/self/fd")');
        expect(closeDescriptorsBody).toContain('readdir(directory)');
        expect(closeDescriptorsBody).toContain('fcntl(descriptor, F_GETFD)');
        expect(closeDescriptorsBody).toContain(
            'fcntl(descriptor, F_SETFD, flags | FD_CLOEXEC)'
        );
        expect(widCommonSource).not.toContain('sysconf(_SC_OPEN_MAX)');
        expect(widCommonSource).not.toContain(
            'fileDescriptor < fileDescriptorLimit'
        );

        const spawnBody = sourceFunctionBody(
            widCommonSource,
            'pid_t spawnLinuxMpvProcess(',
            'spawnLinuxMpvProcess'
        );
        expect(spawnBody).toContain('closeInheritedFileDescriptors();');
        expect(spawnBody).not.toContain('inheritedFileDescriptorLimit()');
    });

    it('formats MPV floating-point values independently from the user locale', () => {
        const formatterBody = sourceFunctionBody(
            widCommonSource,
            'std::string formatInvariantDouble(',
            'formatInvariantDouble'
        );
        expect(formatterBody).toContain('std::to_chars(');
        expect(formatterBody).toContain('std::chars_format::general');
        expect(formatterBody).not.toContain('std::locale::classic()');
        expect(formatterBody).not.toContain('std::ostringstream');

        const linuxArgumentsBody = sourceFunctionBody(
            widCommonSource,
            'std::vector<std::string> buildLinuxMpvArguments(',
            'buildLinuxMpvArguments'
        );
        expect(linuxArgumentsBody).toContain(
            '"--volume=" +\n' +
                '                formatInvariantDouble(session->snapshot.volumePercent)'
        );
        expect(linuxArgumentsBody).toContain(
            'appendLinuxMpvOption(\n' +
                '            arguments,\n' +
                '            "start",\n' +
                '            formatInvariantDouble(startTime)\n' +
                '        );'
        );

        const seekBody = sourceFunctionBody(
            widCommonSource,
            'Napi::Value Seek(',
            'Seek'
        );
        expect(seekBody).toContain('formatInvariantDouble(');
        expect(seekBody).not.toContain('std::to_string(info[1]');

        const setVolumeBody = sourceFunctionBody(
            widCommonSource,
            'Napi::Value SetVolume(',
            'SetVolume'
        );
        expect(setVolumeBody).toContain('formatInvariantDouble(volume)');
        expect(setVolumeBody).not.toContain('std::to_string(volume)');
    });

    it('keeps Linux MPV snapshot IPC off the NAPI snapshot read path', () => {
        const getSnapshotBody = sourceFunctionBody(
            widCommonSource,
            'Napi::Value GetSessionSnapshot(',
            'GetSessionSnapshot'
        );
        expect(getSnapshotBody).not.toContain('refreshLinuxMpvSnapshot');
        expect(widCommonSource).toContain('void runLinuxProcessPollLoop');
        expect(widCommonSource).toContain('refreshLinuxMpvSnapshot(session);');
        expect(widCommonSource).toContain('startLinuxProcessPolling(session)');
        expect(widCommonSource).toContain(
            'session->eventThread = std::thread(runLinuxProcessPollLoop, session);'
        );
    });

    it('terminates Linux MPV processes away from the NAPI teardown path', () => {
        const destroyBody = sourceFunctionBody(
            widCommonSource,
            'void destroySession(',
            'destroySession'
        );
        expect(destroyBody).toContain(
            'terminateLinuxMpvProcessAsync(session);'
        );
        expect(destroyBody).toContain('session->eventThread.detach();');
        expect(destroyBody).not.toContain('std::this_thread::sleep_for');
        expect(destroyBody).not.toContain('SIGKILL');

        const asyncTerminationBody = sourceFunctionBody(
            widCommonSource,
            'void terminateLinuxMpvProcessAsync(',
            'terminateLinuxMpvProcessAsync'
        );
        expect(asyncTerminationBody).toContain(
            'kill(process.processId, SIGTERM);'
        );
        expect(asyncTerminationBody).toContain('std::thread(');
        expect(asyncTerminationBody).toContain('waitForLinuxMpvProcessExit');
    });

    it('uses generation-unique Linux MPV IPC socket paths', () => {
        expect(widCommonSource).toContain('gNextLinuxIpcSocketId');
        expect(widCommonSource).toContain(
            'std::to_string(gNextLinuxIpcSocketId.fetch_add(1))'
        );
    });

    it('keeps dynamic libmpv symbol declarations compatible with distro headers', () => {
        expect(widCommonSource).not.toContain('MPV_CPLUGIN_DYNAMIC_SYM');
        expect(widCommonSource).toContain('#ifdef IPTVNATOR_DYNAMIC_LIBMPV');
        expect(widCommonSource).toContain('#ifdef MPV_SELECTANY');
        expect(widCommonSource).toContain(
            '#define IPTVNATOR_MPV_SELECTANY MPV_SELECTANY'
        );
        expect(widCommonSource).toContain(
            'IPTVNATOR_MPV_SELECTANY decltype(&name) pfn_##name = nullptr;'
        );
        expect(widCommonSource).toContain(
            'IPTVNATOR_DECLARE_MPV_DYNAMIC_SYMBOL(mpv_command_async)'
        );
        expect(widCommonSource).toContain(
            '#define mpv_command_async pfn_mpv_command_async'
        );
        expect(widCommonSource).not.toContain('mpvLibraryCandidates');
        expect(widCommonSource).not.toContain('ensureMpvApiLoaded');
        expect(widCommonSource).not.toContain('"libmpv.so"');
        expect(buildScriptSource).toContain('cleanNativeBuildIntermediates();');
    });

    it('does not stage Linux libmpv runtime libraries', () => {
        expect(stageRuntimeSource).toContain(
            "if (platform !== 'linux') {\n" +
                '        copyDirectory(sourceLibDir, destinationLibDir, runtimeFileFilter);\n' +
                '    }'
        );
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

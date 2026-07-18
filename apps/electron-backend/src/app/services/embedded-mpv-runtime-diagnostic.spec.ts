const mockElectronApp = {
    isPackaged: true,
};

jest.mock('electron', () => ({ app: mockElectronApp }));

import {
    EMBEDDED_MPV_RUNTIME_PROBE_SWITCH,
    runEmbeddedMpvRuntimeDiagnosticOrContinue,
} from './embedded-mpv-runtime-diagnostic';
import type { FrameCopyRuntimeAvailability } from './embedded-mpv-frame-copy-platform.util';

interface DiagnosticHarness {
    continueStartup: jest.Mock<void, []>;
    exit: jest.Mock<void, [number]>;
    getRuntimeAvailability: jest.Mock<FrameCopyRuntimeAvailability, []>;
    writeStdout: jest.Mock<void, [string]>;
}

function createHarness(
    availability: FrameCopyRuntimeAvailability = {
        usable: false,
        reason: 'runtime-artifact-missing',
    }
): DiagnosticHarness {
    return {
        continueStartup: jest.fn(),
        exit: jest.fn(),
        getRuntimeAvailability: jest.fn(() => availability),
        writeStdout: jest.fn(),
    };
}

function runDiagnostic(
    argv: readonly string[],
    harness: DiagnosticHarness
): void {
    runEmbeddedMpvRuntimeDiagnosticOrContinue(argv, harness.continueStartup, {
        exit: harness.exit,
        getRuntimeAvailability: harness.getRuntimeAvailability,
        writeStdout: harness.writeStdout,
    });
}

describe('embedded MPV runtime diagnostic', () => {
    it.each([
        [['electron', 'main.js']],
        [['electron', 'main.js', `${EMBEDDED_MPV_RUNTIME_PROBE_SWITCH}=1`]],
        [['electron', 'main.js', 'embedded-mpv-runtime-probe']],
    ])('continues normal startup for argv %j', (argv) => {
        const harness = createHarness();

        runDiagnostic(argv, harness);

        expect(harness.continueStartup).toHaveBeenCalledTimes(1);
        expect(harness.getRuntimeAvailability).not.toHaveBeenCalled();
        expect(harness.writeStdout).not.toHaveBeenCalled();
        expect(harness.exit).not.toHaveBeenCalled();
    });

    it('prints the usable availability as one JSON line, exits zero, and skips startup', () => {
        const availability: FrameCopyRuntimeAvailability = {
            usable: true,
            profile: 'portable',
            runtimeMode: 'bundled',
            libmpv: '2.3',
            renderApi: 'egl',
        };
        const harness = createHarness(availability);

        runDiagnostic(
            ['electron', 'main.js', EMBEDDED_MPV_RUNTIME_PROBE_SWITCH],
            harness
        );

        expect(harness.getRuntimeAvailability).toHaveBeenCalledTimes(1);
        expect(harness.writeStdout).toHaveBeenCalledWith(
            `${JSON.stringify(availability)}\n`
        );
        expect(harness.writeStdout).toHaveBeenCalledTimes(1);
        expect(harness.exit).toHaveBeenCalledWith(0);
        expect(harness.exit).toHaveBeenCalledTimes(1);
        expect(harness.writeStdout.mock.invocationCallOrder[0]).toBeLessThan(
            harness.exit.mock.invocationCallOrder[0]
        );
        expect(harness.continueStartup).not.toHaveBeenCalled();
    });

    it('prints the unavailable helper reason as one JSON line, exits nonzero, and skips startup', () => {
        const availability: FrameCopyRuntimeAvailability = {
            usable: false,
            reason: 'helper-probe-failed',
            helperReason: 'gl-context-create-failed',
        };
        const harness = createHarness(availability);

        runDiagnostic(
            [EMBEDDED_MPV_RUNTIME_PROBE_SWITCH, 'electron', 'main.js'],
            harness
        );

        expect(harness.getRuntimeAvailability).toHaveBeenCalledTimes(1);
        expect(harness.writeStdout).toHaveBeenCalledWith(
            '{"usable":false,"reason":"helper-probe-failed","helperReason":"gl-context-create-failed"}\n'
        );
        expect(harness.writeStdout).toHaveBeenCalledTimes(1);
        expect(harness.exit).toHaveBeenCalledWith(1);
        expect(harness.exit).toHaveBeenCalledTimes(1);
        expect(harness.continueStartup).not.toHaveBeenCalled();
    });
});

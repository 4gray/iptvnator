import { writeSync } from 'fs';
import {
    getFrameCopyRuntimeAvailability,
    type FrameCopyRuntimeAvailability,
} from './embedded-mpv-frame-copy-platform.util';

export const EMBEDDED_MPV_RUNTIME_PROBE_SWITCH = '--embedded-mpv-runtime-probe';

interface EmbeddedMpvRuntimeDiagnosticDependencies {
    exit(code: number): void;
    getRuntimeAvailability(): FrameCopyRuntimeAvailability;
    writeStdout(output: string): void;
}

const defaultDependencies: EmbeddedMpvRuntimeDiagnosticDependencies = {
    exit: (code) => process.exit(code),
    getRuntimeAvailability: getFrameCopyRuntimeAvailability,
    writeStdout: (output) => {
        writeSync(process.stdout.fd, output);
    },
};

export function runEmbeddedMpvRuntimeDiagnosticOrContinue(
    argv: readonly string[],
    continueStartup: () => void,
    dependencies: EmbeddedMpvRuntimeDiagnosticDependencies = defaultDependencies
): void {
    if (!argv.includes(EMBEDDED_MPV_RUNTIME_PROBE_SWITCH)) {
        continueStartup();
        return;
    }

    const availability = dependencies.getRuntimeAvailability();
    dependencies.writeStdout(`${JSON.stringify(availability)}\n`);
    dependencies.exit(availability.usable ? 0 : 1);
}

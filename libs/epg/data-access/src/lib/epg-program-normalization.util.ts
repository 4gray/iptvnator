import { EpgProgram } from 'shared-interfaces';

function toIsoDate(value: string | undefined): string | null {
    if (!value) {
        return null;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date.toISOString();
}

/**
 * Drop malformed EPG rows instead of failing the whole channel request.
 */
export function normalizeEpgPrograms(programs: EpgProgram[]): EpgProgram[] {
    const normalizedPrograms: EpgProgram[] = [];

    for (const program of programs) {
        const start = toIsoDate(program.start);
        const stop = toIsoDate(program.stop);

        if (!start || !stop) {
            continue;
        }

        normalizedPrograms.push({
            ...program,
            start,
            stop,
        });
    }

    return normalizedPrograms;
}

import type { RecordingProgramSnapshot } from '@iptvnator/shared/interfaces';

// A recording rarely spans more than a handful of programs; the cap is a
// hostile-input bound, not a product limit.
const MAX_PROGRAMS = 64;
const MAX_TITLE_LENGTH = 512;
const MAX_DESCRIPTION_LENGTH = 4_096;
const MAX_TIME_LENGTH = 64;

function sanitizeProgram(value: unknown): RecordingProgramSnapshot | null {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const raw = value as Record<string, unknown>;
    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    const start = typeof raw.start === 'string' ? raw.start.trim() : '';
    const stop = typeof raw.stop === 'string' ? raw.stop.trim() : '';
    if (!title || !start || !stop) {
        return null;
    }
    if (start.length > MAX_TIME_LENGTH || stop.length > MAX_TIME_LENGTH) {
        return null;
    }
    const description =
        typeof raw.description === 'string' ? raw.description.trim() : '';
    return {
        title: title.slice(0, MAX_TITLE_LENGTH),
        ...(description
            ? { description: description.slice(0, MAX_DESCRIPTION_LENGTH) }
            : {}),
        start,
        stop,
    };
}

/**
 * Validates the renderer-supplied stop-enrichment payload. Returns `null`
 * for a payload that is not an array (fail closed); invalid entries inside a
 * valid array are dropped individually.
 */
export function sanitizeRecordingPrograms(
    programs: unknown
): RecordingProgramSnapshot[] | null {
    if (!Array.isArray(programs) || programs.length > MAX_PROGRAMS) {
        return null;
    }
    const sanitized: RecordingProgramSnapshot[] = [];
    for (const entry of programs) {
        const program = sanitizeProgram(entry);
        if (program) {
            sanitized.push(program);
        }
    }
    return sanitized;
}

/** Decodes the persisted `programs_json` column, tolerating legacy junk. */
export function decodeRecordingPrograms(
    programsJson: string | null | undefined
): RecordingProgramSnapshot[] | undefined {
    if (!programsJson) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(programsJson);
        const sanitized = sanitizeRecordingPrograms(parsed);
        return sanitized && sanitized.length > 0 ? sanitized : undefined;
    } catch {
        return undefined;
    }
}

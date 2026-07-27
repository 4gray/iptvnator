import { createHash } from 'node:crypto';

import type { XtreamArtifactSafetyContext } from './xtream-summary-contract';

export interface XtreamDiagnosticArtifactReceipt {
    readonly bytes: number;
    readonly filename: string;
    readonly label: string;
    readonly sha256: string;
}

declare const EVIDENCE_BRAND: unique symbol;

export interface XtreamDiagnosticArtifactEvidence {
    readonly [EVIDENCE_BRAND]: true;
    readonly artifacts: readonly XtreamDiagnosticArtifactReceipt[];
    readonly directorySha256: string;
    readonly profiles: XtreamDiagnosticProfileEvidence;
}

export interface XtreamDiagnosticProfileEvidence {
    readonly databaseWorker: {
        readonly durationMicros: number;
        readonly ordinal: number;
    };
    readonly main: {
        readonly durationMicros: number;
    };
    readonly renderer: {
        readonly durationMicros: number;
    };
}

export interface XtreamValidatedArtifactContent {
    readonly content: Uint8Array;
    readonly cpuProfileDurationMicros: number | null;
    readonly filename: string;
    readonly label: string;
}

interface XtreamDiagnosticEvidenceAuthority {
    is(value: unknown): value is XtreamDiagnosticArtifactEvidence;
    issue(
        realDirectory: string,
        artifacts: readonly XtreamValidatedArtifactContent[],
        databaseWorkerOrdinal: number
    ): XtreamDiagnosticArtifactEvidence;
}

const SENSITIVE_KEYS = new Set([
    'authorization',
    'credential',
    'credentials',
    'password',
    'playlisturl',
    'serverurl',
    'token',
    'username',
]);
const MAX_PERCENT_DECODE_PASSES = 8;

export function createXtreamDiagnosticEvidenceAuthority(): XtreamDiagnosticEvidenceAuthority {
    const validated = new WeakSet<object>();
    return {
        is(value): value is XtreamDiagnosticArtifactEvidence {
            return (
                typeof value === 'object' &&
                value !== null &&
                validated.has(value)
            );
        },
        issue(realDirectory, artifacts, databaseWorkerOrdinal) {
            const receipts = Object.freeze(
                artifacts.map(({ content, filename, label }) =>
                    Object.freeze({
                        bytes: content.byteLength,
                        filename,
                        label,
                        sha256: sha256(content),
                    })
                )
            );
            const duration = (label: string): number => {
                const value = artifacts.find(
                    (artifact) => artifact.label === label
                )?.cpuProfileDurationMicros;
                if (!Number.isSafeInteger(value) || Number(value) <= 0) {
                    throw new Error('invalid diagnostic profile evidence');
                }
                return Number(value);
            };
            if (
                !Number.isSafeInteger(databaseWorkerOrdinal) ||
                databaseWorkerOrdinal <= 0
            ) {
                throw new Error('invalid diagnostic worker identity');
            }
            const profiles = Object.freeze({
                databaseWorker: Object.freeze({
                    durationMicros: duration('database-cpu-profile'),
                    ordinal: databaseWorkerOrdinal,
                }),
                main: Object.freeze({
                    durationMicros: duration('main-cpu-profile'),
                }),
                renderer: Object.freeze({
                    durationMicros: duration('renderer-cpu-profile'),
                }),
            });
            const directorySha256 = sha256(
                Buffer.from(
                    `${realDirectory}\0${JSON.stringify(receipts)}`,
                    'utf8'
                )
            );
            const evidence = Object.freeze({
                artifacts: receipts,
                directorySha256,
                profiles,
            }) as XtreamDiagnosticArtifactEvidence;
            validated.add(evidence);
            return evidence;
        },
    };
}

export function assertXtreamArtifactRedacted(
    value: unknown,
    forbiddenValues: readonly string[] = []
): void {
    try {
        assertArtifactRedacted(value, forbiddenValues);
    } catch {
        throw unsafeArtifact();
    }
}

function assertArtifactRedacted(
    value: unknown,
    forbiddenValues: readonly string[]
): void {
    const secrets: string[] = [];
    for (let index = 0; index < forbiddenValues.length; index += 1) {
        const entry = Reflect.get(forbiddenValues, String(index)) as unknown;
        if (typeof entry === 'string' && entry.length > 0) {
            secrets.push(entry);
        }
    }
    const visit = (input: unknown): void => {
        if (typeof input === 'string') {
            for (const candidate of decodedVariants(input)) {
                if (
                    secrets.some((secret) => candidate.includes(secret)) ||
                    /[?&](?:username|password|token)=/iu.test(candidate) ||
                    /:\/\/[^/\s]+@/u.test(candidate)
                ) {
                    throw unsafeArtifact();
                }
            }
            return;
        }
        if (Array.isArray(input)) {
            const length = input.length;
            for (let index = 0; index < length; index += 1) {
                visit(Reflect.get(input, String(index)));
            }
            return;
        }
        if (!input || typeof input !== 'object') return;
        for (const [key, entry] of Object.entries(input)) {
            if (SENSITIVE_KEYS.has(key.replace(/[-_]/gu, '').toLowerCase())) {
                throw unsafeArtifact();
            }
            visit(entry);
        }
    };
    visit(value);
}

function decodedVariants(value: string): readonly string[] {
    const variants = [value];
    let current = value;
    for (let pass = 0; pass < MAX_PERCENT_DECODE_PASSES; pass += 1) {
        const decoded = decodePercentPass(current);
        if (decoded === current) break;
        variants.push(decoded);
        current = decoded;
    }
    const afterCap = decodePercentPass(current);
    if (afterCap !== current) throw unsafeArtifact();
    return variants;
}

function decodePercentPass(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value.replace(/%([a-f0-9]{2})/giu, (_match, hex: string) =>
            String.fromCharCode(Number.parseInt(hex, 16))
        );
    }
}

export function serializeXtreamArtifactForPersistence(
    value: unknown,
    safety: XtreamArtifactSafetyContext
): string {
    try {
        return serializeArtifact(value, safety);
    } catch {
        throw unsafeArtifact();
    }
}

function serializeArtifact(
    value: unknown,
    safety: XtreamArtifactSafetyContext
): string {
    const controlToken = safety.controlToken;
    const credentials = safety.syntheticCredentials;
    const username = credentials?.username;
    const password = credentials?.password;
    if (
        typeof controlToken !== 'string' ||
        controlToken.length === 0 ||
        username !== 'performance' ||
        password !== 'performance'
    ) {
        throw unsafeArtifact();
    }
    assertXtreamArtifactRedacted(value, [controlToken]);
    let serialized: string | undefined;
    try {
        serialized = JSON.stringify(value);
    } catch {
        throw unsafeArtifact();
    }
    if (typeof serialized !== 'string') throw unsafeArtifact();
    let canonical: unknown;
    try {
        canonical = JSON.parse(serialized) as unknown;
    } catch {
        throw unsafeArtifact();
    }
    assertXtreamArtifactRedacted(canonical, [controlToken]);
    if (
        JSON.stringify(canonical) !== serialized ||
        serialized.includes(controlToken) ||
        /performance(?::|%3a)performance/iu.test(serialized) ||
        /[?&](?:username=performance[^"#]*&password=performance|password=performance[^"#]*&username=performance)/iu.test(
            serialized
        ) ||
        /:\/\/performance(?::|%3a)performance@/iu.test(serialized)
    ) {
        throw unsafeArtifact();
    }
    return serialized;
}

function sha256(value: Uint8Array): string {
    return createHash('sha256').update(value).digest('hex');
}

function unsafeArtifact(): Error {
    return new Error('Xtream artifact must remain credential-safe');
}

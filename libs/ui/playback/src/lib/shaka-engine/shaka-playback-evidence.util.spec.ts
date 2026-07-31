import { execFileSync } from 'node:child_process';
import * as shakaDiagnostics from './shaka-error-classifier';

interface ShakaErrorInput {
    readonly severity?: unknown;
    readonly category?: unknown;
    readonly code?: unknown;
    readonly message?: unknown;
    readonly data?: readonly unknown[];
    readonly [key: string]: unknown;
}

interface ExpectedShakaPlaybackEvidence {
    readonly severity: string;
    readonly category: string;
    readonly engineCode: number | string;
    readonly disposition: string;
    readonly stage: string;
    readonly failure: string;
    readonly httpStatus?: number;
}

interface InstalledShakaContract {
    readonly version: string;
    readonly severity: Readonly<Record<string, number>>;
    readonly category: Readonly<Record<string, number>>;
    readonly code: Readonly<Record<string, number>>;
}

interface ShakaEvidenceExports {
    readonly SHAKA_DIAGNOSTIC_VERSION?: string;
    readonly SHAKA_ERROR_SEVERITY?: Readonly<Record<string, number>>;
    readonly SHAKA_ERROR_CATEGORY?: Readonly<Record<string, number>>;
    readonly SHAKA_ERROR_CODE?: Readonly<Record<string, number>>;
    readonly createShakaPlaybackEvidence?: (
        error: ShakaErrorInput | null | undefined,
        disposition: 'terminal' | 'recoverable'
    ) => ExpectedShakaPlaybackEvidence;
}

const exportsUnderTest = shakaDiagnostics as ShakaEvidenceExports;

describe('Shaka playback evidence', () => {
    it('matches the installed public Shaka 5.2.2 error contract', () => {
        const installed = getInstalledShakaContract();

        expect(exportsUnderTest.SHAKA_DIAGNOSTIC_VERSION).toBe(
            installed.version
        );
        expect(exportsUnderTest.SHAKA_ERROR_SEVERITY).toEqual(
            installed.severity
        );
        expect(exportsUnderTest.SHAKA_ERROR_CATEGORY).toEqual(
            installed.category
        );
        expect(exportsUnderTest.SHAKA_ERROR_CODE).toBeDefined();

        for (const [name, value] of Object.entries(
            exportsUnderTest.SHAKA_ERROR_CODE ?? {}
        )) {
            expect(installed.code[name]).toBe(value);
        }
    });

    it('extracts only the documented status from a real bad-status shape', () => {
        const secret = 'shaka-direct-secret';
        const evidence = createEvidence(
            {
                severity: 1,
                category: 1,
                code: 1001,
                message: `request failed at https://user:${secret}@provider.example`,
                data: [
                    `https://provider.example/manifest.mpd?token=${secret}`,
                    503,
                    `provider response body ${secret}`,
                    { Authorization: `Bearer ${secret}` },
                    0,
                    `https://provider.example/final?token=${secret}`,
                ],
                providerPayload: { key: secret },
            },
            'terminal'
        );
        const serialized = JSON.stringify(evidence);

        expect(evidence).toEqual({
            severity: 'recoverable',
            category: 'network',
            engineCode: 1001,
            disposition: 'terminal',
            stage: 'unknown',
            failure: 'network',
            httpStatus: 503,
        });
        expect(serialized).not.toContain(secret);
        expect(serialized).not.toContain('provider.example');
        expect(serialized).not.toContain('Authorization');
        expect(serialized).not.toContain('response body');
        expect(Object.keys(evidence).sort()).toEqual(
            [
                'category',
                'disposition',
                'engineCode',
                'failure',
                'httpStatus',
                'severity',
                'stage',
            ].sort()
        );
    });

    it.each([
        { code: 6007, label: 'license request' },
        { code: 6017, label: 'server certificate request' },
    ])(
        'extracts a nested bad status from the documented $label layout',
        ({ code }) => {
            const secret = 'shaka-nested-secret';
            const evidence = createEvidence(
                {
                    severity: 2,
                    category: 6,
                    code,
                    data: [
                        {
                            severity: 1,
                            category: 1,
                            code: 1001,
                            data: [
                                `https://provider.example/license?token=${secret}`,
                                403,
                                `license response ${secret}`,
                                { Authorization: `Bearer ${secret}` },
                            ],
                        },
                        {
                            licenseRequest: secret,
                            sessionMetadata: secret,
                        },
                    ],
                },
                'terminal'
            );
            const serialized = JSON.stringify(evidence);

            expect(evidence).toEqual({
                severity: 'critical',
                category: 'drm',
                engineCode: code,
                disposition: 'terminal',
                stage: 'license',
                failure: 'drm',
                httpStatus: 403,
            });
            expect(serialized).not.toContain(secret);
            expect(serialized).not.toContain('provider.example');
            expect(serialized).not.toContain('Authorization');
        }
    );

    it.each([
        { status: 99, expected: undefined },
        { status: 100, expected: 100 },
        { status: 599, expected: 599 },
        { status: 600, expected: undefined },
        { status: 404.5, expected: undefined },
        { status: '503', expected: undefined },
    ])(
        'retains documented HTTP status $status only inside the protocol range',
        ({ status, expected }) => {
            const evidence = createEvidence(
                {
                    severity: 1,
                    category: 1,
                    code: 1001,
                    data: ['https://provider.example/manifest.mpd', status],
                },
                'terminal'
            );

            expect(evidence.httpStatus).toBe(expected);
        }
    );

    it('ignores status-like data on every undocumented layout', () => {
        const evidence = createEvidence(
            {
                severity: 2,
                category: 4,
                code: 4001,
                data: [503, 504, { status: 505 }],
            },
            'terminal'
        );

        expect(evidence.httpStatus).toBeUndefined();
    });

    it('preserves the exact public streaming startup code as unknown failure evidence', () => {
        expect(
            createEvidence({ severity: 2, category: 5, code: 5006 }, 'terminal')
        ).toEqual({
            severity: 'critical',
            category: 'streaming',
            engineCode: 5006,
            disposition: 'terminal',
            stage: 'unknown',
            failure: 'unknown',
        });
    });

    it.each([
        {
            label: 'manifest parsing',
            error: { severity: 2, category: 4, code: 4001 },
            stage: 'manifest',
            failure: 'manifest',
        },
        {
            label: 'segment index parsing',
            error: { severity: 2, category: 3, code: 3004 },
            stage: 'segment',
            failure: 'media',
        },
        {
            label: 'media source operation',
            error: { severity: 2, category: 3, code: 3014 },
            stage: 'media',
            failure: 'media',
        },
        {
            label: 'license response',
            error: { severity: 2, category: 6, code: 6008 },
            stage: 'license',
            failure: 'drm',
        },
        {
            label: 'network without proven request stage',
            error: { severity: 2, category: 1, code: 1002 },
            stage: 'unknown',
            failure: 'network',
        },
    ])(
        'maps exact $label evidence without reading messages',
        ({ error, stage, failure }) => {
            const evidence = createEvidence(
                {
                    ...error,
                    message:
                        'CORS codec manifest license segment provider guess',
                },
                'terminal'
            );

            expect(evidence.stage).toBe(stage);
            expect(evidence.failure).toBe(failure);
        }
    );

    it.each([
        {
            label: 'ambiguous restrictions',
            error: { severity: 2, category: 4, code: 4012 },
            stage: 'manifest',
        },
        {
            label: 'mismatched public pair',
            error: { severity: 2, category: 1, code: 6001 },
            stage: 'unknown',
        },
        {
            label: 'mismatched media stage pair',
            error: { severity: 2, category: 1, code: 3004 },
            stage: 'unknown',
        },
        {
            label: 'unknown provider code',
            error: { severity: 3, category: 11, code: 123456 },
            stage: 'unknown',
        },
    ])('keeps $label failure evidence unknown', ({ error, stage }) => {
        const evidence = createEvidence(error, 'terminal');

        expect(evidence.failure).toBe('unknown');
        expect(evidence.stage).toBe(stage);
    });

    it('validates severity, category, code, and explicit disposition independently', () => {
        expect(
            createEvidence(
                { severity: 99, category: 99, code: 999999 },
                'recoverable'
            )
        ).toEqual({
            severity: 'unknown',
            category: 'unknown',
            engineCode: 'unknown',
            disposition: 'recoverable',
            stage: 'unknown',
            failure: 'unknown',
        });
    });
});

function createEvidence(
    error: ShakaErrorInput | null | undefined,
    disposition: 'terminal' | 'recoverable'
): ExpectedShakaPlaybackEvidence {
    const factory = exportsUnderTest.createShakaPlaybackEvidence;

    expect(factory).toBeDefined();
    if (!factory) {
        throw new Error('createShakaPlaybackEvidence is not exported');
    }
    return factory(error, disposition);
}

function getInstalledShakaContract(): InstalledShakaContract {
    const script = `
global.self = globalThis;
import('shaka-player').then((module) => {
    const shaka = module.default ?? module;
    process.stdout.write(JSON.stringify({
        version: shaka.Player.version,
        severity: shaka.util.Error.Severity,
        category: shaka.util.Error.Category,
        code: shaka.util.Error.Code,
    }));
}).catch((error) => {
    console.error(error);
    process.exit(1);
});
`;
    return JSON.parse(
        execFileSync(process.execPath, ['-e', script], {
            cwd: process.cwd(),
            encoding: 'utf8',
        })
    ) as InstalledShakaContract;
}

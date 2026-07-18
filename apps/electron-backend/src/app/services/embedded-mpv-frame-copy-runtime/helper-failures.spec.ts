import { SUCCESS_OUTPUT } from './runtime.spec-data';
import { createFixture } from './runtime-fixtures.test-helpers';
import {
    createRuntimeTestContext,
    type RuntimeTestContext,
} from './runtime-harness.test-helpers';

describe('embedded-mpv frame-copy helper failures', () => {
    let context: RuntimeTestContext;

    beforeEach(() => {
        context = createRuntimeTestContext();
    });

    afterEach(() => {
        context.dispose();
    });

    it('converts a thrown spawn failure into a stable result', () => {
        const fixture = createFixture(context.rootDir);
        context.spawnRuntimeProbe.mockImplementation(() => {
            throw new Error('spawn exploded');
        });

        expect(context.createProbe()(fixture.helperPath)).toEqual({
            usable: false,
            reason: 'helper-probe-spawn-error',
        });
    });

    it.each([
        {
            label: 'timeout',
            spawnResult: {
                status: null,
                signal: 'SIGTERM',
                stdout: '',
                stderr: '',
                error: Object.assign(new Error('timed out'), {
                    code: 'ETIMEDOUT',
                }),
            },
            reason: 'helper-probe-timeout',
        },
        {
            label: 'spawn error',
            spawnResult: {
                status: null,
                signal: null,
                stdout: '',
                stderr: '',
                error: Object.assign(new Error('spawn failed'), {
                    code: 'EACCES',
                }),
            },
            reason: 'helper-probe-spawn-error',
        },
        {
            label: 'nonzero exit',
            spawnResult: {
                status: 1,
                signal: null,
                stdout: '{"protocol":1,"usable":false,"reason":"egl-unavailable"}\n',
                stderr: '',
            },
            reason: 'helper-probe-failed',
        },
        {
            label: 'signal',
            spawnResult: {
                status: null,
                signal: 'SIGKILL',
                stdout: '',
                stderr: '',
            },
            reason: 'helper-probe-signaled',
        },
        {
            label: 'invalid JSON',
            spawnResult: {
                status: 0,
                signal: null,
                stdout: 'not-json\n',
                stderr: '',
            },
            reason: 'helper-probe-invalid-output',
        },
        {
            label: 'multiple lines',
            spawnResult: {
                status: 0,
                signal: null,
                stdout: `${SUCCESS_OUTPUT}${SUCCESS_OUTPUT}`,
                stderr: '',
            },
            reason: 'helper-probe-invalid-output',
        },
        {
            label: 'wrong protocol',
            spawnResult: {
                status: 0,
                signal: null,
                stdout: '{"protocol":2,"usable":true,"libmpv":"2.3","renderApi":"egl"}\n',
                stderr: '',
            },
            reason: 'helper-probe-protocol-mismatch',
        },
        {
            label: 'unusable success',
            spawnResult: {
                status: 0,
                signal: null,
                stdout: '{"protocol":1,"usable":false,"reason":"egl-unavailable"}\n',
                stderr: '',
            },
            reason: 'helper-probe-unusable',
        },
    ])('fails closed on helper $label', ({ spawnResult, reason }) => {
        const fixture = createFixture(context.rootDir);
        context.spawnRuntimeProbe.mockReturnValue(spawnResult);

        expect(context.createProbe()(fixture.helperPath)).toEqual(
            expect.objectContaining({ usable: false, reason })
        );
    });

    it.each([
        'mpv-create-failed',
        'mpv-initialize-failed',
        'gl-context-create-failed',
        'gl-context-bind-failed',
        'mpv-render-context-failed',
        'shared-memory-create-failed',
        'shared-memory-initialize-failed',
    ])('preserves the allowlisted helper reason %s', (helperReason) => {
        const fixture = createFixture(context.rootDir);
        const helperDetail =
            helperReason === 'mpv-create-failed'
                ? undefined
                : 'EGL initialization failed: display unavailable';
        context.spawnRuntimeProbe.mockReturnValue({
            status: 1,
            signal: null,
            stdout: `${JSON.stringify({
                protocol: 1,
                usable: false,
                reason: helperReason,
                ...(helperDetail ? { detail: helperDetail } : {}),
            })}\n`,
            stderr: '',
        });

        expect(context.createProbe()(fixture.helperPath)).toEqual({
            usable: false,
            reason: 'helper-probe-failed',
            helperReason,
            ...(helperDetail ? { helperDetail } : {}),
        });
    });

    it.each([
        ['one printable ASCII character', 'x'],
        ['1024 printable ASCII characters', 'x'.repeat(1024)],
    ])('preserves %s as helper detail', (_label, helperDetail) => {
        const fixture = createFixture(context.rootDir);
        context.spawnRuntimeProbe.mockReturnValue({
            status: 1,
            signal: null,
            stdout: `${JSON.stringify({
                protocol: 1,
                usable: false,
                reason: 'gl-context-create-failed',
                detail: helperDetail,
            })}\n`,
            stderr: '',
        });

        expect(context.createProbe()(fixture.helperPath)).toEqual({
            usable: false,
            reason: 'helper-probe-failed',
            helperReason: 'gl-context-create-failed',
            helperDetail,
        });
    });

    it.each([
        ['malformed JSON', 'not-json\n'],
        [
            'multiple lines',
            '{"protocol":1,"usable":false,"reason":"mpv-create-failed"}\nignored\n',
        ],
        [
            'wrong protocol',
            '{"protocol":2,"usable":false,"reason":"mpv-create-failed"}\n',
        ],
        [
            'wrong usable value',
            '{"protocol":1,"usable":true,"reason":"mpv-create-failed"}\n',
        ],
        [
            'non-allowlisted reason',
            '{"protocol":1,"usable":false,"reason":"loader-injected"}\n',
        ],
        [
            'unexpected field',
            '{"protocol":1,"usable":false,"reason":"mpv-create-failed","extra":true}\n',
        ],
        [
            'invalid detail',
            '{"protocol":1,"usable":false,"reason":"mpv-create-failed","detail":1}\n',
        ],
    ])('does not propagate a helper reason from %s', (_label, stdout) => {
        const fixture = createFixture(context.rootDir);
        context.spawnRuntimeProbe.mockReturnValue({
            status: 1,
            signal: null,
            stdout,
            stderr: '',
        });

        expect(context.createProbe()(fixture.helperPath)).toEqual({
            usable: false,
            reason: 'helper-probe-failed',
        });
    });

    it.each([
        ['empty', ''],
        ['control character', 'EGL\tfailure'],
        ['trailing line feed', 'EGL failure\n'],
        ['DEL character', `EGL${String.fromCharCode(0x7f)}failure`],
        ['non-ASCII character', 'EGL échoué'],
        ['1025 characters', 'x'.repeat(1025)],
    ])(
        'does not propagate any helper fields from %s detail',
        (_label, detail) => {
            const fixture = createFixture(context.rootDir);
            context.spawnRuntimeProbe.mockReturnValue({
                status: 1,
                signal: null,
                stdout: `${JSON.stringify({
                    protocol: 1,
                    usable: false,
                    reason: 'gl-context-create-failed',
                    detail,
                })}\n`,
                stderr: '',
            });

            expect(context.createProbe()(fixture.helperPath)).toEqual({
                usable: false,
                reason: 'helper-probe-failed',
            });
        }
    );

    it('does not trace helper stderr without the exact player trace flag', () => {
        const fixture = createFixture(context.rootDir);
        context.spawnRuntimeProbe.mockReturnValue({
            status: 1,
            signal: null,
            stdout: '{"protocol":1,"usable":false,"reason":"gl-context-create-failed"}\n',
            stderr: 'libEGL debug output\n',
        });

        expect(context.createProbe()(fixture.helperPath)).toEqual({
            usable: false,
            reason: 'helper-probe-failed',
            helperReason: 'gl-context-create-failed',
        });
        expect(context.writeRuntimeProbeStderr).not.toHaveBeenCalled();
    });

    it('traces helper stderr as one JSON-escaped line when player tracing is enabled', () => {
        const fixture = createFixture(context.rootDir);
        const helperStderr =
            'libEGL warning: vendor "mesa"\nfailed path: C:\\driver';
        context.spawnRuntimeProbe.mockReturnValue({
            status: 1,
            signal: null,
            stdout: '{"protocol":1,"usable":false,"reason":"gl-context-create-failed"}\n',
            stderr: helperStderr,
        });

        expect(
            context.createProbe({
                env: {
                    PATH: '/usr/bin',
                    IPTVNATOR_TRACE_PLAYER: '1',
                },
            })(fixture.helperPath)
        ).toEqual({
            usable: false,
            reason: 'helper-probe-failed',
            helperReason: 'gl-context-create-failed',
        });
        expect(context.writeRuntimeProbeStderr).toHaveBeenCalledWith(
            `${JSON.stringify({
                event: 'embedded-mpv-helper-runtime-probe-stderr',
                stderr: helperStderr,
                truncated: false,
            })}\n`
        );
        expect(context.writeRuntimeProbeStderr).toHaveBeenCalledTimes(1);
        expect(
            context.writeRuntimeProbeStderr.mock.calls[0][0].split('\n')
        ).toHaveLength(2);
    });

    it('bounds traced helper stderr to 16384 characters and reports truncation', () => {
        const fixture = createFixture(context.rootDir);
        const helperStderr = `${'x'.repeat(16_384)}discarded`;
        context.spawnRuntimeProbe.mockReturnValue({
            status: 1,
            signal: null,
            stdout: '{"protocol":1,"usable":false,"reason":"gl-context-create-failed"}\n',
            stderr: helperStderr,
        });

        context.createProbe({
            env: {
                PATH: '/usr/bin',
                IPTVNATOR_TRACE_PLAYER: '1',
            },
        })(fixture.helperPath);

        const trace = JSON.parse(
            context.writeRuntimeProbeStderr.mock.calls[0][0]
        );
        expect(trace).toEqual({
            event: 'embedded-mpv-helper-runtime-probe-stderr',
            stderr: 'x'.repeat(16_384),
            truncated: true,
        });
        expect(trace.stderr).toHaveLength(16_384);
        expect(context.writeRuntimeProbeStderr).toHaveBeenCalledTimes(1);
    });
});

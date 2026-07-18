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
        context.spawnRuntimeProbe.mockReturnValue({
            status: 1,
            signal: null,
            stdout: `${JSON.stringify({
                protocol: 1,
                usable: false,
                reason: helperReason,
                ...(helperReason === 'mpv-create-failed'
                    ? {}
                    : {
                          detail: 'diagnostic detail is intentionally not propagated',
                      }),
            })}\n`,
            stderr: '',
        });

        expect(context.createProbe()(fixture.helperPath)).toEqual({
            usable: false,
            reason: 'helper-probe-failed',
            helperReason,
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
});

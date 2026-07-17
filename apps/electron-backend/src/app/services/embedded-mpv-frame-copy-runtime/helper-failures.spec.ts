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
});

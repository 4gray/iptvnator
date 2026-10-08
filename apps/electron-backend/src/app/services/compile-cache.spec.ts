import { join } from 'node:path';

import {
    COMPILE_CACHE_DIR_ENV,
    COMPILE_CACHE_DISABLE_ENV,
    enableStartupCompileCache,
    isCompileCacheDisabled,
    publishCompileCacheOutcome,
    readCompileCacheOutcome,
    resolveCompileCacheDirectory,
    type CompileCacheEnableResult,
    type CompileCacheModule,
} from './compile-cache';

const OUTCOME_KEY = Symbol.for('iptvnator.compileCacheOutcome');
const userData = join('/profiles', 'iptvnator');
const defaultDirectory = join(userData, 'v8-compile-cache');

function createModule(
    result: CompileCacheEnableResult = {
        status: 1,
        directory: defaultDirectory,
    }
): jest.Mocked<Required<CompileCacheModule>> {
    return { enableCompileCache: jest.fn().mockReturnValue(result) };
}

function enable(
    env: NodeJS.ProcessEnv,
    module: CompileCacheModule = createModule(),
    userDataPath: () => string = () => userData
) {
    return enableStartupCompileCache({ env, module, userDataPath });
}

describe('startup compile cache guard', () => {
    afterEach(() => {
        delete (globalThis as Record<symbol, unknown>)[OUTCOME_KEY];
    });

    describe('cache directory', () => {
        it('lives under userData/v8-compile-cache by default', () => {
            expect(resolveCompileCacheDirectory({}, () => userData)).toBe(
                defaultDirectory
            );
        });

        it('prefers IPTVNATOR_COMPILE_CACHE_DIR and never asks for userData then', () => {
            const userDataPath = jest.fn(() => userData);

            const directory = resolveCompileCacheDirectory(
                { [COMPILE_CACHE_DIR_ENV]: '  /tmp/iptvnator-cache  ' },
                userDataPath
            );

            expect(directory).toBe('/tmp/iptvnator-cache');
            expect(userDataPath).not.toHaveBeenCalled();
        });

        it('ignores a blank IPTVNATOR_COMPILE_CACHE_DIR', () => {
            expect(
                resolveCompileCacheDirectory(
                    { [COMPILE_CACHE_DIR_ENV]: '   ' },
                    () => userData
                )
            ).toBe(defaultDirectory);
        });

        it('stays inside the E2E data directory, mirroring the userData override', () => {
            const directory = resolveCompileCacheDirectory(
                { IPTVNATOR_E2E_DATA_DIR: '/tmp/e2e-run' },
                () => userData
            );

            expect(directory).toBe(
                join('/tmp/e2e-run', 'user-data', 'v8-compile-cache')
            );
        });
    });

    describe('kill switch', () => {
        it.each(['1', 'true', 'yes', 'ON', ' on '])(
            'honours IPTVNATOR_DISABLE_COMPILE_CACHE=%j without touching node:module',
            (value) => {
                const module = createModule();
                const userDataPath = jest.fn(() => userData);

                const outcome = enableStartupCompileCache({
                    env: { [COMPILE_CACHE_DISABLE_ENV]: value },
                    module,
                    userDataPath,
                });

                expect(outcome).toEqual({
                    status: 'disabled',
                    reason: COMPILE_CACHE_DISABLE_ENV,
                });
                expect(module.enableCompileCache).not.toHaveBeenCalled();
                expect(userDataPath).not.toHaveBeenCalled();
            }
        );

        it.each(['', '0', 'false', 'off'])(
            'keeps the cache on for IPTVNATOR_DISABLE_COMPILE_CACHE=%j',
            (value) => {
                expect(
                    isCompileCacheDisabled({
                        [COMPILE_CACHE_DISABLE_ENV]: value,
                    })
                ).toBe(false);
                expect(
                    enable({ [COMPILE_CACHE_DISABLE_ENV]: value }).status
                ).toBe('enabled');
            }
        );

        it('defaults to enabled when the variable is absent', () => {
            expect(isCompileCacheDisabled({})).toBe(false);
        });
    });

    describe('enabling', () => {
        it('enables the cache in the resolved directory', () => {
            const module = createModule();

            const outcome = enable({}, module);

            expect(module.enableCompileCache).toHaveBeenCalledWith(
                defaultDirectory
            );
            expect(outcome).toEqual({
                status: 'enabled',
                directory: defaultDirectory,
            });
        });

        it('reports the directory Node settled on when it differs', () => {
            const module = createModule({
                status: 1,
                directory: '/resolved/elsewhere',
            });

            expect(enable({}, module)).toEqual({
                status: 'enabled',
                directory: '/resolved/elsewhere',
            });
        });

        it('maps ALREADY_ENABLED without treating it as a failure', () => {
            expect(enable({}, createModule({ status: 2 }))).toEqual({
                status: 'already-enabled',
                directory: defaultDirectory,
            });
        });

        it('maps Node’s own DISABLED status and keeps its message', () => {
            expect(
                enable(
                    {},
                    createModule({
                        status: 3,
                        message: 'NODE_DISABLE_COMPILE_CACHE is set',
                    })
                )
            ).toEqual({
                status: 'disabled',
                reason: 'NODE_DISABLE_COMPILE_CACHE is set',
            });
        });

        it('maps FAILED with the message Node gives', () => {
            expect(
                enable(
                    {},
                    createModule({
                        status: 0,
                        message: 'cannot create directory',
                    })
                )
            ).toEqual({
                status: 'failed',
                directory: defaultDirectory,
                reason: 'cannot create directory',
            });
        });
    });

    describe('failure tolerance', () => {
        it('reports unavailable when Node has no enableCompileCache', () => {
            expect(enable({}, {})).toEqual({
                status: 'unavailable',
                reason: 'module.enableCompileCache is missing',
            });
        });

        it('swallows an exception thrown by enableCompileCache', () => {
            const module: CompileCacheModule = {
                enableCompileCache: () => {
                    throw new Error('EACCES: permission denied');
                },
            };

            expect(enable({}, module)).toEqual({
                status: 'failed',
                directory: defaultDirectory,
                reason: 'EACCES: permission denied',
            });
        });

        it('swallows a failing userData lookup', () => {
            const module = createModule();

            const outcome = enable({}, module, () => {
                throw new Error('app is not ready');
            });

            expect(outcome).toEqual({
                status: 'failed',
                reason: 'app is not ready',
            });
            expect(module.enableCompileCache).not.toHaveBeenCalled();
        });

        it('stringifies non-Error throwables', () => {
            const module: CompileCacheModule = {
                enableCompileCache: () => {
                    throw 'boom';
                },
            };

            expect(enable({}, module).reason).toBe('boom');
        });
    });

    describe('outcome hand-over to the bundle', () => {
        it('reads back what the entry published', () => {
            publishCompileCacheOutcome({
                status: 'enabled',
                directory: defaultDirectory,
            });

            expect(readCompileCacheOutcome()).toEqual({
                status: 'enabled',
                directory: defaultDirectory,
            });
        });

        it('explains a missing outcome instead of tracing undefined', () => {
            expect(readCompileCacheOutcome()).toEqual({
                status: 'unavailable',
                reason: 'main.entry did not run',
            });
        });
    });
});

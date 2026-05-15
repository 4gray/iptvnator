import { createDevLogger } from './dev-logger.util';

describe('createDevLogger', () => {
    const globalWithNgDevMode = globalThis as typeof globalThis & {
        ngDevMode?: boolean;
    };

    const originalNgDevMode = globalWithNgDevMode.ngDevMode;
    const originalNodeEnv = process.env['NODE_ENV'];
    let debugSpy: jest.SpyInstance;

    beforeEach(() => {
        globalWithNgDevMode.ngDevMode = true;
        process.env['NODE_ENV'] = 'development';
        debugSpy = jest.spyOn(console, 'debug').mockImplementation();
    });

    afterEach(() => {
        globalWithNgDevMode.ngDevMode = originalNgDevMode;
        if (originalNodeEnv === undefined) {
            delete process.env['NODE_ENV'];
        } else {
            process.env['NODE_ENV'] = originalNodeEnv;
        }
        debugSpy.mockRestore();
    });

    it('logs scoped debug output outside production and test mode', () => {
        const debug = createDevLogger('Scope');

        debug('message', { id: 1 });

        expect(debugSpy).toHaveBeenCalledWith('[Scope]', 'message', {
            id: 1,
        });
    });

    it('suppresses debug output in Angular production mode', () => {
        globalWithNgDevMode.ngDevMode = false;
        const debug = createDevLogger('Scope');

        debug('message');

        expect(debugSpy).not.toHaveBeenCalled();
    });

    it('suppresses debug output during tests', () => {
        process.env['NODE_ENV'] = 'test';
        const debug = createDevLogger('Scope');

        debug('message');

        expect(debugSpy).not.toHaveBeenCalled();
    });
});

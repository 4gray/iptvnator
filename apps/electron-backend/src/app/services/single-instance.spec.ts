import {
    ALLOW_MULTIPLE_INSTANCES_ENV,
    acquireSingleInstanceLock,
    allowsMultipleInstances,
    focusExistingWindow,
    type SingleInstanceApp,
    type SingleInstanceWindow,
} from './single-instance';

/**
 * Electron's real `second-instance` listener signature. The guard has to keep
 * working when Electron hands over an empty command line, so the argv and
 * working directory are modelled as optional here.
 */
type SecondInstanceHandler = (
    event: unknown,
    argv: string[] | undefined,
    workingDirectory: string | undefined
) => void;

function createApp(hasLock: boolean): jest.Mocked<SingleInstanceApp> {
    return {
        quit: jest.fn(),
        on: jest.fn(),
        requestSingleInstanceLock: jest.fn().mockReturnValue(hasLock),
    };
}

function createWindow(
    overrides: Partial<SingleInstanceWindow> = {}
): jest.Mocked<SingleInstanceWindow> {
    return {
        focus: jest.fn(),
        isDestroyed: jest.fn().mockReturnValue(false),
        isMinimized: jest.fn().mockReturnValue(false),
        isVisible: jest.fn().mockReturnValue(true),
        restore: jest.fn(),
        show: jest.fn(),
        ...overrides,
    } as jest.Mocked<SingleInstanceWindow>;
}

describe('allowsMultipleInstances', () => {
    it.each(['1', 'true', 'YES', ' on '])(
        'treats %p as an opt-in',
        (value) => {
            expect(
                allowsMultipleInstances({
                    [ALLOW_MULTIPLE_INSTANCES_ENV]: value,
                })
            ).toBe(true);
        }
    );

    it.each([undefined, '', '0', 'false', 'nope'])(
        'treats %p as opted out',
        (value) => {
            expect(
                allowsMultipleInstances(
                    value === undefined
                        ? {}
                        : { [ALLOW_MULTIPLE_INSTANCES_ENV]: value }
                )
            ).toBe(false);
        }
    );
});

describe('acquireSingleInstanceLock', () => {
    it('continues startup and registers the focus handler when the lock is free', () => {
        const app = createApp(true);

        expect(
            acquireSingleInstanceLock(app, () => null, jest.fn(), { env: {} })
        ).toBe(true);
        expect(app.quit).not.toHaveBeenCalled();
        expect(app.on).toHaveBeenCalledWith(
            'second-instance',
            expect.any(Function)
        );
    });

    it('quits and stops startup when another instance owns the profile', () => {
        const app = createApp(false);

        expect(
            acquireSingleInstanceLock(app, () => null, jest.fn(), { env: {} })
        ).toBe(false);
        expect(app.quit).toHaveBeenCalledTimes(1);
        expect(app.on).not.toHaveBeenCalled();
    });

    it('focuses the existing window when a second instance is launched', () => {
        const app = createApp(true);
        const window = createWindow({
            isMinimized: jest.fn().mockReturnValue(true),
            isVisible: jest.fn().mockReturnValue(false),
        });

        const createMainWindow = jest.fn();
        acquireSingleInstanceLock(app, () => window, createMainWindow, {
            env: {},
        });
        const [, handler] = app.on.mock.calls[0];
        (handler as () => void)();

        expect(window.restore).toHaveBeenCalledTimes(1);
        expect(window.show).toHaveBeenCalledTimes(1);
        expect(window.focus).toHaveBeenCalledTimes(1);
        expect(createMainWindow).not.toHaveBeenCalled();
    });

    // macOS keeps the process alive after the last window closes, so a second
    // launch must rebuild a window instead of quitting into nothing.
    it.each([
        ['no window exists', null],
        ['the window was destroyed', 'destroyed'],
    ])('re-creates the main window when %s', (_label, windowState) => {
        const app = createApp(true);
        const window =
            windowState === 'destroyed'
                ? createWindow({
                      isDestroyed: jest.fn().mockReturnValue(true),
                  })
                : null;
        const createMainWindow = jest.fn();

        acquireSingleInstanceLock(app, () => window, createMainWindow, {
            env: {},
        });
        const [, handler] = app.on.mock.calls[0];
        (handler as () => void)();

        expect(createMainWindow).toHaveBeenCalledTimes(1);
        if (window) {
            expect(window.focus).not.toHaveBeenCalled();
        }
    });

    it('skips the lock entirely when multiple instances are allowed', () => {
        const app = createApp(false);

        expect(
            acquireSingleInstanceLock(app, () => null, jest.fn(), {
                env: { [ALLOW_MULTIPLE_INSTANCES_ENV]: '1' },
            })
        ).toBe(true);
        expect(app.requestSingleInstanceLock).not.toHaveBeenCalled();
        expect(app.quit).not.toHaveBeenCalled();
    });

    it('forwards a second launch command line before focusing the window', () => {
        const app = createApp(true);
        const window = createWindow();
        const onSecondInstance = jest.fn();

        acquireSingleInstanceLock(app, () => window, jest.fn(), {
            env: {},
            onSecondInstance,
        });
        const [, handler] = app.on.mock.calls[0];
        (handler as SecondInstanceHandler)(
            {},
            ['/opt/iptvnator/iptvnator', '/home/user/list.m3u'],
            '/home/user'
        );

        expect(onSecondInstance).toHaveBeenCalledWith(
            ['/opt/iptvnator/iptvnator', '/home/user/list.m3u'],
            '/home/user'
        );
        expect(onSecondInstance.mock.invocationCallOrder[0]).toBeLessThan(
            window.focus.mock.invocationCallOrder[0]
        );
    });

    it('forwards a second launch that carries no arguments', () => {
        const app = createApp(true);
        const window = createWindow();
        const onSecondInstance = jest.fn();

        acquireSingleInstanceLock(app, () => window, jest.fn(), {
            env: {},
            onSecondInstance,
        });
        const [, handler] = app.on.mock.calls[0];
        (handler as SecondInstanceHandler)({}, undefined, undefined);

        expect(onSecondInstance).toHaveBeenCalledWith([], '');
        expect(window.focus).toHaveBeenCalledTimes(1);
    });

    it('still forwards when the lock owner has to rebuild its window', () => {
        const app = createApp(true);
        const createMainWindow = jest.fn();
        const onSecondInstance = jest.fn();

        acquireSingleInstanceLock(app, () => null, createMainWindow, {
            env: {},
            onSecondInstance,
        });
        const [, handler] = app.on.mock.calls[0];
        (handler as SecondInstanceHandler)(
            {},
            ['/opt/iptvnator/iptvnator', '/home/user/list.m3u8'],
            '/home/user'
        );

        expect(onSecondInstance).toHaveBeenCalledWith(
            ['/opt/iptvnator/iptvnator', '/home/user/list.m3u8'],
            '/home/user'
        );
        expect(createMainWindow).toHaveBeenCalledTimes(1);
    });
});

describe('focusExistingWindow', () => {
    it('does nothing without a window', () => {
        expect(() => focusExistingWindow(null)).not.toThrow();
    });

    it('does not touch a destroyed window', () => {
        const window = createWindow({
            isDestroyed: jest.fn().mockReturnValue(true),
        });

        focusExistingWindow(window);

        expect(window.focus).not.toHaveBeenCalled();
        expect(window.restore).not.toHaveBeenCalled();
    });

    it('only focuses an already visible window', () => {
        const window = createWindow();

        focusExistingWindow(window);

        expect(window.restore).not.toHaveBeenCalled();
        expect(window.show).not.toHaveBeenCalled();
        expect(window.focus).toHaveBeenCalledTimes(1);
    });
});

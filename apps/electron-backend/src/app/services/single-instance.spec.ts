import {
    ALLOW_MULTIPLE_INSTANCES_ENV,
    acquireSingleInstanceLock,
    allowsMultipleInstances,
    focusExistingWindow,
    type SingleInstanceApp,
    type SingleInstanceWindow,
} from './single-instance';

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

        expect(acquireSingleInstanceLock(app, () => null, {})).toBe(true);
        expect(app.quit).not.toHaveBeenCalled();
        expect(app.on).toHaveBeenCalledWith(
            'second-instance',
            expect.any(Function)
        );
    });

    it('quits and stops startup when another instance owns the profile', () => {
        const app = createApp(false);

        expect(acquireSingleInstanceLock(app, () => null, {})).toBe(false);
        expect(app.quit).toHaveBeenCalledTimes(1);
        expect(app.on).not.toHaveBeenCalled();
    });

    it('focuses the existing window when a second instance is launched', () => {
        const app = createApp(true);
        const window = createWindow({
            isMinimized: jest.fn().mockReturnValue(true),
            isVisible: jest.fn().mockReturnValue(false),
        });

        acquireSingleInstanceLock(app, () => window, {});
        const [, handler] = app.on.mock.calls[0];
        (handler as () => void)();

        expect(window.restore).toHaveBeenCalledTimes(1);
        expect(window.show).toHaveBeenCalledTimes(1);
        expect(window.focus).toHaveBeenCalledTimes(1);
    });

    it('skips the lock entirely when multiple instances are allowed', () => {
        const app = createApp(false);

        expect(
            acquireSingleInstanceLock(app, () => null, {
                [ALLOW_MULTIPLE_INSTANCES_ENV]: '1',
            })
        ).toBe(true);
        expect(app.requestSingleInstanceLock).not.toHaveBeenCalled();
        expect(app.quit).not.toHaveBeenCalled();
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

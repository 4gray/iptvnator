jest.mock('electron', () => ({
    powerSaveBlocker: {
        start: jest.fn(),
        stop: jest.fn(),
        isStarted: jest.fn(),
    },
}));

import { powerSaveBlocker, WebContents } from 'electron';
import {
    resetPlaybackKeepAwakeForTesting,
    setPlaybackKeepAwake,
} from './playback-keep-awake.service';

type NavigationListener = (event: {
    isMainFrame: boolean;
    isSameDocument: boolean;
}) => void;

const mockedBlocker = powerSaveBlocker as jest.Mocked<typeof powerSaveBlocker>;

function createSenderStub(id: number) {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    const sender = {
        id,
        on: jest.fn((event: string, listener: (...args: unknown[]) => void) => {
            const existing = listeners.get(event) ?? new Set();
            existing.add(listener);
            listeners.set(event, existing);
            return sender;
        }),
        off: jest.fn(
            (event: string, listener: (...args: unknown[]) => void) => {
                listeners.get(event)?.delete(listener);
                return sender;
            }
        ),
    };
    return {
        sender: sender as unknown as WebContents,
        emit: (event: string, ...args: unknown[]) => {
            for (const listener of listeners.get(event) ?? []) {
                listener(...args);
            }
        },
        listenerCount: (event: string) => listeners.get(event)?.size ?? 0,
    };
}

describe('playback keep-awake service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockedBlocker.start.mockReturnValue(7);
        mockedBlocker.isStarted.mockReturnValue(true);
        resetPlaybackKeepAwakeForTesting();
        jest.clearAllMocks();
        mockedBlocker.start.mockReturnValue(7);
        mockedBlocker.isStarted.mockReturnValue(true);
    });

    it('starts the display blocker on activation and stops it on release', () => {
        const { sender } = createSenderStub(1);

        setPlaybackKeepAwake(sender, true);
        expect(mockedBlocker.start).toHaveBeenCalledTimes(1);
        expect(mockedBlocker.start).toHaveBeenCalledWith(
            'prevent-display-sleep'
        );

        setPlaybackKeepAwake(sender, false);
        expect(mockedBlocker.stop).toHaveBeenCalledWith(7);
    });

    it('holds a single blocker across repeated activations', () => {
        const { sender } = createSenderStub(1);

        setPlaybackKeepAwake(sender, true);
        setPlaybackKeepAwake(sender, true);

        expect(mockedBlocker.start).toHaveBeenCalledTimes(1);
    });

    it('does not stop a blocker that was never started', () => {
        const { sender } = createSenderStub(1);

        setPlaybackKeepAwake(sender, false);

        expect(mockedBlocker.start).not.toHaveBeenCalled();
        expect(mockedBlocker.stop).not.toHaveBeenCalled();
    });

    it('releases the blocker when the voting webContents is destroyed', () => {
        const stub = createSenderStub(1);

        setPlaybackKeepAwake(stub.sender, true);
        stub.emit('destroyed');

        expect(mockedBlocker.stop).toHaveBeenCalledWith(7);
    });

    it('releases the blocker when the renderer process crashes', () => {
        const stub = createSenderStub(1);

        setPlaybackKeepAwake(stub.sender, true);
        // A crash emits render-process-gone while the WebContents object
        // stays alive; without a reload no other lifetime event follows.
        stub.emit('render-process-gone', {}, { reason: 'crashed' });

        expect(mockedBlocker.stop).toHaveBeenCalledWith(7);
    });

    it('releases the blocker on a main-frame navigation (reload)', () => {
        const stub = createSenderStub(1);

        setPlaybackKeepAwake(stub.sender, true);
        stub.emit('did-start-navigation', {
            isMainFrame: true,
            isSameDocument: false,
        } satisfies Parameters<NavigationListener>[0]);

        expect(mockedBlocker.stop).toHaveBeenCalledWith(7);
    });

    it('keeps the blocker across same-document navigations (Angular routing)', () => {
        const stub = createSenderStub(1);

        setPlaybackKeepAwake(stub.sender, true);
        stub.emit('did-start-navigation', {
            isMainFrame: true,
            isSameDocument: true,
        } satisfies Parameters<NavigationListener>[0]);

        expect(mockedBlocker.stop).not.toHaveBeenCalled();
    });

    it('detaches its lifetime listeners once the vote is withdrawn', () => {
        const stub = createSenderStub(1);

        setPlaybackKeepAwake(stub.sender, true);
        expect(stub.listenerCount('destroyed')).toBe(1);
        expect(stub.listenerCount('render-process-gone')).toBe(1);
        expect(stub.listenerCount('did-start-navigation')).toBe(1);

        setPlaybackKeepAwake(stub.sender, false);
        expect(stub.listenerCount('destroyed')).toBe(0);
        expect(stub.listenerCount('render-process-gone')).toBe(0);
        expect(stub.listenerCount('did-start-navigation')).toBe(0);
    });

    it('survives a powerSaveBlocker.start failure and can retry later', () => {
        const { sender } = createSenderStub(1);
        mockedBlocker.start.mockImplementationOnce(() => {
            throw new Error('no dbus');
        });

        setPlaybackKeepAwake(sender, true);
        expect(mockedBlocker.stop).not.toHaveBeenCalled();

        // The failed attempt left no blocker; a fresh cycle starts one.
        setPlaybackKeepAwake(sender, false);
        setPlaybackKeepAwake(sender, true);
        expect(mockedBlocker.start).toHaveBeenCalledTimes(2);
    });
});

jest.mock('electron', () => ({
    ipcRenderer: {
        invoke: jest.fn(),
        on: jest.fn(),
    },
}));

jest.mock(
    'embedded-mpv-test-reader',
    () => ({
        open: jest.fn(),
        latestSeq: jest.fn(),
        copyLatest: jest.fn(),
        close: jest.fn(),
    }),
    { virtual: true }
);

import { ipcRenderer } from 'electron';
import {
    EMBEDDED_MPV_FRAME_SOURCE_CHANGED,
    EmbeddedMpvFrameSource,
} from '@iptvnator/shared/interfaces';
import {
    attachEmbeddedMpvFrameView,
    copyStableLatestFrame,
    detachEmbeddedMpvFrameView,
} from './embedded-mpv-frame-pump';

describe('embedded MPV frame pump', () => {
    const frame = new ArrayBuffer(16);

    it('drops a torn copy without consuming its sequence so the next tick retries', () => {
        const reader = {
            latestSeq: jest.fn(() => 7),
            copyLatest: jest
                .fn()
                .mockReturnValueOnce({ seq: 7, ageMs: 1, torn: true })
                .mockReturnValueOnce({ seq: 7, ageMs: 1, torn: false }),
        };

        expect(copyStableLatestFrame(reader, frame, 6)).toBeNull();
        expect(copyStableLatestFrame(reader, frame, 6)).toEqual({
            seq: 7,
            ageMs: 1,
            torn: false,
        });
        expect(reader.copyLatest).toHaveBeenCalledTimes(2);
    });

    it('does not copy when the producer has no newer sequence', () => {
        const reader = {
            latestSeq: jest.fn(() => 6),
            copyLatest: jest.fn(),
        };

        expect(copyStableLatestFrame(reader, frame, 6)).toBeNull();
        expect(reader.copyLatest).not.toHaveBeenCalled();
    });

    it('keeps the displayed frame until a stable resized frame is ready', async () => {
        const reader = jest.requireMock<
            jest.Mocked<{
                open(shmName: string): {
                    width: number;
                    height: number;
                    frameBytes: number;
                };
                latestSeq(): number;
                copyLatest(buffer: ArrayBuffer): {
                    seq: number;
                    ageMs: number;
                    torn: boolean;
                };
                close(): void;
            }>
        >('embedded-mpv-test-reader');
        reader.open.mockReturnValueOnce({
            width: 2,
            height: 2,
            frameBytes: 16,
        });
        reader.open.mockReturnValueOnce({
            width: 4,
            height: 3,
            frameBytes: 48,
        });
        reader.latestSeq.mockReturnValue(1);
        reader.copyLatest.mockReturnValue({ seq: 1, ageMs: 0, torn: false });
        const gl = {
            createProgram: jest.fn(() => ({})),
            createShader: jest.fn(() => ({})),
            shaderSource: jest.fn(),
            compileShader: jest.fn(),
            getShaderParameter: jest.fn(() => true),
            attachShader: jest.fn(),
            linkProgram: jest.fn(),
            useProgram: jest.fn(),
            createVertexArray: jest.fn(() => ({})),
            bindVertexArray: jest.fn(),
            createTexture: jest.fn(() => ({})),
            bindTexture: jest.fn(),
            texParameteri: jest.fn(),
            viewport: jest.fn(),
            texImage2D: jest.fn<void, unknown[]>(),
            texSubImage2D: jest.fn(),
            drawArrays: jest.fn(),
            COLOR_BUFFER_BIT: 0x4000,
            clearColor: jest.fn(),
            clear: jest.fn(),
        };
        const canvas = { width: 300, height: 150, getContext: () => gl };
        const globals = [
            'document',
            'requestAnimationFrame',
            'cancelAnimationFrame',
        ] as const;
        const descriptors = globals.map((name) =>
            Object.getOwnPropertyDescriptor(globalThis, name)
        );
        let nextTick: FrameRequestCallback = () => undefined;
        Object.defineProperty(globalThis, 'document', {
            configurable: true,
            value: { querySelector: () => canvas },
        });
        Object.defineProperty(globalThis, 'requestAnimationFrame', {
            configurable: true,
            value: (callback: FrameRequestCallback) => {
                nextTick = callback;
                return 1;
            },
        });
        Object.defineProperty(globalThis, 'cancelAnimationFrame', {
            configurable: true,
            value: jest.fn(),
        });
        const source = {
            shmName: '/impv-test',
            readerPath: 'embedded-mpv-test-reader',
        };
        jest.mocked(ipcRenderer.invoke).mockResolvedValue(source);
        try {
            expect(await attachEmbeddedMpvFrameView('resize-test')).toBe(true);
            nextTick(0);
            expect(canvas.width).toBe(2);
            gl.texImage2D.mockClear();
            gl.drawArrays.mockClear();
            const listener = jest
                .mocked(ipcRenderer.on)
                .mock.calls.find(
                    ([channel]) => channel === EMBEDDED_MPV_FRAME_SOURCE_CHANGED
                )?.[1] as (
                event: unknown,
                payload: {
                    sessionId: string;
                    source: Partial<EmbeddedMpvFrameSource>;
                }
            ) => void;
            reader.latestSeq.mockReturnValue(0);
            listener(
                {},
                {
                    sessionId: 'resize-test',
                    source: { ...source, shmName: '/impv-test-g2' },
                }
            );
            nextTick(16);
            expect(canvas.width).toBe(2);
            expect(canvas.height).toBe(2);
            expect(gl.texImage2D).not.toHaveBeenCalled();
            reader.latestSeq.mockReturnValue(1);
            reader.copyLatest.mockReturnValueOnce({
                seq: 1,
                ageMs: 0,
                torn: true,
            });
            nextTick(32);
            expect(canvas.width).toBe(2);
            nextTick(48);
            expect(canvas.width).toBe(4);
            expect(canvas.height).toBe(3);
            expect(gl.texImage2D).toHaveBeenCalledTimes(1);
            expect(gl.texImage2D.mock.calls[0][8]).toBeInstanceOf(Uint8Array);
            expect(gl.drawArrays).toHaveBeenCalledTimes(1);
            reader.open.mockReturnValueOnce({
                width: 5,
                height: 3,
                frameBytes: 60,
            });
            reader.open.mockReturnValueOnce({
                width: 6,
                height: 4,
                frameBytes: 96,
            });
            reader.latestSeq.mockReturnValue(0);
            listener(
                {},
                {
                    sessionId: 'resize-test',
                    source: { ...source, shmName: '/impv-test-g3' },
                }
            );
            listener(
                {},
                {
                    sessionId: 'resize-test',
                    source: { ...source, shmName: '/impv-test-g4' },
                }
            );
            nextTick(64);
            expect(canvas.width).toBe(4);
            reader.latestSeq.mockReturnValue(1);
            nextTick(80);
            expect(canvas.width).toBe(6);
            expect(canvas.height).toBe(4);
            expect(gl.texImage2D).toHaveBeenCalledTimes(2);
            reader.latestSeq.mockReturnValue(2);
            reader.copyLatest.mockReturnValueOnce({
                seq: 2,
                ageMs: 0,
                torn: false,
            });
            nextTick(96);
            expect(gl.texImage2D).toHaveBeenCalledTimes(2);
            expect(gl.texSubImage2D).toHaveBeenCalledTimes(1);
            expect(gl.clear).not.toHaveBeenCalled();
            reader.open.mockReturnValueOnce({
                width: 6,
                height: 4,
                frameBytes: 96,
            });
            reader.latestSeq.mockReturnValue(0);
            gl.drawArrays.mockClear();
            const nextAttach = attachEmbeddedMpvFrameView('next-stream-test');
            expect(gl.clearColor).toHaveBeenCalledWith(0, 0, 0, 1);
            expect(gl.clear).toHaveBeenCalledWith(gl.COLOR_BUFFER_BIT);
            expect(await nextAttach).toBe(true);
            nextTick(112);
            expect(gl.drawArrays).not.toHaveBeenCalled();
            reader.latestSeq.mockReturnValue(1);
            nextTick(128);
            expect(gl.drawArrays).toHaveBeenCalledTimes(1);
        } finally {
            detachEmbeddedMpvFrameView();
            globals.forEach((name, index) => {
                const descriptor = descriptors[index];
                if (descriptor)
                    Object.defineProperty(globalThis, name, descriptor);
                else Reflect.deleteProperty(globalThis, name);
            });
        }
    });
});

jest.mock('electron', () => ({
    ipcRenderer: {
        invoke: jest.fn(),
        on: jest.fn(),
    },
}));

import { copyStableLatestFrame } from './embedded-mpv-frame-pump';

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
});

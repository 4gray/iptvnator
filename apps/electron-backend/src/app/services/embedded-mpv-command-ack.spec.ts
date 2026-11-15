import { EmbeddedMpvCommandAck } from './embedded-mpv-command-ack';

describe('frame-copy native command acknowledgement', () => {
    afterEach(() => jest.useRealTimers());
    it('does not finish on enqueue or on another command reply', async () => {
        const ack = new EmbeddedMpvCommandAck();
        const write = jest.fn();
        const done = jest.fn();
        const command = ack.send(write).then(done);
        const id = write.mock.calls[0][0];
        ack.accept({
            event: 'command-result',
            requestId: 'unrelated',
            success: true,
        });
        await Promise.resolve();
        expect(done).not.toHaveBeenCalled();
        ack.accept({ event: 'command-result', requestId: id, success: true });
        await command;
        expect(done).toHaveBeenCalledTimes(1);
    });
    it('rejects native failures and settles pending work on close', async () => {
        const ack = new EmbeddedMpvCommandAck();
        const write = jest.fn();
        const failed = ack.send(write);
        const assertion = expect(failed).rejects.toThrow('rejected');
        ack.accept({
            event: 'command-result',
            requestId: write.mock.calls[0][0],
            success: false,
        });
        await assertion;
        const closing = ack.send(write);
        const closed = expect(closing).rejects.toThrow('closed');
        ack.close();
        await closed;
    });
    it('bounds a missing native acknowledgement', async () => {
        jest.useFakeTimers();
        const ack = new EmbeddedMpvCommandAck();
        const result = expect(ack.send(() => undefined)).rejects.toThrow(
            'timed out'
        );
        jest.advanceTimersByTime(3000);
        await result;
    });
});

import { Readable } from 'node:stream';
import { probeM3uSource } from './m3u-source-probe';
import { requestWithValidatedRedirects } from '../util/validated-axios';
jest.mock('electron', () => ({ ipcMain: { handle: jest.fn() } }));
jest.mock('../util/validated-axios', () => ({
    requestWithValidatedRedirects: jest.fn(),
}));
jest.mock('../util/secure-https', () => ({
    createPlaylistAgentFactory: jest.fn(),
}));
const request = jest.mocked(requestWithValidatedRedirects);
const payload = () => ({
    url: 'https://example.test/list',
    userAgent: 'TestAgent',
    probe: { requestId: 'test', deadlineAt: Date.now() + 5000 },
});
describe('bounded M3U source probe', () => {
    beforeEach(() => jest.clearAllMocks());
    function answer(body: string, status = 200) {
        const stream = Readable.from([Buffer.from(body)]);
        request.mockResolvedValueOnce({ data: stream, status } as never);
        return stream;
    }
    it('checks content and closes the stream without parsing the full list', async () => {
        const stream = answer('#EXTM3U\n' + 'x'.repeat(100000));
        expect((await probeM3uSource(payload(), 1)).state).toBe('active');
        expect(stream.destroyed).toBe(true);
        expect(request).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                headers: { 'User-Agent': 'TestAgent', Range: 'bytes=0-65535' },
                signal: expect.any(AbortSignal),
            }),
            expect.any(Object)
        );
    });
    it('rejects HTML served with HTTP 200', async () => {
        answer('<html>login required</html>');
        expect((await probeM3uSource(payload(), 1)).reason).toBe('invalid');
    });
    it('falls back only after an explicit range refusal', async () => {
        const first = answer('', 416);
        answer('#EXTM3U\n');
        expect((await probeM3uSource(payload(), 1)).state).toBe('active');
        expect(first.destroyed).toBe(true);
        expect(request.mock.calls[1][1]?.headers).not.toHaveProperty('Range');
    });
    it('does not retry an auth failure or preselect it for deletion', async () => {
        answer('Forbidden', 403);
        expect(await probeM3uSource(payload(), 1)).toMatchObject({
            reason: 'auth',
            confirmedInactive: false,
        });
        expect(request).toHaveBeenCalledTimes(1);
    });
    it('bounds a response that ignores Range', async () => {
        const stream = answer('x'.repeat(1000000));
        expect((await probeM3uSource(payload(), 1)).reason).toBe('unknown');
        expect(stream.destroyed).toBe(true);
    });
});

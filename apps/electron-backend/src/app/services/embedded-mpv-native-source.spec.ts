import { readFileSync } from 'fs';
import path from 'path';

describe('Embedded MPV native source recording invariants', () => {
    const nativeSource = readFileSync(
        path.resolve(__dirname, '../../../native/src/embedded_mpv.mm'),
        'utf8'
    );

    function functionBody(name: string): string {
        const start = nativeSource.indexOf(`Napi::Value ${name}(`);
        expect(start).toBeGreaterThanOrEqual(0);

        const bodyStart = nativeSource.indexOf('{', start);
        expect(bodyStart).toBeGreaterThanOrEqual(0);

        let depth = 0;
        for (let index = bodyStart; index < nativeSource.length; index += 1) {
            if (nativeSource[index] === '{') {
                depth += 1;
            }
            if (nativeSource[index] === '}') {
                depth -= 1;
            }
            if (depth === 0) {
                return nativeSource.slice(bodyStart, index + 1);
            }
        }

        throw new Error(`Unable to read ${name} body.`);
    }

    it('tracks LoadPlayback recording auto-stop replies through the reconciler', () => {
        const body = functionBody('LoadPlayback');

        expect(body).toContain(
            'const uint64_t stopRecordingRequestId = nextAsyncRequestId();'
        );
        expect(body).toContain(
            'session->pendingRecordingStopRequestId = stopRecordingRequestId;'
        );
        expect(body).toContain(
            'session->pendingRecordingStopStartedAt =\n' +
                '                session->snapshot.recordingStartedAt;'
        );
        expect(body).toContain('stopRecordingRequestId,');
    });
});

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

    it('maps successful MPV end-file events to an ended session status', () => {
        expect(nativeSource).toContain('Ended,');
        expect(nativeSource).toContain('case SessionStatus::Ended:');

        const eventLoopBodyStart = nativeSource.indexOf('void runEventLoop(');
        expect(eventLoopBodyStart).toBeGreaterThanOrEqual(0);
        const endFileCaseStart = nativeSource.indexOf(
            'case MPV_EVENT_END_FILE',
            eventLoopBodyStart
        );
        expect(endFileCaseStart).toBeGreaterThanOrEqual(0);
        const nextCaseStart = nativeSource.indexOf(
            'case MPV_EVENT_PROPERTY_CHANGE',
            endFileCaseStart
        );
        expect(nextCaseStart).toBeGreaterThan(endFileCaseStart);

        const endFileCase = nativeSource.slice(endFileCaseStart, nextCaseStart);
        expect(endFileCase).toContain('SessionStatus::Ended');
        expect(endFileCase).toContain('MPV_END_FILE_REASON_EOF');
    });
});

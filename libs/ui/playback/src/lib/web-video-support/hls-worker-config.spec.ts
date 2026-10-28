import { hlsWorkerConfig } from './hls-worker-config';

describe('hlsWorkerConfig', () => {
    it('points hls.js at its worker from the base href, not the current route', () => {
        expect(
            hlsWorkerConfig({ baseURI: 'http://127.0.0.1:43330/' }, 'http:')
        ).toEqual({ workerPath: 'http://127.0.0.1:43330/assets/hls.worker.js' });
        expect(
            hlsWorkerConfig({ baseURI: 'https://tv.example/app/' }, 'https:')
        ).toEqual({ workerPath: 'https://tv.example/app/assets/hls.worker.js' });
    });

    it('keeps the inline path outside http(s), as in Electron', () => {
        expect(hlsWorkerConfig({ baseURI: 'file:///app/' }, 'file:')).toEqual({});
        expect(
            hlsWorkerConfig({ baseURI: 'app://iptvnator/' }, 'app:')
        ).toEqual({});
    });
});

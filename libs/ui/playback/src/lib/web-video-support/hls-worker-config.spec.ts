import Hls from 'hls.js';
import { hlsWorkerConfig } from './hls-worker-config';

describe('hlsWorkerConfig', () => {
    const noOptOut = { getItem: () => null };

    it('points hls.js at its worker from the base href, versioned with the bundle', () => {
        expect(
            hlsWorkerConfig(
                { baseURI: 'http://127.0.0.1:43330/' },
                'http:',
                noOptOut
            )
        ).toEqual({
            workerPath: `http://127.0.0.1:43330/assets/hls.worker.js?v=${Hls.version}`,
        });
        expect(
            hlsWorkerConfig(
                { baseURI: 'https://tv.example/app/' },
                'https:',
                noOptOut
            )
        ).toEqual({
            workerPath: `https://tv.example/app/assets/hls.worker.js?v=${Hls.version}`,
        });
    });

    it('keeps the inline path outside http(s), as in Electron', () => {
        expect(
            hlsWorkerConfig({ baseURI: 'file:///app/' }, 'file:', noOptOut)
        ).toEqual({});
        expect(
            hlsWorkerConfig({ baseURI: 'app://iptvnator/' }, 'app:', noOptOut)
        ).toEqual({});
    });

    it('keeps the inline path when the opt-out is set', () => {
        expect(
            hlsWorkerConfig({ baseURI: 'http://127.0.0.1:43330/' }, 'http:', {
                getItem: (key: string) =>
                    key === 'iptvnator.hlsInlineTransmux' ? '1' : null,
            })
        ).toEqual({});
    });
});

import { PlaybackHistoryGate } from './playback-history-gate.service';
let instance = 'synthetic-nas';
jest.mock('@iptvnator/services/source-sync/connection', () => ({
    sourceConnection: () => ({ instanceId: instance }),
}));
describe('history confirmation source ownership', () => {
    beforeEach(() => {
        instance = 'synthetic-nas';
        localStorage.clear();
    });
    it('drops confirmation from an old source incarnation but keeps an unrelated source', () => {
        const gate = new PlaybackHistoryGate();
        const old = jest.fn(),
            unrelated = jest.fn();
        gate.defer(
            {
                sourceId: 'source',
                streamUrls: ['https://synthetic.invalid/old'],
            },
            old
        );
        gate.defer(
            {
                sourceId: 'other',
                streamUrls: ['https://synthetic.invalid/other'],
            },
            unrelated
        );
        localStorage.setItem(
            'iptvnator-server:synthetic-nas:history-source-epoch:source',
            'replacement'
        );
        gate.confirm({
            streamUrls: [
                'https://synthetic.invalid/old',
                'https://synthetic.invalid/other',
            ],
        });
        expect(old).not.toHaveBeenCalled();
        expect(unrelated).toHaveBeenCalledTimes(1);
    });
    it('drops confirmation after a profile switch', () => {
        const gate = new PlaybackHistoryGate();
        const commit = jest.fn();
        gate.defer({ sourceId: 'source', sessionKey: 'session' }, commit);
        instance = 'another-nas';
        gate.confirm({ sessionKey: 'session' });
        expect(commit).not.toHaveBeenCalled();
    });
});

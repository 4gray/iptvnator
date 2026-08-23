import { AUTO_QUALITY_LEVEL_ID, type PlayerTrack } from './player-controls.model';
import { WebVideoControlsAdapter } from './web-video-controls.adapter';

function createVideo(): HTMLVideoElement {
    const video = document.createElement('video');
    Object.defineProperties(video, {
        duration: { configurable: true, value: 120 },
        readyState: { configurable: true, value: 4 },
        networkState: { configurable: true, value: 1 },
        paused: { configurable: true, value: true },
        seekable: { configurable: true, value: { length: 1 } },
    });
    return video;
}

const TWO_LEVELS: PlayerTrack[] = [
    { id: 0, label: '1080p', selected: false },
    { id: 1, label: '720p', selected: false },
];

describe('WebVideoControlsAdapter quality levels', () => {
    let adapter: WebVideoControlsAdapter;

    beforeEach(() => {
        adapter = new WebVideoControlsAdapter();
    });

    afterEach(() => adapter.detach());

    it('advertises the capability only for a multi-rendition source', () => {
        let levels: PlayerTrack[] = TWO_LEVELS;
        adapter.attach(createVideo(), {
            getQualityLevels: () => levels,
            setQualityLevel: () => undefined,
        });
        expect(adapter.capabilities().qualityLevels).toBe(true);

        levels = [TWO_LEVELS[0]];
        adapter.refresh();
        expect(adapter.capabilities().qualityLevels).toBe(false);
    });

    it('advertises no capability without a setter or without accessors', () => {
        adapter.attach(createVideo(), {
            getQualityLevels: () => TWO_LEVELS,
        });
        expect(adapter.capabilities().qualityLevels).toBe(false);
        expect(adapter.state().qualityLevels).toEqual(TWO_LEVELS);

        adapter.attach(createVideo(), {});
        expect(adapter.capabilities().qualityLevels).toBe(false);
        expect(adapter.state().qualityLevels).toEqual([]);
        expect(adapter.state().qualityAutoEnabled).toBe(true);
    });

    it('projects the auto flag and level list into state', () => {
        let auto = true;
        adapter.attach(createVideo(), {
            getQualityLevels: () => TWO_LEVELS,
            setQualityLevel: () => undefined,
            isAutoQualityEnabled: () => auto,
        });
        expect(adapter.state().qualityAutoEnabled).toBe(true);

        auto = false;
        adapter.refresh();
        expect(adapter.state().qualityAutoEnabled).toBe(false);
    });

    it('routes the command through the setter and refreshes', () => {
        let levels = TWO_LEVELS;
        const setQualityLevel = jest.fn((id: number) => {
            levels = levels.map((level) => ({
                ...level,
                selected: level.id === id,
            }));
        });
        adapter.attach(createVideo(), {
            getQualityLevels: () => levels,
            setQualityLevel,
        });

        adapter.commands.setQualityLevel(1);
        expect(setQualityLevel).toHaveBeenCalledWith(1);
        expect(adapter.state().qualityLevels[1].selected).toBe(true);

        adapter.commands.setQualityLevel(AUTO_QUALITY_LEVEL_ID);
        expect(setQualityLevel).toHaveBeenCalledWith(AUTO_QUALITY_LEVEL_ID);
    });

    it('contains a synchronous setter exception', () => {
        adapter.attach(createVideo(), {
            getQualityLevels: () => TWO_LEVELS,
            setQualityLevel: () => {
                throw new Error('engine changing source');
            },
        });

        expect(() => adapter.commands.setQualityLevel(0)).not.toThrow();
    });
});

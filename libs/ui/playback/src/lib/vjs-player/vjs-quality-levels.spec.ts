import type {
    VideoJsQualityLevel,
    VideoJsQualityLevelList,
} from './vjs-player.types';
import { VjsQualityLevels } from './vjs-quality-levels';

class FakeQualityLevelList {
    private readonly listeners = new Map<
        string,
        Set<EventListenerOrEventListenerObject>
    >();
    private levels: VideoJsQualityLevel[] = [];

    readonly addEventListener = jest.fn(
        (event: string, listener: EventListenerOrEventListenerObject): void => {
            const eventListeners =
                this.listeners.get(event) ??
                new Set<EventListenerOrEventListenerObject>();
            eventListeners.add(listener);
            this.listeners.set(event, eventListeners);
        }
    );

    readonly removeEventListener = jest.fn(
        (event: string, listener: EventListenerOrEventListenerObject): void => {
            this.listeners.get(event)?.delete(listener);
        }
    );

    get length(): number {
        return this.levels.length;
    }

    replace(levels: VideoJsQualityLevel[]): void {
        for (let index = 0; index < this.levels.length; index += 1) {
            Reflect.deleteProperty(this, index);
        }
        this.levels = levels;
        levels.forEach((level, index) => {
            Object.defineProperty(this, index, {
                configurable: true,
                enumerable: true,
                value: level,
            });
        });
    }

    emit(eventName: string): void {
        const event = new Event(eventName);
        for (const listener of this.listeners.get(eventName) ?? []) {
            if (typeof listener === 'function') {
                listener.call(this, event);
            } else {
                listener.handleEvent(event);
            }
        }
    }

    asList(): VideoJsQualityLevelList {
        return this as unknown as VideoJsQualityLevelList;
    }
}

function createHarness(levels: VideoJsQualityLevel[]) {
    const levelList = new FakeQualityLevelList();
    levelList.replace(levels);
    const refresh = jest.fn();
    const helper = new VjsQualityLevels({
        player: { qualityLevels: () => levelList.asList() },
        refresh,
    });
    helper.bind();
    return { helper, levelList, refresh };
}

function level(
    facts: Partial<VideoJsQualityLevel> = {}
): VideoJsQualityLevel {
    return { enabled: true, ...facts };
}

describe('VjsQualityLevels', () => {
    it('projects labelled levels with auto derived from all-enabled', () => {
        const { helper } = createHarness([
            level({ height: 1080, bitrate: 8_000_000 }),
            level({ height: 720, bitrate: 4_000_000 }),
        ]);

        expect(helper.isAutoQualityEnabled()).toBe(true);
        expect(helper.getQualityLevels()).toEqual([
            { id: 0, label: '1080p', selected: false },
            { id: 1, label: '720p', selected: false },
        ]);
    });

    it('enables exactly one level for a manual selection', () => {
        const { helper, levelList } = createHarness([
            level({ height: 1080 }),
            level({ height: 720 }),
            level({ height: 480 }),
        ]);

        helper.setQualityLevel(1);

        expect([0, 1, 2].map((i) => levelList.asList()[i]?.enabled)).toEqual([
            false,
            true,
            false,
        ]);
        expect(helper.isAutoQualityEnabled()).toBe(false);
        expect(helper.getQualityLevels()[1].selected).toBe(true);
    });

    it('re-enables every level for the auto sentinel', () => {
        const { helper, levelList } = createHarness([
            level({ height: 1080 }),
            level({ height: 720 }),
        ]);
        helper.setQualityLevel(0);

        helper.setQualityLevel(-1);

        expect([0, 1].map((i) => levelList.asList()[i]?.enabled)).toEqual([
            true,
            true,
        ]);
        expect(helper.isAutoQualityEnabled()).toBe(true);
        expect(
            helper.getQualityLevels().some((entry) => entry.selected)
        ).toBe(false);
    });

    it('ignores invalid and out-of-range ids', () => {
        const { helper, levelList } = createHarness([
            level({ height: 1080 }),
            level({ height: 720 }),
        ]);

        helper.setQualityLevel(2);
        helper.setQualityLevel(-2);
        helper.setQualityLevel(0.5);
        helper.setQualityLevel(NaN);

        expect([0, 1].map((i) => levelList.asList()[i]?.enabled)).toEqual([
            true,
            true,
        ]);
        expect(helper.isAutoQualityEnabled()).toBe(true);
    });

    it('treats a single-level list as auto even when only it is enabled', () => {
        const { helper } = createHarness([level({ height: 720 })]);
        expect(helper.isAutoQualityEnabled()).toBe(true);
        expect(helper.getQualityLevels()[0].selected).toBe(false);
    });

    it('does not mistake VHS error-exclusions for a manual selection', () => {
        const levels = [
            level({ height: 1080 }),
            level({ height: 720 }),
            level({ height: 480 }),
        ];
        const { helper } = createHarness(levels);

        // VHS excludes failing renditions by flipping `enabled` off itself;
        // only one survivor must still read as auto, not as a user pick.
        levels[0].enabled = false;
        levels[2].enabled = false;

        expect(helper.isAutoQualityEnabled()).toBe(true);
        expect(
            helper.getQualityLevels().some((entry) => entry.selected)
        ).toBe(false);
    });

    it('reverts to auto and re-enables survivors when the picked level leaves the list', () => {
        const survivorA = level({ height: 1080 });
        const picked = level({ height: 720 });
        const survivorB = level({ height: 480 });
        const { helper, levelList } = createHarness([
            survivorA,
            picked,
            survivorB,
        ]);

        helper.setQualityLevel(1);
        expect([survivorA.enabled, survivorB.enabled]).toEqual([false, false]);

        // The list drops the picked rendition but keeps the (still disabled)
        // survivors; reverting to auto must give ABR renditions back.
        levelList.replace([survivorA, survivorB]);
        levelList.emit('removequalitylevel');

        expect(helper.isAutoQualityEnabled()).toBe(true);
        expect([survivorA.enabled, survivorB.enabled]).toEqual([true, true]);
        expect(
            helper.getQualityLevels().some((entry) => entry.selected)
        ).toBe(false);
    });

    it('re-enables survivors lazily when no removal event was observed', () => {
        const survivor = level({ height: 1080 });
        const picked = level({ height: 720 });
        const { helper, levelList } = createHarness([survivor, picked]);

        helper.setQualityLevel(1);
        levelList.replace([survivor]);

        expect(helper.isAutoQualityEnabled()).toBe(true);
        expect(survivor.enabled).toBe(true);
    });

    it('forgets manual intent on resetSource', () => {
        const { helper } = createHarness([
            level({ height: 1080 }),
            level({ height: 720 }),
        ]);

        helper.setQualityLevel(0);
        expect(helper.isAutoQualityEnabled()).toBe(false);

        helper.resetSource();
        expect(helper.isAutoQualityEnabled()).toBe(true);
    });

    it('refreshes on list events and detaches exact listeners on clear', () => {
        const { helper, levelList, refresh } = createHarness([
            level({ height: 720 }),
        ]);

        levelList.emit('addqualitylevel');
        levelList.emit('removequalitylevel');
        levelList.emit('change');
        expect(refresh).toHaveBeenCalledTimes(3);

        helper.clear();
        expect(levelList.removeEventListener).toHaveBeenCalledTimes(3);
        for (const [event, listener] of levelList.addEventListener.mock
            .calls) {
            expect(levelList.removeEventListener).toHaveBeenCalledWith(
                event,
                listener
            );
        }
        expect(helper.getQualityLevels()).toEqual([]);
    });

    it('survives a missing or throwing qualityLevels plugin', () => {
        const withoutPlugin = new VjsQualityLevels({
            player: {},
            refresh: jest.fn(),
        });
        withoutPlugin.bind();
        expect(withoutPlugin.getQualityLevels()).toEqual([]);
        expect(withoutPlugin.isAutoQualityEnabled()).toBe(true);
        expect(() => withoutPlugin.setQualityLevel(0)).not.toThrow();

        const throwing = new VjsQualityLevels({
            player: {
                qualityLevels: () => {
                    throw new Error('plugin unavailable');
                },
            },
            refresh: jest.fn(),
        });
        throwing.bind();
        expect(throwing.getQualityLevels()).toEqual([]);
    });
});

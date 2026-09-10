import {
    AUTO_QUALITY_LEVEL_ID,
    type PlayerTrack,
} from '../player-controls/player-controls.model';
import { positiveOrNull } from '../player-controls/positive-number.util';
import type { WebVideoEngineStats } from '../player-controls/web-video-stream-stats';
import { buildQualityLevelLabels } from '../web-video-support/quality-level-labels';
import type {
    VideoJsPlayer,
    VideoJsQualityLevel,
    VideoJsQualityLevelList,
} from './vjs-player.types';

const QUALITY_LEVEL_LISTENERS = [
    'addqualitylevel',
    'removequalitylevel',
    'change',
] as const;

export type VjsQualityLevelPlayer = Pick<VideoJsPlayer, 'qualityLevels'>;

export interface VjsQualityLevelsConfig {
    player: VjsQualityLevelPlayer;
    refresh: () => void;
}

/**
 * Projects the videojs-contrib-quality-levels list onto the shared-controls
 * quality contract, mirroring {@link VjsAudioTracks}. VHS has no manual-level
 * setter; a manual selection enables exactly one level and auto re-enables all.
 * Manual intent is tracked explicitly by the picked level object — VHS also
 * flips `enabled` off for renditions it temporarily excludes after delivery
 * errors, so inferring the mode from the enabled count would report a manual
 * selection the user never made. Object identity (not an index) keeps the
 * intent valid across list mutations, and a picked level that leaves the list
 * reverts to auto. Ids are list indices for the current snapshot.
 */
export class VjsQualityLevels {
    private levelList: VideoJsQualityLevelList | null = null;
    private manualLevel: VideoJsQualityLevel | null = null;
    private readonly handleListChange: EventListener = () => {
        this.readManualLevel(this.listLevels());
        this.config.refresh();
    };

    constructor(private readonly config: VjsQualityLevelsConfig) {}

    bind(): void {
        const levelList = this.readLevelList();
        if (levelList === this.levelList) {
            return;
        }

        this.detachLevelList();
        this.levelList = levelList;
        if (typeof levelList?.addEventListener !== 'function') {
            return;
        }

        for (const eventName of QUALITY_LEVEL_LISTENERS) {
            levelList.addEventListener(eventName, this.handleListChange);
        }
    }

    clear(): void {
        this.detachLevelList();
        this.levelList = null;
        this.manualLevel = null;
    }

    /** Forgets manual intent when the bridge activates a new source. */
    resetSource(): void {
        this.manualLevel = null;
    }

    getQualityLevels(): PlayerTrack[] {
        const levels = this.listLevels();
        const labels = buildQualityLevelLabels(levels);
        const manualLevel = this.readManualLevel(levels);
        return levels.map((level, index) => ({
            id: index,
            label: labels[index],
            selected: level === manualLevel,
        }));
    }

    setQualityLevel(id: number): void {
        if (!Number.isInteger(id)) {
            return;
        }

        const levels = this.listLevels();
        if (id === AUTO_QUALITY_LEVEL_ID) {
            this.manualLevel = null;
            for (const level of levels) {
                level.enabled = true;
            }
            return;
        }
        if (id < 0 || id >= levels.length) {
            return;
        }

        this.manualLevel = levels[id];
        levels.forEach((level, index) => {
            level.enabled = index === id;
        });
    }

    isAutoQualityEnabled(): boolean {
        return this.readManualLevel(this.listLevels()) === null;
    }

    /**
     * Bitrate/size of the rendition VHS is currently playing, for the
     * stream-info popover. `selectedIndex` is VHS's own answer to "which one
     * is on screen", so it stays correct under ABR as well as manual picks.
     *
     * Read-only, unlike everything else here. It lives on this collaborator
     * rather than in its own file (the way `WebVideoSourceStats` is split off
     * from `WebVideoSourceTracks`) because the VHS level list has no accessor
     * of its own: splitting it would mean publishing `levelList` purely to
     * describe it.
     */
    getActiveLevelStats(): WebVideoEngineStats | null {
        const selectedIndex = this.levelList?.selectedIndex ?? -1;
        const level =
            selectedIndex >= 0 ? this.listLevels()[selectedIndex] : undefined;
        if (!level) {
            return null;
        }

        return {
            streamBitrateBps: positiveOrNull(level.bitrate),
            width: positiveOrNull(level.width),
            height: positiveOrNull(level.height),
        };
    }

    private readManualLevel(
        levels: VideoJsQualityLevel[]
    ): VideoJsQualityLevel | null {
        if (this.manualLevel && !levels.includes(this.manualLevel)) {
            // The picked rendition left the list (source change or removal):
            // there is nothing the intent can hold on to, so revert to auto —
            // including re-enabling the survivors the manual pick disabled,
            // or ABR would be left with no selectable rendition.
            this.manualLevel = null;
            for (const level of levels) {
                level.enabled = true;
            }
        }
        return this.manualLevel;
    }

    private listLevels(): VideoJsQualityLevel[] {
        const levelList = this.levelList;
        if (!levelList) {
            return [];
        }

        const levels: VideoJsQualityLevel[] = [];
        for (let index = 0; index < levelList.length; index += 1) {
            const level = levelList[index];
            if (level) {
                levels.push(level);
            }
        }
        return levels;
    }

    private readLevelList(): VideoJsQualityLevelList | null {
        try {
            return this.config.player.qualityLevels?.() ?? null;
        } catch {
            return null;
        }
    }

    private detachLevelList(): void {
        const levelList = this.levelList;
        if (typeof levelList?.removeEventListener !== 'function') {
            return;
        }

        for (const eventName of QUALITY_LEVEL_LISTENERS) {
            levelList.removeEventListener(eventName, this.handleListChange);
        }
    }
}

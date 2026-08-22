import {
    AUTO_QUALITY_LEVEL_ID,
    type PlayerTrack,
} from '../player-controls/player-controls.model';
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
 * setter; a manual selection enables exactly one level and auto re-enables all,
 * so the mode is derived statelessly: manual iff exactly one level is enabled.
 * Ids are list indices, valid for the lifetime of the current source.
 */
export class VjsQualityLevels {
    private levelList: VideoJsQualityLevelList | null = null;
    private readonly handleListChange: EventListener = () => {
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
    }

    getQualityLevels(): PlayerTrack[] {
        const levels = this.listLevels();
        const labels = buildQualityLevelLabels(levels);
        const manualIndex = this.readManualIndex(levels);
        return levels.map((_level, index) => ({
            id: index,
            label: labels[index],
            selected: index === manualIndex,
        }));
    }

    setQualityLevel(id: number): void {
        if (!Number.isInteger(id)) {
            return;
        }

        const levels = this.listLevels();
        if (id === AUTO_QUALITY_LEVEL_ID) {
            for (const level of levels) {
                level.enabled = true;
            }
            return;
        }
        if (id < 0 || id >= levels.length) {
            return;
        }

        levels.forEach((level, index) => {
            level.enabled = index === id;
        });
    }

    isAutoQualityEnabled(): boolean {
        return this.readManualIndex(this.listLevels()) === null;
    }

    private readManualIndex(levels: VideoJsQualityLevel[]): number | null {
        const enabled = levels
            .map((level, index) => ({ level, index }))
            .filter(({ level }) => level.enabled === true);
        return enabled.length === 1 && levels.length > 1
            ? enabled[0].index
            : null;
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

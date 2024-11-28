import 'jest-extended';

declare module 'video.js' {
    export interface VideoJsPlayer {
        hlsQualitySelector(options?: any): void;
    }
}

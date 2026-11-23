import { applyVideoFit } from './video-fit';

describe('video fit restoration', () => {
    it.each(['crop', 'stretch'] as const)('%s restores prior inline values and priorities', (mode) => {
        const video = document.createElement('video');
        video.style.setProperty('width', '73%', 'important');
        video.style.setProperty('object-fit', 'contain');
        const original = video.style.cssText;

        const restore = applyVideoFit(video, mode);
        expect(video.style.getPropertyValue('object-fit')).toBe(mode === 'crop' ? 'cover' : 'fill');
        expect(video.style.getPropertyPriority('width')).toBe('important');
        restore();
        expect(video.style.cssText).toBe(original);
    });

    it.each(['crop', 'stretch'] as const)('restores Original after switching from %s', (mode) => {
        const video = document.createElement('video');
        video.style.setProperty('width', '80%');
        const original = video.style.cssText;

        applyVideoFit(video, mode)();
        applyVideoFit(video, 'original')();

        expect(video.style.cssText).toBe(original);
    });
});

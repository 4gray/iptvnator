import { applyVideoFit } from './video-fit';

describe('video fit', () => {
    it('uses proportional cover for Crop and unconstrained fill for Stretch', () => {
        const video = document.createElement('video');
        video.style.setProperty('object-fit', 'contain');
        video.style.setProperty('width', '90%', 'important');
        const original = video.style.cssText;
        const restoreCrop = applyVideoFit(video, 'crop');
        expect(video.style.objectFit).toBe('cover');
        expect(video.style.width).toBe('100%');
        expect(video.style.height).toBe('100%');
        restoreCrop();
        expect(video.style.cssText).toBe(original);
        const restoreStretch = applyVideoFit(video, 'stretch');
        expect(video.style.objectFit).toBe('fill');
        restoreStretch();
        expect(video.style.cssText).toBe(original);
    });

    it('leaves Original untouched and removes properties absent before fit', () => {
        const video = document.createElement('video');
        applyVideoFit(video, 'original')();
        expect(video.style.cssText).toBe('');
        applyVideoFit(video, 'crop')();
        expect(video.style.cssText).toBe('');
    });
});

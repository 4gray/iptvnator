import { audioTrackLabel, subtitleTrackLabel } from './embedded-mpv-labels';

describe('embedded MPV labels', () => {
    it('builds readable audio/subtitle track labels', () => {
        expect(
            audioTrackLabel(
                {
                    id: 1,
                    language: 'eng',
                    selected: false,
                    defaultTrack: true,
                },
                0
            )
        ).toContain('Default');
        expect(
            subtitleTrackLabel({ id: 2, selected: false }, 1)
        ).toContain('Subtitle 2');
    });
});

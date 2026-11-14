import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import { liveItem, movieItem } from './multiview-picker.fixtures';
import { toPickerRow } from './multiview-picker-row';
import {
    composePickerSections,
    defaultPickerSection,
    type MultiviewPickerSection,
    type MultiviewPickerSources,
} from './multiview-picker-sections';

function sources(
    overrides: Partial<MultiviewPickerSources> = {}
): MultiviewPickerSources {
    return {
        favorites: [],
        recent: [],
        continueItems: [],
        playlist: [],
        isAllowed: () => true,
        toRow: (item, position) => toPickerRow(item, [], { position }),
        ...overrides,
    };
}

const names = (section: MultiviewPickerSection | undefined) =>
    section?.groups.map((group) => [
        group.id,
        group.rows.map((row) => row.item.name),
    ]);

const byId = (sections: MultiviewPickerSection[], id: string) =>
    sections.find((section) => section.id === id);

describe('composePickerSections', () => {
    it('lists the sections in navigation order', () => {
        expect(composePickerSections(sources()).map((s) => s.id)).toEqual([
            'live-now',
            'continue',
            'favorites',
            'recent',
            'playlist',
        ]);
    });

    it('builds Live now from favourites, then recent, then the playlist (D9)', () => {
        const sections = composePickerSections(
            sources({
                favorites: [liveItem(1), movieItem(9)],
                recent: [liveItem(3), liveItem(1), movieItem(8)],
                playlist: [liveItem(2), liveItem(3), liveItem(4)],
            })
        );

        expect(names(byId(sections, 'live-now'))).toEqual([
            ['from-favorites', ['Synthetic Channel 1']],
            [
                'more-on-air',
                [
                    'Synthetic Channel 3',
                    'Synthetic Channel 2',
                    'Synthetic Channel 4',
                ],
            ],
        ]);
        expect(byId(sections, 'live-now')?.count).toBe(4);
    });

    it('drops empty groups', () => {
        const sections = composePickerSections(
            sources({ playlist: [liveItem(2)] })
        );

        expect(names(byId(sections, 'live-now'))).toEqual([
            ['more-on-air', ['Synthetic Channel 2']],
        ]);
    });

    it('applies the parental lock and leaves radio out of every section (R11)', () => {
        const locked = liveItem(5);
        const radio = liveItem(6, { radio: 'true' });
        const sections = composePickerSections(
            sources({
                favorites: [locked, radio, liveItem(1)],
                recent: [locked, radio],
                playlist: [locked, radio, liveItem(2)],
                isAllowed: (item: UnifiedCollectionItem) => item !== locked,
            })
        );

        for (const section of sections) {
            const listed = section.groups.flatMap((g) =>
                g.rows.map((r) => r.item)
            );
            expect(listed).not.toContain(locked);
            expect(listed).not.toContain(radio);
        }
        expect(byId(sections, 'favorites')?.count).toBe(1);
        expect(byId(sections, 'playlist')?.count).toBe(1);
    });

    it('keeps favourites and recent with all content types', () => {
        const sections = composePickerSections(
            sources({
                favorites: [liveItem(1), movieItem(2)],
                recent: [movieItem(3, { contentType: 'series' })],
            })
        );

        expect(byId(sections, 'favorites')?.count).toBe(2);
        expect(byId(sections, 'recent')?.groups[0].rows[0].kind).toBeNull();
    });

    it('carries the resume point of Continue rows', () => {
        const position = {
            contentXtreamId: 4,
            contentType: 'vod',
            positionSeconds: 754,
        } as PlaybackPositionData;
        const sections = composePickerSections(
            sources({ continueItems: [{ item: movieItem(4), position }] })
        );

        expect(byId(sections, 'continue')?.groups[0].rows[0].position).toBe(
            position
        );
    });
});

describe('defaultPickerSection', () => {
    it('opens on Live now next to a film and on Continue next to a channel', () => {
        expect(defaultPickerSection('vod', null)).toBe('live-now');
        expect(defaultPickerSection('episode', null)).toBe('live-now');
        expect(defaultPickerSection('live', null)).toBe('continue');
        expect(defaultPickerSection(null, null)).toBe('live-now');
    });

    it('then opens on the section the viewer used last', () => {
        expect(defaultPickerSection('live', 'favorites')).toBe('favorites');
    });
});

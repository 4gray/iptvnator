import {
    findOpaqueTunnelCovers,
    isOpaqueBackgroundColor,
    warnOnOpaqueTunnelCovers,
} from './embedded-mpv-tunnel-guard';

const RECT = { x: 100, y: 50, width: 640, height: 360 };

/** Fake element with a fixed computed background-color. */
function fakeElement(background: string, className = ''): Element {
    return {
        tagName: 'DIV',
        id: '',
        className,
        __background: background,
    } as unknown as Element;
}

/** Fake Document whose elementsFromPoint returns the given stack. */
function fakeDocument(stack: Element[]): Document {
    return {
        elementsFromPoint: jest.fn().mockReturnValue(stack),
        defaultView: {
            getComputedStyle: (element: Element) => ({
                backgroundColor: (
                    element as unknown as { __background: string }
                ).__background,
            }),
        },
    } as unknown as Document;
}

describe('isOpaqueBackgroundColor', () => {
    it.each([
        ['rgb(0, 0, 0)', true],
        ['rgba(0, 0, 0, 1)', true],
        ['rgba(18, 18, 18, 0.95)', false],
        ['rgba(0, 0, 0, 0)', false], // computed `transparent`
        ['transparent', false],
        ['', false],
    ])('classifies %s as opaque=%s', (color, expected) => {
        expect(isOpaqueBackgroundColor(color)).toBe(expected);
    });
});

describe('findOpaqueTunnelCovers', () => {
    it('samples the rect center', () => {
        const doc = fakeDocument([]);
        findOpaqueTunnelCovers(RECT, doc);
        expect(doc.elementsFromPoint).toHaveBeenCalledWith(420, 230);
    });

    it('returns only elements with an opaque background', () => {
        const opaque = fakeElement('rgb(0, 0, 0)', 'video-player');
        const doc = fakeDocument([
            fakeElement('rgba(0, 0, 0, 0)', 'cutout'),
            opaque,
            fakeElement('rgba(0, 0, 0, 0)', 'workspace-content'),
        ]);
        expect(findOpaqueTunnelCovers(RECT, doc)).toEqual([opaque]);
    });

    it('is a no-op when elementsFromPoint is unavailable (jsdom)', () => {
        expect(
            findOpaqueTunnelCovers(RECT, {} as unknown as Document)
        ).toEqual([]);
    });
});

describe('warnOnOpaqueTunnelCovers', () => {
    it('warns with element descriptions when an opaque cover is found', () => {
        const warn = jest.fn();
        const doc = fakeDocument([fakeElement('rgb(0, 0, 0)', 'video-player')]);
        warnOnOpaqueTunnelCovers(RECT, doc, warn);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('cover the immersive tunnel'),
            ['div.video-player']
        );
    });

    it('stays silent when the tunnel is clean', () => {
        const warn = jest.fn();
        const doc = fakeDocument([
            fakeElement('rgba(0, 0, 0, 0)'),
            fakeElement('transparent'),
        ]);
        warnOnOpaqueTunnelCovers(RECT, doc, warn);
        expect(warn).not.toHaveBeenCalled();
    });
});

import { applyPersistedZoomLevel } from './preload-zoom-level';

function createPorts(saved: unknown, current = 0) {
    const parsed: Array<() => void> = [];
    return {
        requestPersistedZoomLevel: jest.fn(() => saved),
        getZoomLevel: jest.fn(() => current),
        setZoomLevel: jest.fn(),
        whenDocumentParsed: jest.fn((apply: () => void) => {
            parsed.push(apply);
        }),
        notifyApplied: jest.fn(),
        /** Fire DOMContentLoaded. */
        parse(): void {
            for (const apply of parsed.splice(0)) apply();
        },
    };
}

describe('applyPersistedZoomLevel', () => {
    it('requests the level at once but applies it only once the document is parsed', () => {
        const ports = createPorts(-1.5);

        expect(applyPersistedZoomLevel(ports)).toBe(-1.5);
        expect(ports.requestPersistedZoomLevel).toHaveBeenCalledTimes(1);
        // Before DOMContentLoaded webFrame.setZoomLevel would leave a hidden
        // Linux/Windows window without ready-to-show.
        expect(ports.setZoomLevel).not.toHaveBeenCalled();
        expect(ports.notifyApplied).not.toHaveBeenCalled();

        ports.parse();

        expect(ports.setZoomLevel).toHaveBeenCalledWith(-1.5);
        expect(ports.notifyApplied).toHaveBeenCalledTimes(1);
        expect(ports.getZoomLevel).not.toHaveBeenCalled();
    });

    it.each([null, undefined, Number.NaN, '2'])(
        're-applies the current level as a temporary zoom when %p is stored',
        (saved) => {
            const ports = createPorts(saved, 0.5);

            expect(applyPersistedZoomLevel(ports)).toBe(0.5);
            ports.parse();

            expect(ports.setZoomLevel).toHaveBeenCalledWith(0.5);
            expect(ports.notifyApplied).toHaveBeenCalledTimes(1);
        }
    );

    it('never throws out of the preload when the request fails', () => {
        const ports = createPorts(1);
        ports.requestPersistedZoomLevel.mockImplementation(() => {
            throw new Error('no main process');
        });

        expect(applyPersistedZoomLevel(ports)).toBeNull();
        expect(ports.whenDocumentParsed).not.toHaveBeenCalled();
    });

    it('does not acknowledge a level that webFrame refused', () => {
        const ports = createPorts(1);
        ports.setZoomLevel.mockImplementation(() => {
            throw new Error('frame gone');
        });

        applyPersistedZoomLevel(ports);
        expect(() => ports.parse()).not.toThrow();

        expect(ports.notifyApplied).not.toHaveBeenCalled();
    });
});

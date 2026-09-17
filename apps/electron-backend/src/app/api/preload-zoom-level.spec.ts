import { applyPersistedZoomLevel } from './preload-zoom-level';

function createPorts(saved: unknown, current = 0) {
    return {
        requestPersistedZoomLevel: jest.fn(() => saved),
        getZoomLevel: jest.fn(() => current),
        setZoomLevel: jest.fn(),
    };
}

describe('applyPersistedZoomLevel', () => {
    it('applies the persisted level through webFrame', () => {
        const ports = createPorts(-1.5);

        expect(applyPersistedZoomLevel(ports)).toBe(-1.5);
        expect(ports.setZoomLevel).toHaveBeenCalledWith(-1.5);
        expect(ports.getZoomLevel).not.toHaveBeenCalled();
    });

    it.each([null, undefined, Number.NaN, '2'])(
        're-applies the current level as a temporary zoom when %p is stored',
        (saved) => {
            const ports = createPorts(saved, 0.5);

            expect(applyPersistedZoomLevel(ports)).toBe(0.5);
            expect(ports.setZoomLevel).toHaveBeenCalledWith(0.5);
        }
    );

    it('never throws out of the preload when the handshake fails', () => {
        const ports = createPorts(1);
        ports.requestPersistedZoomLevel.mockImplementation(() => {
            throw new Error('no main process');
        });

        expect(applyPersistedZoomLevel(ports)).toBeNull();
        expect(ports.setZoomLevel).not.toHaveBeenCalled();
    });
});

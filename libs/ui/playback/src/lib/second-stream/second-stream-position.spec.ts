import { SecondStreamPosition } from './second-stream-position';
describe('SecondStreamPosition', () => {
    it('clamps pointer travel to the stage and preserves relative placement on resize', () => {
        const position = new SecondStreamPosition();
        position.area.set({ width: 800, height: 450 });
        const target = { setPointerCapture: jest.fn() };
        position.down({
            button: 0,
            pointerId: 7,
            clientX: 400,
            clientY: 200,
            preventDefault: jest.fn(),
            currentTarget: target,
        } as unknown as PointerEvent);
        position.move({
            pointerId: 8,
            clientX: -500,
            clientY: -500,
        } as PointerEvent);
        expect(position.point().x).toBe(1);
        position.move({
            pointerId: 7,
            clientX: -500,
            clientY: 900,
        } as PointerEvent);
        expect(position.point()).toEqual({ x: 0, y: 1 });
        position.up({ pointerId: 7 } as PointerEvent);
        expect(position.dragging()).toBe(false);
        position.area.set({ width: 500, height: 280 });
        const rect = position.geometry();
        expect(rect.left).toBe(8);
        expect(rect.top + rect.height).toBe(272);
    });
    it('supports keyboard movement without forwarding arrows to player shortcuts', () => {
        const position = new SecondStreamPosition();
        position.area.set({ width: 800, height: 450 });
        const before = position.geometry().left;
        const event = {
            key: 'ArrowLeft',
            preventDefault: jest.fn(),
            stopPropagation: jest.fn(),
        };
        position.key(event as unknown as KeyboardEvent);
        expect(position.geometry().left).toBeCloseTo(before - 16);
        expect(event.stopPropagation).toHaveBeenCalled();
    });
    it('moves outside the video into channels or EPG while staying inside the window', () => {
        const position = new SecondStreamPosition();
        const stage = { left: 520, top: 56, width: 760, height: 404 };
        position.measure(stage, { width: 1280, height: 720 }, false);
        expect(position.geometry().left).toBeGreaterThan(stage.left);
        position.point.set({ x: 0, y: 1 });
        expect(position.geometry().left).toBe(8);
        expect(position.geometry().top).toBeGreaterThan(
            stage.top + stage.height
        );
        expect(position.geometry().top + position.geometry().height).toBe(712);
    });
    it('restores the window position after moving in fullscreen and clamps on resize', () => {
        const position = new SecondStreamPosition();
        const stage = { left: 520, top: 56, width: 760, height: 404 };
        position.measure(stage, { width: 1280, height: 720 }, false);
        position.point.set({ x: 0.1, y: 0.9 });
        const before = position.geometry();
        position.measure(
            { left: 0, top: 0, width: 1600, height: 900 },
            { width: 1600, height: 900 },
            true
        );
        position.point.set({ x: 1, y: 1 });
        position.measure(stage, { width: 1280, height: 720 }, false);
        expect(position.geometry()).toEqual(before);
        position.measure(
            { left: 0, top: 0, width: 320, height: 180 },
            { width: 320, height: 240 },
            false
        );
        const small = position.geometry();
        expect(small.left + small.width).toBeLessThanOrEqual(312);
        expect(small.top + small.height).toBeLessThanOrEqual(232);
    });
    function pointer(x: number, y: number, id = 7): PointerEvent {
        return {
            button: 0,
            pointerId: id,
            clientX: x,
            clientY: y,
            preventDefault: jest.fn(),
            currentTarget: { setPointerCapture: jest.fn() },
        } as unknown as PointerEvent;
    }
    it.each(['left', 'right'] as const)(
        'resizes from %s with 16:9 geometry and the opposite edge anchored',
        (corner) => {
            const position = new SecondStreamPosition();
            position.area.set({ width: 1280, height: 720 });
            position.point.set({ x: 0.5, y: 0.3 });
            const before = position.geometry();
            position.down(pointer(500, 300), corner);
            position.move(pointer(500 + (corner === 'left' ? -96 : 96), 354));
            const after = position.geometry();
            expect(after.width).toBe(416);
            expect(after.height).toBe(234);
            expect(after.top).toBeCloseTo(before.top);
            expect(
                corner === 'left' ? after.left + after.width : after.left
            ).toBeCloseTo(
                corner === 'left' ? before.left + before.width : before.left
            );
            position.up(pointer(0, 0));
            expect(position.resizing()).toBe(false);
        }
    );
    it('clamps resize, ignores another pointer, and preserves the preferred size after viewport shrink', () => {
        const position = new SecondStreamPosition();
        position.area.set({ width: 1280, height: 720 });
        position.down(pointer(500, 300), 'right');
        position.move(pointer(1000, 600, 8));
        expect(position.geometry().width).toBe(320);
        position.move(pointer(2000, 2000));
        expect(position.geometry().width).toBe(640);
        const rect = position.geometry();
        expect(rect.left + rect.width).toBeLessThanOrEqual(1272);
        expect(rect.top + rect.height).toBeLessThanOrEqual(712);
        position.area.set({ width: 200, height: 140 });
        expect(position.geometry().width).toBe(184);
        position.area.set({ width: 1280, height: 720 });
        expect(position.geometry().width).toBe(640);
        position.move(pointer(-1000, -1000));
        expect(position.geometry().width).toBe(240);
    });
    it('supports keyboard resize without seeking video and restores window size after fullscreen', () => {
        const position = new SecondStreamPosition();
        const stage = { left: 520, top: 56, width: 760, height: 404 };
        position.measure(stage, { width: 1280, height: 720 }, false);
        const event = {
            key: 'ArrowRight',
            preventDefault: jest.fn(),
            stopPropagation: jest.fn(),
        };
        position.resizeKey(event as unknown as KeyboardEvent, 'right');
        expect(position.geometry().width).toBe(336);
        expect(event.stopPropagation).toHaveBeenCalled();
        const before = position.geometry();
        position.measure(
            { left: 0, top: 0, width: 1280, height: 720 },
            { width: 1280, height: 720 },
            true
        );
        position.resizeKey(
            { ...event, key: 'End' } as unknown as KeyboardEvent,
            'left'
        );
        expect(position.geometry().width).toBe(640);
        position.measure(stage, { width: 1280, height: 720 }, false);
        expect(position.geometry()).toEqual(before);
    });
    it('restores the minimum after resizing in a viewport narrower than the normal minimum', () => {
        const position = new SecondStreamPosition();
        position.area.set({ width: 200, height: 140 });
        position.resizeKey(
            {
                key: 'Home',
                preventDefault: jest.fn(),
                stopPropagation: jest.fn(),
            } as unknown as KeyboardEvent,
            'right'
        );
        expect(position.geometry().width).toBe(184);
        position.area.set({ width: 1280, height: 720 });
        expect(position.geometry().width).toBe(240);
        expect(position.geometry().width).toBeGreaterThanOrEqual(
            position.minimumWidth()
        );
    });
});

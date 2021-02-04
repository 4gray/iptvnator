import { MomentDatePipe } from './moment-date.pipe';

describe('Pipe: MomentDatee', () => {
    it('create an instance', () => {
        const pipe = new MomentDatePipe();
        expect(pipe).toBeTruthy();
    });
});

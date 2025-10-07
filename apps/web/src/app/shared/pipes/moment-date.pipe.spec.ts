import { MomentDatePipe } from './moment-date.pipe';

describe('Pipe: MomentDate', () => {
    it('create an instance', () => {
        const pipe = new MomentDatePipe();
        expect(pipe).toBeTruthy();
    });
});

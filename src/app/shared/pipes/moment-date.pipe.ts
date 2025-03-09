import { Pipe, PipeTransform } from '@angular/core';
import moment from 'moment';

/**
 * Moment.js based pipe to parse and return the provided date based on given params
 */
@Pipe({
    name: 'momentDate',
    standalone: true,
})
export class MomentDatePipe implements PipeTransform {
    transform(
        value: string,
        formatToParse: string,
        formatToReturn = 'MMMM Do, dddd'
    ): any {
        return moment(value, formatToParse).format(formatToReturn);
    }
}

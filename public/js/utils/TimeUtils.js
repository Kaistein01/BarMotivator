export class TimeUtils {
    static isoToMs(iso) {
        return new Date(iso).getTime();
    }

    static getISOString(date) {
        const tzoffset = date.getTimezoneOffset() * 60000;
        const localNow = new Date(date.getTime() - tzoffset);
        return localNow.toISOString().split('.')[0];
    }
}

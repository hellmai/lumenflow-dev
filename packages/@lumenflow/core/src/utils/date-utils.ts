/**
 * DateUtils - Date formatting and manipulation utilities (WU-2537)
 * @module @lumenflow/core/utils
 */

export class DateUtils {
  static formatISO(date: Date): string {
    return date.toISOString();
  }

  static parseISO(iso: string): Date {
    return new Date(iso);
  }

  static formatRelative(date: Date, relativeTo: Date = new Date()): string {
    const diff = relativeTo.getTime() - date.getTime();
    const hours = Math.floor(diff / 3600000);

    if (hours < 1) {
      return 'less than 1 hour ago';
    }
    if (hours === 1) {
      return '1 hour ago';
    }
    return `${hours} hours ago`;
  }

  static isOlderThan(date: Date, duration: string): boolean {
    const now = Date.now();
    const ms = DateUtils.parseDuration(duration);
    return now - date.getTime() > ms;
  }

  static addDuration(date: Date, duration: string): Date {
    const ms = DateUtils.parseDuration(duration);
    return new Date(date.getTime() + ms);
  }

  private static parseDuration(duration: string): number {
    const match = duration.match(/^(\d+)(h|d|m|s)$/);
    if (!match) {
      throw new Error(`Invalid duration: ${duration}`);
    }

    const value = parseInt(match[1]!, 10);
    const unit = match[2];

    switch (unit) {
      case 's':
        return value * 1000;
      case 'm':
        return value * 60000;
      case 'h':
        return value * 3600000;
      case 'd':
        return value * 86400000;
      default:
        return value * 1000;
    }
  }
}

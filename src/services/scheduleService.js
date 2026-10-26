import config from '../config/index.js';
import databaseService from './databaseService.js';
import logger from '../utils/logger.js';

/**
 * Parses raw holiday settings supporting either JSON array or comma-separated YYYY-MM-DD string.
 */
export function parseHolidays(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map(item => (typeof item === 'object' && item?.date ? item.date : String(item).trim())).filter(Boolean);
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map(item => (typeof item === 'object' && item?.date ? item.date : String(item).trim())).filter(Boolean);
        }
      } catch {
        // Fall through to CSV parsing
      }
    }
    return trimmed.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [];
}

class ScheduleService {
  constructor() {
    this.defaultTimezone = config.schedule.timezone || 'Asia/Kolkata';
  }

  /**
   * Retrieves active office schedule settings (from database app_settings if modified, else config defaults).
   */
  async getScheduleSettings() {
    try {
      const start = await databaseService.getSetting('office_hours_start', config.schedule.officeHoursStart || '09:00');
      const end = await databaseService.getSetting('office_hours_end', config.schedule.officeHoursEnd || '17:00');
      const daysStr = await databaseService.getSetting('office_days', (config.schedule.officeDays || [1,2,3,4,5,6]).join(','));
      const tz = await databaseService.getSetting('office_timezone', config.schedule.timezone || 'Asia/Kolkata');
      const holidaysStr = await databaseService.getSetting('office_holidays', (config.schedule.holidays || ['2026-01-26','2026-08-15','2026-10-02']).join(','));

      const workingDays = daysStr.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
      const holidays = parseHolidays(holidaysStr);

      return {
        start,
        end,
        workingDays,
        timezone: tz,
        holidays,
        holidaysRaw: holidaysStr
      };
    } catch {
      return {
        start: config.schedule.officeHoursStart || '09:00',
        end: config.schedule.officeHoursEnd || '17:00',
        workingDays: config.schedule.officeDays || [1,2,3,4,5,6],
        timezone: config.schedule.timezone || 'Asia/Kolkata',
        holidays: config.schedule.holidays || ['2026-01-26','2026-08-15','2026-10-02']
      };
    }
  }

  /**
   * Checks whether the given date (or current time in Asia/Kolkata) is within working hours.
   * @param {Object} [options]
   * @param {Date} [options.now] - Optional custom date to evaluate
   * @param {boolean} [options.forceOutsideHours] - Test override to simulate closed office
   * @returns {Promise<{ isOpen: boolean, reason?: string, schedule: Object }>}
   */
  async isWithinWorkingHours(options = {}) {
    if (options.forceOutsideHours === true) {
      const schedule = await this.getScheduleSettings();
      return {
        isOpen: false,
        reason: 'forced_simulation_outside_hours',
        schedule
      };
    }

    if (options.forceInsideHours === true) {
      const schedule = await this.getScheduleSettings();
      return {
        isOpen: true,
        schedule
      };
    }

    const schedule = await this.getScheduleSettings();
    const targetDate = options.now instanceof Date ? options.now : new Date();

    // Format current date & time in target timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: schedule.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      weekday: 'short'
    });

    const parts = formatter.formatToParts(targetDate);
    const partMap = {};
    for (const p of parts) {
      partMap[p.type] = p.value;
    }

    const yyyy = partMap.year;
    const mm = partMap.month;
    const dd = partMap.day;
    const dateStr = `${yyyy}-${mm}-${dd}`;

    // 1. Check Holiday list (YYYY-MM-DD)
    if (schedule.holidays.includes(dateStr)) {
      logger.info(`[SCHEDULE] Date ${dateStr} is marked as official holiday. Office closed.`);
      return {
        isOpen: false,
        reason: `holiday (${dateStr})`,
        schedule
      };
    }

    // 2. Check Day of Week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
    // Convert weekday string ('Mon', 'Tue'...) to day number (0..6)
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const currentDayNum = dayNames.indexOf(partMap.weekday);

    if (!schedule.workingDays.includes(currentDayNum)) {
      logger.info(`[SCHEDULE] Current weekday (${partMap.weekday}, ${currentDayNum}) is outside working days [${schedule.workingDays.join(',')}].`);
      return {
        isOpen: false,
        reason: `non_working_day (${partMap.weekday})`,
        schedule
      };
    }

    // 3. Check Hour & Minute Range
    const currentHour = parseInt(partMap.hour, 10);
    const currentMinute = parseInt(partMap.minute, 10);
    const currentMinutesTotal = currentHour * 60 + currentMinute;

    const [startH, startM] = schedule.start.split(':').map(Number);
    const [endH, endM] = schedule.end.split(':').map(Number);
    const startMinutesTotal = startH * 60 + (startM || 0);
    const endMinutesTotal = endH * 60 + (endM || 0);

    if (currentMinutesTotal < startMinutesTotal || currentMinutesTotal >= endMinutesTotal) {
      logger.info(`[SCHEDULE] Current time (${partMap.hour}:${partMap.minute}) is outside office hours (${schedule.start} - ${schedule.end}).`);
      return {
        isOpen: false,
        reason: `outside_office_hours (${partMap.hour}:${partMap.minute})`,
        schedule
      };
    }

    return {
      isOpen: true,
      schedule
    };
  }

  /**
   * Returns phone-friendly spoken office hours closure message in caller's language.
   * @param {string} language - 'hi-IN' | 'en-IN'
   * @param {Object} [schedule]
   * @returns {string}
   */
  getClosedOfficeSpokenMessage(language = 'en-IN', schedule = {}) {
    const isHindi = language === 'hi-IN';
    const start = schedule.start || '09:00';
    const end = schedule.end || '17:00';

    if (isHindi) {
      return `क्षमा करें, हमारा प्रवेश सहायता कार्यालय अभी बंद है। कार्यालय का समय सोमवार से शनिवार, सुबह ९:०० बजे से शाम ५:०० बजे तक है। हमने आपका कॉलबैक अनुरोध दर्ज कर लिया है, और हमारे अधिकारी कार्य समय में आपसे जल्द ही संपर्क करेंगे। धन्यवाद।`;
    }

    return `We apologize, but our admission office is currently closed. Office hours are Monday to Saturday, 9:00 AM to 5:00 PM. We have registered your callback request, and our admission staff will call you back during working hours. Thank you.`;
  }
}

export const scheduleService = new ScheduleService();
export default scheduleService;

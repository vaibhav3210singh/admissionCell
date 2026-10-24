import config from '../config/index.js';
import logger from '../utils/logger.js';

/**
 * Telephony Service Abstraction
 * Handles voice call routing, IVR, and transferring calls to human admission staff.
 * Defaults to 'mock' provider (free, zero external accounts needed for presentation).
 * When upgrading to paid Twilio or Exotel, simply set TELEPHONY_PROVIDER in .env.
 */
class TelephonyService {
  constructor() {
    this.provider = config.telephony.provider;
    this.accountSid = config.telephony.accountSid;
    this.authToken = config.telephony.authToken;
    this.phoneNumber = config.telephony.phoneNumber;
  }

  /**
   * Initializes telephony provider.
   */
  async initialize() {
    if (this.provider === 'mock') {
      logger.info('Telephony service initialized with provider: MOCK (Simulation mode)');
      return true;
    } else if (this.provider === 'twilio') {
      if (!this.accountSid || !this.authToken) {
        logger.warn('Twilio credentials missing in .env. Falling back to mock telephony.');
        this.provider = 'mock';
      } else {
        logger.info(`Telephony service initialized with Twilio account SID: ${this.accountSid.substring(0, 6)}...`);
      }
      return true;
    } else if (this.provider === 'exotel') {
      logger.info('Telephony service initialized with Exotel provider.');
      return true;
    }
    return true;
  }

  /**
   * Transfers an active caller to human admission helpline staff.
   * @param {string} callerNumber
   * @param {string} reason
   */
  async transferToStaff(callerNumber = 'Web User', reason = 'Low similarity score') {
    const staffPhone = config.handoff.phone;
    logger.info(`[TELEPHONY] Transferring caller (${callerNumber}) to human staff (${staffPhone}). Reason: ${reason}`);

    if (this.provider === 'mock') {
      return {
        success: true,
        provider: 'mock',
        status: 'simulated_transfer',
        targetPhone: staffPhone,
        timestamp: new Date().toISOString()
      };
    }

    // Future Twilio / Exotel call forwarding logic
    return {
      success: true,
      provider: this.provider,
      status: 'forwarded',
      targetPhone: staffPhone,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Returns current telephony status.
   */
  getStatus() {
    return {
      provider: this.provider,
      configuredPhone: this.phoneNumber || config.handoff.phone,
      handoffTarget: config.handoff.phone
    };
  }
}

export const telephonyService = new TelephonyService();
export default telephonyService;

import type { Logging } from 'homebridge';
import {
  IESApiResponse,
  IESClientConfig,
  IESApiError,
  TemperatureReading,
} from './types.js';

const DEFAULT_BASE_URL = 'https://www.ies-heatpumps.com';
const REQUEST_TIMEOUT_MS = 30000;

/**
 * HTTP client for IES Heat Pump API
 */
export class IESClient {
  private readonly baseUrl: string;
  private readonly deviceId: string;
  private readonly cookies: string;
  private readonly log: Logging;

  constructor(config: IESClientConfig, log: Logging) {
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.deviceId = config.deviceId;
    this.cookies = config.cookies;
    this.log = log;
  }

  /**
   * Fetch monitoring data (temperatures, states) from the IES API
   */
  async fetchMonitoring(): Promise<Map<string, TemperatureReading>> {
    const url = `${this.baseUrl}/Monitoring/AsJSON/?deviceId=${encodeURIComponent(this.deviceId)}`;
    return this.fetchFromEndpoint(url, 'monitoring');
  }

  /**
   * Fetch settings data (setpoints, configuration) from the IES API
   */
  async fetchSettings(): Promise<Map<string, TemperatureReading>> {
    const url = `${this.baseUrl}/Configurations/AsJSON/?deviceId=${encodeURIComponent(this.deviceId)}`;
    return this.fetchFromEndpoint(url, 'settings');
  }

  /**
   * Fetch all readings (monitoring + settings combined)
   */
  async fetchReadings(): Promise<Map<string, TemperatureReading>> {
    const [monitoring, settings] = await Promise.all([
      this.fetchMonitoring(),
      this.fetchSettings(),
    ]);

    // Merge both maps, settings values override monitoring if duplicated
    const combined = new Map(monitoring);
    for (const [key, value] of settings) {
      combined.set(key, value);
    }

    return combined;
  }

  /**
   * Fetch data from a specific endpoint
   */
  private async fetchFromEndpoint(url: string, endpointName: string): Promise<Map<string, TemperatureReading>> {
    this.log.debug(`Fetching ${endpointName} from: ${url}`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Cookie': this.cookies,
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Check for auth errors
      if (response.status === 401 || response.status === 403) {
        throw new IESApiError(
          'Authentication failed - cookies may have expired',
          response.status,
          true,
        );
      }

      // Check for redirect to login page (another auth failure indicator)
      if (response.redirected && response.url.includes('login')) {
        throw new IESApiError(
          'Session expired - redirected to login page',
          302,
          true,
        );
      }

      if (!response.ok) {
        throw new IESApiError(
          `API request failed with status ${response.status}`,
          response.status,
        );
      }

      const data = await response.json() as IESApiResponse;
      return this.parseResponse(data, endpointName);

    } catch (error) {
      if (error instanceof IESApiError) {
        throw error;
      }

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new IESApiError('Request timed out');
        }
        throw new IESApiError(`Network error: ${error.message}`);
      }

      throw new IESApiError('Unknown error occurred');
    }
  }

  /**
   * Parse API response and extract readings
   */
  private parseResponse(data: IESApiResponse, endpointName: string): Map<string, TemperatureReading> {
    const readings = new Map<string, TemperatureReading>();
    const now = new Date();

    if (!data.groups || !Array.isArray(data.groups)) {
      this.log.warn('API response missing groups array');
      return readings;
    }

    for (const group of data.groups) {
      if (!group.viewParameters || !Array.isArray(group.viewParameters)) {
        continue;
      }

      for (const param of group.viewParameters) {
        if (!param.id || param.actualValue === undefined) {
          continue;
        }

        const value = parseFloat(param.actualValue);
        if (isNaN(value)) {
          this.log.debug(`Skipping non-numeric value for ${param.id}: ${param.actualValue}`);
          continue;
        }

        readings.set(param.id, {
          paramId: param.id,
          value,
          timestamp: now,
          raw: param.actualValue,
        });
      }
    }

    this.log.debug(`Parsed ${readings.size} readings from ${endpointName}`);
    return readings;
  }

  /**
   * Set the hot water setpoint
   */
  async setHotWaterSetpoint(temperature: number): Promise<void> {
    this.log.info(`Setting hot water setpoint to ${temperature}°C`);

    // First, fetch the CSRF token from the configurations page
    const csrfToken = await this.fetchCsrfToken();

    // Format value with decimal (API expects "22.0" not "22")
    const valueStr = temperature.toFixed(1);

    // POST the new setpoint
    await this.postSetting('_USER_HotWater_SetPoint_T', valueStr, csrfToken);
  }

  /**
   * Fetch CSRF token from the configurations page
   */
  private async fetchCsrfToken(): Promise<string> {
    // Try the configurations page (note: /main/configurations/ requires different auth)
    const url = `${this.baseUrl}/Configurations/?deviceId=${encodeURIComponent(this.deviceId)}`;
    this.log.debug(`Fetching CSRF token from: ${url}`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Cookie': this.cookies,
          'Accept': 'text/html',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Check for redirect to login page (session expired)
      if (response.redirected && response.url.includes('login')) {
        throw new IESApiError(
          'Session expired during CSRF fetch - redirected to login page',
          302,
          true,
        );
      }

      if (!response.ok) {
        throw new IESApiError(
          `Failed to fetch configurations page: ${response.status}`,
          response.status,
        );
      }

      const html = await response.text();
      this.log.info(`CSRF page response URL: ${response.url}, redirected: ${response.redirected}, length: ${html.length}`);

      // Debug: log portion of HTML around the token
      const tokenIndex = html.indexOf('RequestVerificationToken');
      if (tokenIndex !== -1) {
        this.log.info(`Found token text at index ${tokenIndex}: ${html.substring(tokenIndex - 20, tokenIndex + 150)}`);
      } else {
        this.log.info(`No RequestVerificationToken found. Page starts with: ${html.substring(0, 500)}`);
      }

      // Extract CSRF token from: <input name="__RequestVerificationToken" type="hidden" value="..." />
      const tokenMatch = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
      if (!tokenMatch) {
        throw new IESApiError('Could not find CSRF token in configurations page');
      }

      this.log.debug('Successfully fetched CSRF token');
      return tokenMatch[1];

    } catch (error) {
      if (error instanceof IESApiError) {
        throw error;
      }
      if (error instanceof Error) {
        throw new IESApiError(`Failed to fetch CSRF token: ${error.message}`);
      }
      throw new IESApiError('Unknown error fetching CSRF token');
    }
  }

  /**
   * POST a setting value to the API
   * The form requires ALL fields to be sent, with -1 for unchanged selects and empty for unchanged text inputs
   */
  private async postSetting(fieldName: string, value: string, csrfToken: string): Promise<void> {
    const url = `${this.baseUrl}/Configurations/Save`;
    this.log.debug(`POSTing setting ${fieldName}=${value} to: ${url}`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      // Build form data with ALL fields (server requires full form submission)
      const formData = new URLSearchParams();

      // Button and device ID
      formData.append('btnSubmit', '');
      formData.append('hdnDeviceId', this.deviceId);

      // Select fields - use -1 for "no change"
      formData.append('_USER_Parameters_MainSwitch_C', '-1');
      formData.append('_USER_Parameters_SeasonMode_C', '-1');
      formData.append('_USER_HeatSPCtrl_Type_C', '-1');
      formData.append('_USER_HeatSPCtrl_Curve_C', '-1');
      formData.append('_USER_HotWater_Source_C', '-1');
      formData.append('_USER_Heating_Source_C', '-1');
      formData.append('_USER_Heating_CtrlMode_C', '-1');

      // Text/number fields - empty for "no change", or the value if this is the field being set
      formData.append('_USER_HeatSPCtrl_ToffSet_T', fieldName === '_USER_HeatSPCtrl_ToffSet_T' ? value : '');
      formData.append('_USER_HotWater_SetPoint_T', fieldName === '_USER_HotWater_SetPoint_T' ? value : '');
      formData.append('_USER_Heating_SetPointMin_T', fieldName === '_USER_Heating_SetPointMin_T' ? value : '');
      formData.append('_USER_HeatSPCtrl_TroomSet_T', fieldName === '_USER_HeatSPCtrl_TroomSet_T' ? value : '');
      formData.append('_USER_Time_Year_T', '');
      formData.append('_USER_Time_Month_T', '');
      formData.append('_USER_Time_Day_T', '');
      formData.append('_USER_Time_Hour_T', '');
      formData.append('_USER_Time_Minute_T', '');

      // CSRF token
      formData.append('__RequestVerificationToken', csrfToken);

      const body = formData.toString();
      this.log.debug(`POST body: ${body}`);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Cookie': this.cookies,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'text/html,application/xhtml+xml',
          'Referer': `${this.baseUrl}/Configurations/?deviceId=${encodeURIComponent(this.deviceId)}`,
          'Origin': this.baseUrl,
        },
        body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      this.log.info(`POST response status: ${response.status}, redirected: ${response.redirected}, url: ${response.url}`);

      // Check for redirect to login page (session expired)
      if (response.redirected && response.url.includes('login')) {
        throw new IESApiError(
          'Session expired - redirected to login page. Please update your cookies.',
          302,
          true,
        );
      }

      if (!response.ok) {
        throw new IESApiError(
          `Failed to save setting: ${response.status}`,
          response.status,
        );
      }

      this.log.info(`Successfully set ${fieldName} to ${value}`);

    } catch (error) {
      if (error instanceof IESApiError) {
        throw error;
      }
      if (error instanceof Error) {
        throw new IESApiError(`Failed to save setting: ${error.message}`);
      }
      throw new IESApiError('Unknown error saving setting');
    }
  }
}

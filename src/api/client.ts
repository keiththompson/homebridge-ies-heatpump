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
   * Fetch current readings from the IES API
   */
  async fetchReadings(): Promise<Map<string, TemperatureReading>> {
    const url = `${this.baseUrl}/Monitoring/AsJSON/?deviceId=${encodeURIComponent(this.deviceId)}`;

    this.log.debug(`Fetching from: ${url}`);

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

      // Debug: log raw response structure
      this.log.info(`API response keys: ${Object.keys(data).join(', ')}`);
      if (data.groups && Array.isArray(data.groups)) {
        this.log.info(`Number of groups: ${data.groups.length}`);
        for (const group of data.groups) {
          const groupKeys = Object.keys(group);
          this.log.info(`Group keys: ${groupKeys.join(', ')}`);
          this.log.info(`Group content (first 500 chars): ${JSON.stringify(group).substring(0, 500)}`);
        }
      } else {
        this.log.warn(`Raw response (first 1000 chars): ${JSON.stringify(data).substring(0, 1000)}`);
      }

      return this.parseResponse(data);

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
   * Parse API response and extract temperature readings
   */
  private parseResponse(data: IESApiResponse): Map<string, TemperatureReading> {
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

    this.log.debug(`Parsed ${readings.size} readings from API response`);

    // Log all available paramIds for debugging
    const paramIds = Array.from(readings.keys());
    this.log.info(`Available paramIds: ${paramIds.join(', ')}`);

    return readings;
  }
}

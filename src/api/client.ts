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
}

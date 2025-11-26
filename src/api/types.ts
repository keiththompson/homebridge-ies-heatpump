/**
 * IES Heat Pump API Response Types
 * Based on GET https://www.ies-heatpumps.com/Monitoring/AsJSON/?deviceId={deviceId}
 */

export interface IESParameter {
  paramId: string;        // e.g., "_USER.Input.THeatSupply"
  actualValue: string;    // e.g., "32.5"
  displayFormt?: string;  // e.g., "FORM_10" (1 decimal place)
  paramName?: string;
  unit?: string;
}

export interface IESGroup {
  groupId?: string;
  groupName?: string;
  parameters: IESParameter[];
}

export interface IESApiResponse {
  groups: IESGroup[];
  deviceId?: string;
  timestamp?: string;
}

/**
 * Parsed temperature reading
 */
export interface TemperatureReading {
  paramId: string;
  value: number;       // Parsed float
  timestamp: Date;     // When we fetched it
  raw: string;         // Original string value
}

/**
 * API client configuration
 */
export interface IESClientConfig {
  deviceId: string;
  cookies: string;
  baseUrl?: string;    // Default: https://www.ies-heatpumps.com
}

/**
 * Custom error class for IES API errors
 */
export class IESApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public isAuthError: boolean = false,
  ) {
    super(message);
    this.name = 'IESApiError';
  }
}

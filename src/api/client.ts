import type { Logging } from 'homebridge';

import type { IESApiResponse, IESClientConfig, OAuthTokenResponse, TemperatureReading } from './types.js';
import { IESApiError } from './types.js';

const DEFAULT_BASE_URL = 'https://www.ies-heatpumps.com';
const AUTH_URL = 'https://login.ies-heatpumps.com';
const REQUEST_TIMEOUT_MS = 30000;
const TOKEN_REFRESH_BUFFER_MS = 60000; // Refresh token 60 seconds before expiry

/**
 * HTTP client for IES Heat Pump API with OAuth authentication
 */
export class IESClient {
  private readonly baseUrl: string;
  private readonly deviceId: string;
  private readonly username: string;
  private readonly password: string;
  private readonly log: Logging;

  // OAuth tokens
  private accessToken?: string;
  private refreshToken?: string;
  private tokenExpiresAt?: Date;

  // Session cookies for form-based operations (CSRF, settings)
  private sessionCookies?: string;

  constructor(config: IESClientConfig, log: Logging) {
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.deviceId = config.deviceId;
    this.username = config.username;
    this.password = config.password;
    this.log = log;
  }

  /**
   * Authenticate by simulating the browser login flow
   */
  async authenticate(): Promise<void> {
    this.log.info('Authenticating with IES...');

    try {
      // Step 1: Start from main app to get OIDC cookies, then get login page
      const { sessionCookies, csrfToken, returnUrl, state, appCookies } = await this.getLoginPage();

      // Step 2: Submit login credentials
      const authCookies = await this.submitLogin(sessionCookies, csrfToken, returnUrl);

      // Step 3: Get the authorization callback to obtain the code and id_token
      const { code, idToken } = await this.getAuthorizationCode(authCookies, returnUrl);

      // Step 4: Complete OIDC flow by posting to signin-oidc with the app's OIDC cookies
      await this.completeOidcFlow(code, idToken, state, appCookies);

      this.log.info('Successfully authenticated with IES');
    } catch (error) {
      if (error instanceof IESApiError) {
        throw error;
      }
      if (error instanceof Error) {
        throw new IESApiError(`Authentication failed: ${error.message}`, undefined, true);
      }
      throw new IESApiError('Unknown error during authentication', undefined, true);
    }
  }

  /**
   * Step 1: Start auth flow from main app to get OIDC correlation cookies, then get login page
   */
  private async getLoginPage(): Promise<{
    sessionCookies: string;
    csrfToken: string;
    returnUrl: string;
    state: string;
    appCookies: string;
  }> {
    this.log.debug('[Auth] Starting auth flow from main app...');

    // Step 1a: Hit the main app - this will redirect to the auth server and set OIDC cookies
    const initResponse = await fetch(this.baseUrl, {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      redirect: 'manual',
    });

    // Get the OIDC cookies from the main app (nonce, correlation, antiforgery)
    const appSetCookies = initResponse.headers.getSetCookie?.() || [];
    const appCookies = this.parseCookies(appSetCookies);
    this.log.debug(`[Auth] Main app cookies count: ${appSetCookies.length}`);

    // Get the redirect URL to the auth server
    const redirectUrl = initResponse.headers.get('location');
    if (!redirectUrl) {
      throw new IESApiError('Main app did not redirect to auth server');
    }
    this.log.debug(`[Auth] Redirect URL: ${redirectUrl.substring(0, 100)}...`);

    // Extract the state from the redirect URL (we need it for signin-oidc)
    const urlParams = new URL(redirectUrl).searchParams;
    const state = urlParams.get('state') || '';

    // Step 1b: Follow redirect to get the login page
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const loginResponse = await fetch(redirectUrl, {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    this.log.debug(`[Auth] Login page response status: ${loginResponse.status}, URL: ${loginResponse.url}`);

    // Extract cookies from login page response
    const loginSetCookies = loginResponse.headers.getSetCookie?.() || [];
    this.log.debug(`[Auth] Login page cookies count: ${loginSetCookies.length}`);
    const sessionCookies = this.parseCookies(loginSetCookies);

    // Get the HTML to extract CSRF token and returnUrl
    const html = await loginResponse.text();
    this.log.debug(`[Auth] HTML length: ${html.length}`);

    const csrfMatch = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
    if (!csrfMatch) {
      this.log.error('[Auth] Failed to find CSRF token in login page HTML');
      throw new IESApiError('Failed to extract CSRF token from login page');
    }

    // Extract ReturnUrl from the form
    const returnUrlMatch = html.match(/name="ReturnUrl"[^>]*value="([^"]+)"/);
    const returnUrl = returnUrlMatch ? decodeURIComponent(returnUrlMatch[1].replace(/&amp;/g, '&')) : '';
    this.log.debug(`[Auth] ReturnUrl found: ${returnUrl ? 'yes' : 'no'}`);

    if (!sessionCookies) {
      throw new IESApiError('Failed to get session cookies from login page');
    }

    this.log.debug('[Auth] Success - got session cookies, CSRF token, and app cookies');
    return { sessionCookies, csrfToken: csrfMatch[1], returnUrl, state, appCookies };
  }

  /**
   * Step 2: Submit login credentials
   */
  private async submitLogin(sessionCookies: string, csrfToken: string, returnUrl: string): Promise<string> {
    this.log.debug('[Auth] Submitting login credentials...');

    const loginUrl = `${AUTH_URL}/Account/Login?ReturnUrl=${encodeURIComponent(returnUrl)}`;

    const formData = new URLSearchParams({
      ReturnUrl: returnUrl,
      Username: this.username,
      Password: this.password,
      ClientTimezoneOffsetMinutes: '0',
      ClientTimeZoneOffset: '-00:00',
      __RequestVerificationToken: csrfToken,
      RememberLogin: 'false',
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch(loginUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: sessionCookies,
        Origin: AUTH_URL,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
      body: formData.toString(),
      redirect: 'manual',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Check for login failure (200 means we're still on login page with error)
    if (response.status === 200) {
      const html = await response.text();
      if (html.includes('Invalid username or password') || html.includes('validation-summary-errors')) {
        throw new IESApiError('Invalid username or password', 401, true);
      }
    }

    // Should get a 302 redirect on success
    if (response.status !== 302) {
      this.log.error(`[Auth] Login failed with status ${response.status}`);
      throw new IESApiError(`Login failed with status ${response.status}`, response.status, true);
    }

    // Combine original cookies with new auth cookies
    const newCookies = response.headers.getSetCookie?.() || [];
    this.log.debug(`[Auth] New cookies count: ${newCookies.length}`);
    const allCookies = this.mergeCookies(sessionCookies, newCookies);

    this.log.debug('[Auth] Success - login successful, got auth cookies');
    return allCookies;
  }

  /**
   * Step 3: Get the authorization callback to obtain the authorization code and id_token
   */
  private async getAuthorizationCode(
    cookies: string,
    returnUrl: string,
  ): Promise<{ code: string; idToken: string; sessionState: string }> {
    this.log.debug('[Auth] Getting authorization code...');

    const callbackUrl = `${AUTH_URL}${returnUrl}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch(callbackUrl, {
      method: 'GET',
      headers: {
        Cookie: cookies,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
      redirect: 'manual',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const html = await response.text();
    this.log.debug(`[Auth] Response status: ${response.status}, HTML length: ${html.length}`);

    // The response is an HTML form that auto-submits with the code, id_token, state, etc.
    const codeMatch = html.match(/name=['"]code['"][^>]*value=['"]([^'"]+)['"]/);
    const idTokenMatch = html.match(/name=['"]id_token['"][^>]*value=['"]([^'"]+)['"]/);
    const sessionStateMatch = html.match(/name=['"]session_state['"][^>]*value=['"]([^'"]+)['"]/);

    if (!codeMatch) {
      this.log.error('[Auth] Failed to find authorization code in callback response');
      throw new IESApiError('Failed to extract authorization code from callback');
    }

    if (!idTokenMatch) {
      this.log.error('[Auth] Failed to find id_token');
      throw new IESApiError('Failed to extract id_token from callback');
    }

    this.log.debug('[Auth] Success - got authorization code and id_token');
    return {
      code: codeMatch[1],
      idToken: idTokenMatch[1],
      sessionState: sessionStateMatch?.[1] || '',
    };
  }

  /**
   * Step 4: Complete OIDC flow by posting to signin-oidc
   * This establishes a session on the main app and gives us access tokens
   */
  private async completeOidcFlow(code: string, idToken: string, state: string, appCookies: string): Promise<void> {
    this.log.debug('[Auth] Completing OIDC flow...');
    this.log.debug(`[Auth] Using app cookies: ${appCookies ? 'yes' : 'no'}`);

    // Post to signin-oidc with the tokens and the OIDC cookies from step 1
    const signinUrl = `${this.baseUrl}/signin-oidc`;

    const formData = new URLSearchParams({
      code,
      id_token: idToken,
      scope: 'openid profile webapi_scope',
      state,
      session_state: '',
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch(signinUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: appCookies,
        Origin: AUTH_URL,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
      body: formData.toString(),
      redirect: 'manual',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    this.log.debug(`[Auth] signin-oidc response status: ${response.status}`);

    // Should get a 302 redirect with session cookies
    if (response.status !== 302) {
      this.log.error(`[Auth] OIDC completion failed with status ${response.status}`);
      throw new IESApiError(`OIDC completion failed with status ${response.status}`, response.status, true);
    }

    // Extract the session cookies
    const newCookies = response.headers.getSetCookie?.() || [];
    this.log.debug(`[Auth] New session cookies count: ${newCookies.length}`);
    this.sessionCookies = this.mergeCookies(appCookies, newCookies);

    // Extract access token from the id_token (it contains the claims we need)
    // The id_token itself can be used as bearer token for API calls
    this.accessToken = idToken;

    // Parse id_token to get expiry (it's a JWT)
    try {
      const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString());
      this.tokenExpiresAt = new Date(payload.exp * 1000);
      this.log.debug(`[Auth] Token expires at: ${this.tokenExpiresAt.toISOString()}`);
    } catch {
      // Default to 1 hour if we can't parse
      this.tokenExpiresAt = new Date(Date.now() + 3600 * 1000);
    }

    this.log.debug('[Auth] Success - OIDC flow completed, got session cookies');
  }

  /**
   * Generate a random nonce for OAuth
   */
  private generateNonce(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Buffer.from(array).toString('base64url');
  }

  /**
   * Generate a random state for OAuth
   */
  private generateState(): string {
    const array = new Uint8Array(64);
    crypto.getRandomValues(array);
    return Buffer.from(array).toString('base64url');
  }

  /**
   * Parse Set-Cookie headers into a cookie string
   */
  private parseCookies(setCookies: string[]): string {
    return setCookies.map((cookie) => cookie.split(';')[0]).join('; ');
  }

  /**
   * Merge existing cookies with new Set-Cookie headers
   */
  private mergeCookies(existingCookies: string, newSetCookies: string[]): string {
    const cookieMap = new Map<string, string>();

    // Parse existing cookies
    for (const cookie of existingCookies.split('; ')) {
      const [name, ...valueParts] = cookie.split('=');
      if (name) {
        cookieMap.set(name, valueParts.join('='));
      }
    }

    // Add/update with new cookies
    for (const setCookie of newSetCookies) {
      const cookiePart = setCookie.split(';')[0];
      const [name, ...valueParts] = cookiePart.split('=');
      if (name) {
        cookieMap.set(name, valueParts.join('='));
      }
    }

    return Array.from(cookieMap.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  /**
   * Refresh the access token using the refresh token
   */
  private async refreshTokens(): Promise<void> {
    if (!this.refreshToken) {
      this.log.debug('No refresh token available, performing full authentication');
      await this.authenticate();
      return;
    }

    this.log.debug('Refreshing OAuth tokens...');

    const tokenUrl = `${AUTH_URL}/connect/token`;

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: 'BitzerIoC.Web',
      refresh_token: this.refreshToken,
    });

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        this.log.warn('Token refresh failed, performing full authentication');
        await this.authenticate();
        return;
      }

      const tokenData = (await response.json()) as OAuthTokenResponse;

      this.accessToken = tokenData.access_token;
      this.refreshToken = tokenData.refresh_token;
      this.tokenExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

      this.log.debug('Successfully refreshed OAuth tokens');
      this.log.debug(`Token expires at: ${this.tokenExpiresAt.toISOString()}`);
    } catch (error) {
      this.log.warn('Token refresh error, performing full authentication');
      await this.authenticate();
    }
  }

  /**
   * Ensure we have a valid access token before making API calls
   */
  private async ensureAuthenticated(): Promise<void> {
    // First time - need to authenticate
    if (!this.accessToken || !this.tokenExpiresAt) {
      await this.authenticate();
      return;
    }

    // Check if token is expired or about to expire
    const now = Date.now();
    const expiresAt = this.tokenExpiresAt.getTime();

    if (now >= expiresAt - TOKEN_REFRESH_BUFFER_MS) {
      await this.refreshTokens();
    }
  }

  /**
   * Get authorization headers for API requests
   */
  private getAuthHeaders(): Record<string, string> {
    if (!this.accessToken) {
      throw new IESApiError('Not authenticated', undefined, true);
    }
    return {
      Authorization: `Bearer ${this.accessToken}`,
    };
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
    const [monitoring, settings] = await Promise.all([this.fetchMonitoring(), this.fetchSettings()]);

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
  private async fetchFromEndpoint(
    url: string,
    endpointName: string,
    retryOnAuth = true,
  ): Promise<Map<string, TemperatureReading>> {
    this.log.debug(`Fetching ${endpointName} from: ${url}`);

    // Ensure we have a valid token
    await this.ensureAuthenticated();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          ...this.getAuthHeaders(),
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Check for auth errors - retry once with fresh token
      if (response.status === 401 || response.status === 403) {
        if (retryOnAuth) {
          this.log.debug('Received 401/403, re-authenticating and retrying...');
          this.accessToken = undefined; // Force re-auth
          return this.fetchFromEndpoint(url, endpointName, false);
        }
        throw new IESApiError('Authentication failed - check your credentials', response.status, true);
      }

      // Check for redirect to login page (another auth failure indicator)
      if (response.redirected && response.url.includes('login')) {
        if (retryOnAuth) {
          this.log.debug('Redirected to login, re-authenticating and retrying...');
          this.accessToken = undefined; // Force re-auth
          return this.fetchFromEndpoint(url, endpointName, false);
        }
        throw new IESApiError('Session expired - authentication failed', 302, true);
      }

      if (!response.ok) {
        throw new IESApiError(`API request failed with status ${response.status}`, response.status);
      }

      const data = (await response.json()) as IESApiResponse;
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
   * Set the curve offset
   */
  async setCurveOffset(offset: number): Promise<void> {
    this.log.info(`Setting curve offset to ${offset}°C`);

    const csrfToken = await this.fetchCsrfToken();

    // Format value with decimal (API expects "6.0" not "6")
    const valueStr = offset.toFixed(1);

    await this.postSetting('_USER_HeatSPCtrl_ToffSet_T', valueStr, csrfToken);
  }

  /**
   * Set the heating room setpoint
   */
  async setHeatingRoomSetpoint(temperature: number): Promise<void> {
    this.log.info(`Setting heating room setpoint to ${temperature}°C`);

    const csrfToken = await this.fetchCsrfToken();

    // Format value with decimal (API expects "30.0" not "30")
    const valueStr = temperature.toFixed(1);

    await this.postSetting('_USER_HeatSPCtrl_TroomSet_T', valueStr, csrfToken);
  }

  /**
   * Set the season mode
   * @param mode 0=Summer, 1=Winter, 2=Auto
   */
  async setSeasonMode(mode: number): Promise<void> {
    const modeName = ['Summer', 'Winter', 'Auto'][mode] || 'Unknown';
    this.log.info(`Setting season mode to ${modeName} (${mode})`);

    const csrfToken = await this.fetchCsrfToken();

    // This is a select field, so we send the numeric value as a string
    await this.postSetting('_USER_Parameters_SeasonMode_C', mode.toString(), csrfToken);
  }

  /**
   * Set the compensation type
   * @param type 0-7 representing different compensation modes
   */
  async setCompensationType(type: number): Promise<void> {
    this.log.info(`Setting compensation type to ${type}`);

    const csrfToken = await this.fetchCsrfToken();

    // This is a select field, so we send the numeric value as a string
    await this.postSetting('_USER_HeatSPCtrl_Type_C', type.toString(), csrfToken);
  }

  /**
   * Set the minimum heating setpoint
   * @param temperature 0-70°C
   */
  async setMinHeatingSetpoint(temperature: number): Promise<void> {
    this.log.info(`Setting min heating setpoint to ${temperature}°C`);

    const csrfToken = await this.fetchCsrfToken();

    // Format value with decimal (API expects "30.0" not "30")
    const valueStr = temperature.toFixed(1);

    await this.postSetting('_USER_Heating_SetPointMin_T', valueStr, csrfToken);
  }

  /**
   * Fetch CSRF token from the configurations page (uses session cookies)
   */
  private async fetchCsrfToken(retryOnAuth = true): Promise<string> {
    // Ensure we have a valid session
    await this.ensureAuthenticated();

    if (!this.sessionCookies) {
      throw new IESApiError('No session cookies available for CSRF fetch', undefined, true);
    }

    const url = `${this.baseUrl}/Configurations/?deviceId=${encodeURIComponent(this.deviceId)}`;
    this.log.debug(`Fetching CSRF token from: ${url}`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Cookie: this.sessionCookies,
          Accept: 'text/html',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
        redirect: 'manual',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Check for redirect to login page (auth failure)
      if (response.status === 302) {
        const location = response.headers.get('location') || '';
        if (location.includes('login')) {
          if (retryOnAuth) {
            this.log.debug('Redirected to login during CSRF fetch, re-authenticating...');
            this.accessToken = undefined;
            this.sessionCookies = undefined;
            return this.fetchCsrfToken(false);
          }
          throw new IESApiError('Authentication failed during CSRF fetch', 302, true);
        }
      }

      if (response.status === 401 || response.status === 403) {
        if (retryOnAuth) {
          this.log.debug('Received 401/403 during CSRF fetch, re-authenticating...');
          this.accessToken = undefined;
          this.sessionCookies = undefined;
          return this.fetchCsrfToken(false);
        }
        throw new IESApiError('Authentication failed during CSRF fetch', response.status, true);
      }

      if (!response.ok) {
        throw new IESApiError(`Failed to fetch configurations page: ${response.status}`, response.status);
      }

      const html = await response.text();

      // Extract CSRF token from: <input name="__RequestVerificationToken" type="hidden" value="..." />
      const tokenMatch = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
      if (!tokenMatch) {
        this.log.debug('Could not find CSRF token in configurations page HTML');
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
   * POST a setting value to the API (uses session cookies)
   * The form requires ALL fields to be sent, with -1 for unchanged selects and empty for unchanged text inputs
   */
  private async postSetting(fieldName: string, value: string, csrfToken: string, retryOnAuth = true): Promise<void> {
    // Ensure we have a valid session
    await this.ensureAuthenticated();

    if (!this.sessionCookies) {
      throw new IESApiError('No session cookies available for settings update', undefined, true);
    }

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

      // Select fields - use -1 for "no change", or the value if this is the field being set
      formData.append('_USER_Parameters_MainSwitch_C', fieldName === '_USER_Parameters_MainSwitch_C' ? value : '-1');
      formData.append('_USER_Parameters_SeasonMode_C', fieldName === '_USER_Parameters_SeasonMode_C' ? value : '-1');
      formData.append('_USER_HeatSPCtrl_Type_C', fieldName === '_USER_HeatSPCtrl_Type_C' ? value : '-1');
      formData.append('_USER_HeatSPCtrl_Curve_C', fieldName === '_USER_HeatSPCtrl_Curve_C' ? value : '-1');
      formData.append('_USER_HotWater_Source_C', fieldName === '_USER_HotWater_Source_C' ? value : '-1');
      formData.append('_USER_Heating_Source_C', fieldName === '_USER_Heating_Source_C' ? value : '-1');
      formData.append('_USER_Heating_CtrlMode_C', fieldName === '_USER_Heating_CtrlMode_C' ? value : '-1');

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
      this.log.debug(`POSTing settings form for field: ${fieldName}`);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Cookie: this.sessionCookies,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'text/html,application/xhtml+xml',
          Referer: `${this.baseUrl}/Configurations/?deviceId=${encodeURIComponent(this.deviceId)}`,
          Origin: this.baseUrl,
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
        body,
        redirect: 'manual',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      this.log.debug(`POST response status: ${response.status}`);

      // Check for redirect to login page (auth failure)
      if (response.status === 302) {
        const location = response.headers.get('location') || '';
        if (location.includes('login')) {
          if (retryOnAuth) {
            this.log.debug('Redirected to login during POST, re-authenticating...');
            this.accessToken = undefined;
            this.sessionCookies = undefined;
            const newCsrfToken = await this.fetchCsrfToken();
            return this.postSetting(fieldName, value, newCsrfToken, false);
          }
          throw new IESApiError('Authentication failed during setting update', 302, true);
        }
        // A 302 redirect to the configurations page is success
        this.log.info(`Successfully set ${fieldName} to ${value}`);
        return;
      }

      if (response.status === 401 || response.status === 403) {
        if (retryOnAuth) {
          this.log.debug('Received 401/403 during POST, re-authenticating...');
          this.accessToken = undefined;
          this.sessionCookies = undefined;
          const newCsrfToken = await this.fetchCsrfToken();
          return this.postSetting(fieldName, value, newCsrfToken, false);
        }
        throw new IESApiError('Authentication failed during setting update', response.status, true);
      }

      if (!response.ok && response.status !== 302) {
        throw new IESApiError(`Failed to save setting: ${response.status}`, response.status);
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

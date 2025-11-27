import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createMockLogger,
  createMockMonitoringResponse,
  createMockResponse,
  createMockSettingsResponse,
} from '../test/mocks.js';
import { IESClient } from './client.js';

describe('IESClient', () => {
  let client: IESClient;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let mockFetch: ReturnType<typeof vi.fn>;

  // Helper function to set up authentication mocks
  function setupAuthMocks(): void {
    // Step 1: Main app redirect
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        status: 302,
        headers: {
          location: 'https://login.ies-heatpumps.com/Account/Login?state=test',
          'set-cookie': ['cookie1=value1'],
        },
      }),
    );

    // Step 1b: Login page
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        status: 200,
        headers: { 'set-cookie': ['session=value'] },
        text: async () => '<input name="__RequestVerificationToken" value="token">',
      }),
    );

    // Step 2: Login submission
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        status: 302,
        headers: { 'set-cookie': ['auth=value'] },
      }),
    );

    // Step 3: Auth code
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        status: 200,
        text: async () => `
          <input name="code" value="code123">
          <input name="id_token" value="eyJhbGciOiJSUzI1NiJ9.eyJleHAiOjk5OTk5OTk5OTl9.sig">
        `,
      }),
    );

    // Step 4: OIDC completion
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        status: 302,
        headers: { 'set-cookie': ['final=value'] },
      }),
    );
  }

  // Helper function to set up an authenticated client
  async function setupAuthenticatedClient(): Promise<void> {
    setupAuthMocks();
    await client.authenticate();
    mockFetch.mockClear();
  }

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    client = new IESClient(
      {
        deviceId: 'test-device-123',
        username: 'test@example.com',
        password: 'test-password',
      },
      mockLogger,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with provided config', () => {
      expect(client).toBeDefined();
    });

    it('should use default base URL when not provided', () => {
      const clientWithDefault = new IESClient(
        {
          deviceId: 'device-123',
          username: 'user',
          password: 'pass',
        },
        mockLogger,
      );
      expect(clientWithDefault).toBeDefined();
    });

    it('should use custom base URL when provided', () => {
      const clientWithCustomUrl = new IESClient(
        {
          deviceId: 'device-123',
          username: 'user',
          password: 'pass',
          baseUrl: 'https://custom.example.com',
        },
        mockLogger,
      );
      expect(clientWithCustomUrl).toBeDefined();
    });
  });

  describe('authenticate', () => {
    it('should throw IESApiError on network failure during initial request', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(client.authenticate()).rejects.toThrow('Authentication failed: Network error');
    });

    it('should throw IESApiError when login page returns no redirect', async () => {
      // First call - main app, returns 302 but no location header
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: 302,
          headers: {
            'set-cookie': ['cookie=value'],
          },
        }),
      );

      await expect(client.authenticate()).rejects.toThrow('Main app did not redirect to auth server');
    });

    it('should handle complete auth flow with valid responses', async () => {
      // Step 1: Main app redirects to auth server
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: 302,
          headers: {
            location: 'https://login.ies-heatpumps.com/Account/Login?ReturnUrl=%2Fconnect%2Fauthorize&state=test-state',
            'set-cookie': ['oidc-cookie=value1; Path=/'],
          },
        }),
      );

      // Step 1b: Login page with CSRF token
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: 200,
          headers: {
            'set-cookie': ['session-cookie=value2; Path=/'],
          },
          text: async () => `
            <form>
              <input name="__RequestVerificationToken" value="csrf-token-123">
              <input name="ReturnUrl" value="%2Fconnect%2Fauthorize%3Fclient_id%3DTest">
            </form>
          `,
        }),
      );

      // Step 2: Submit login - redirects on success
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: 302,
          headers: {
            'set-cookie': ['auth-cookie=value3; Path=/'],
            location: '/connect/authorize',
          },
        }),
      );

      // Step 3: Get authorization code
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: 200,
          text: async () => `
            <form>
              <input name="code" value="auth-code-123">
              <input name="id_token" value="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjk5OTk5OTk5OTl9.sig">
              <input name="session_state" value="session-state-123">
            </form>
          `,
        }),
      );

      // Step 4: Complete OIDC flow
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: 302,
          headers: {
            'set-cookie': ['final-cookie=value4; Path=/'],
            location: '/',
          },
        }),
      );

      await expect(client.authenticate()).resolves.not.toThrow();
      expect(mockLogger.info).toHaveBeenCalledWith('Authenticating with IES...');
      expect(mockLogger.info).toHaveBeenCalledWith('Successfully authenticated with IES');
    });

    it('should throw error for invalid credentials', async () => {
      // Main app redirect
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: 302,
          headers: {
            location: 'https://login.ies-heatpumps.com/Account/Login?state=test',
            'set-cookie': ['cookie=value'],
          },
        }),
      );

      // Login page
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: 200,
          headers: { 'set-cookie': ['session=value'] },
          text: async () => '<input name="__RequestVerificationToken" value="token">',
        }),
      );

      // Login submission returns 200 with error message (invalid credentials)
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: 200,
          text: async () => '<div class="validation-summary-errors">Invalid username or password</div>',
        }),
      );

      await expect(client.authenticate()).rejects.toThrow('Invalid username or password');
    });
  });

  describe('fetchMonitoring', () => {
    beforeEach(async () => {
      // Set up authenticated state by mocking the full auth flow
      await setupAuthenticatedClient();
    });

    it('should fetch and parse monitoring data', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: 200,
          json: async () => createMockMonitoringResponse(),
        }),
      );

      const readings = await client.fetchMonitoring();

      expect(readings).toBeInstanceOf(Map);
      expect(readings.get('_USER.Input.Tamb')?.value).toBe(15.5);
      expect(readings.get('_USER.Input.TWaterTank')?.value).toBe(48.2);
      expect(readings.get('_USER.Input.THeatSupply')?.value).toBe(32.5);
    });

    it('should handle empty response groups', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: 200,
          json: async () => ({ groups: [] }),
        }),
      );

      const readings = await client.fetchMonitoring();
      expect(readings.size).toBe(0);
    });

    it('should handle missing groups in response', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: 200,
          json: async () => ({}),
        }),
      );

      const readings = await client.fetchMonitoring();
      expect(readings.size).toBe(0);
      expect(mockLogger.warn).toHaveBeenCalledWith('API response missing groups array');
    });

    it('should skip non-numeric values', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: 200,
          json: async () => ({
            groups: [
              {
                viewParameters: [
                  { id: 'valid', actualValue: '25.5' },
                  { id: 'invalid', actualValue: 'not-a-number' },
                  { id: 'toggle', actualValue: 'TOGGLE_VALUE_OFFON_1' },
                ],
              },
            ],
          }),
        }),
      );

      const readings = await client.fetchMonitoring();
      expect(readings.has('valid')).toBe(true);
      expect(readings.has('invalid')).toBe(false);
    });

    it('should handle 401 response by re-authenticating', async () => {
      // First fetch returns 401
      mockFetch.mockResolvedValueOnce(createMockResponse({ status: 401 }));

      // Re-authentication flow
      setupAuthMocks();

      // Retry fetch succeeds
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: 200,
          json: async () => createMockMonitoringResponse(),
        }),
      );

      const readings = await client.fetchMonitoring();
      expect(readings.size).toBeGreaterThan(0);
      expect(mockLogger.debug).toHaveBeenCalledWith('Received 401/403, re-authenticating and retrying...');
    });

    it('should throw error after failed retry', async () => {
      // First fetch returns 401
      mockFetch.mockResolvedValueOnce(createMockResponse({ status: 401 }));

      // Re-authentication flow
      setupAuthMocks();

      // Retry also returns 401
      mockFetch.mockResolvedValueOnce(createMockResponse({ status: 401 }));

      await expect(client.fetchMonitoring()).rejects.toThrow('Authentication failed - check your credentials');
    });
  });

  describe('fetchSettings', () => {
    beforeEach(async () => {
      await setupAuthenticatedClient();
    });

    it('should fetch and parse settings data', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: 200,
          json: async () => createMockSettingsResponse(),
        }),
      );

      const readings = await client.fetchSettings();

      expect(readings.get('_USER.HeatSPCtrl.ToffSet')?.value).toBe(2.0);
      expect(readings.get('_USER.HeatSPCtrl.TroomSet')?.value).toBe(21.0);
    });
  });

  describe('fetchReadings', () => {
    beforeEach(async () => {
      await setupAuthenticatedClient();
    });

    it('should combine monitoring and settings data', async () => {
      // Monitoring response
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: 200,
          json: async () => createMockMonitoringResponse(),
        }),
      );

      // Settings response
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: 200,
          json: async () => createMockSettingsResponse(),
        }),
      );

      const readings = await client.fetchReadings();

      // Should have readings from both
      expect(readings.has('_USER.Input.Tamb')).toBe(true);
      expect(readings.has('_USER.HeatSPCtrl.ToffSet')).toBe(true);
    });
  });

  describe('setHotWaterSetpoint', () => {
    beforeEach(async () => {
      await setupAuthenticatedClient();
    });

    it('should POST the correct setpoint value', async () => {
      // CSRF token fetch
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: 200,
          text: async () => '<input name="__RequestVerificationToken" value="csrf-token">',
        }),
      );

      // POST settings
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: 302,
          headers: { location: '/Configurations' },
        }),
      );

      await client.setHotWaterSetpoint(55);

      expect(mockLogger.info).toHaveBeenCalledWith('Setting hot water setpoint to 55°C');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://www.ies-heatpumps.com/Configurations/Save',
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });

    it('should format temperature with one decimal place', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: 200,
          text: async () => '<input name="__RequestVerificationToken" value="csrf-token">',
        }),
      );

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: 302,
          headers: { location: '/Configurations' },
        }),
      );

      await client.setHotWaterSetpoint(50);

      // Verify the body contains the formatted value
      const postCall = mockFetch.mock.calls.find((call) => call[0].includes('/Configurations/Save'));
      expect(postCall?.[1]?.body).toContain('_USER_HotWater_SetPoint_T=50.0');
    });
  });

  describe('setCurveOffset', () => {
    beforeEach(async () => {
      await setupAuthenticatedClient();
    });

    it('should POST the correct offset value', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: 200,
          text: async () => '<input name="__RequestVerificationToken" value="csrf-token">',
        }),
      );

      mockFetch.mockResolvedValueOnce(createMockResponse({ status: 302 }));

      await client.setCurveOffset(3);

      expect(mockLogger.info).toHaveBeenCalledWith('Setting curve offset to 3°C');
    });
  });

  describe('setHeatingRoomSetpoint', () => {
    beforeEach(async () => {
      await setupAuthenticatedClient();
    });

    it('should POST the correct setpoint value', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: 200,
          text: async () => '<input name="__RequestVerificationToken" value="csrf-token">',
        }),
      );

      mockFetch.mockResolvedValueOnce(createMockResponse({ status: 302 }));

      await client.setHeatingRoomSetpoint(22);

      expect(mockLogger.info).toHaveBeenCalledWith('Setting heating room setpoint to 22°C');
    });
  });

  describe('setSeasonMode', () => {
    beforeEach(async () => {
      await setupAuthenticatedClient();
    });

    it('should POST summer mode (0)', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: 200,
          text: async () => '<input name="__RequestVerificationToken" value="csrf-token">',
        }),
      );

      mockFetch.mockResolvedValueOnce(createMockResponse({ status: 302 }));

      await client.setSeasonMode(0);

      expect(mockLogger.info).toHaveBeenCalledWith('Setting season mode to Summer (0)');
    });

    it('should POST winter mode (1)', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: 200,
          text: async () => '<input name="__RequestVerificationToken" value="csrf-token">',
        }),
      );

      mockFetch.mockResolvedValueOnce(createMockResponse({ status: 302 }));

      await client.setSeasonMode(1);

      expect(mockLogger.info).toHaveBeenCalledWith('Setting season mode to Winter (1)');
    });

    it('should POST auto mode (2)', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: 200,
          text: async () => '<input name="__RequestVerificationToken" value="csrf-token">',
        }),
      );

      mockFetch.mockResolvedValueOnce(createMockResponse({ status: 302 }));

      await client.setSeasonMode(2);

      expect(mockLogger.info).toHaveBeenCalledWith('Setting season mode to Auto (2)');
    });
  });

  describe('error handling', () => {
    beforeEach(async () => {
      await setupAuthenticatedClient();
    });

    it('should handle request timeout', async () => {
      const abortError = new Error('aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      await expect(client.fetchMonitoring()).rejects.toThrow('Request timed out');
    });

    it('should handle generic network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      await expect(client.fetchMonitoring()).rejects.toThrow('Network error: Connection refused');
    });

    it('should handle non-OK responses', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ status: 500, ok: false }));

      await expect(client.fetchMonitoring()).rejects.toThrow('API request failed with status 500');
    });
  });
});

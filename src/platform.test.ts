import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IESApiError } from './api/types.js';
import { IESHeatPumpPlatform } from './platform.js';
import { createMockAPI, createMockConfig, createMockLogger } from './test/mocks.js';

// Create mock client instance methods
const mockFetchReadings = vi.fn();
const mockSetHotWaterSetpoint = vi.fn();
const mockSetCurveOffset = vi.fn();
const mockSetHeatingRoomSetpoint = vi.fn();
const mockSetSeasonMode = vi.fn();

// Mock the IESClient module with a class
vi.mock('./api/client.js', () => ({
  IESClient: class MockIESClient {
    fetchReadings = mockFetchReadings;
    setHotWaterSetpoint = mockSetHotWaterSetpoint;
    setCurveOffset = mockSetCurveOffset;
    setHeatingRoomSetpoint = mockSetHeatingRoomSetpoint;
    setSeasonMode = mockSetSeasonMode;
  },
}));

describe('IESHeatPumpPlatform', () => {
  let mockLogger: ReturnType<typeof createMockLogger>;
  let mockAPI: ReturnType<typeof createMockAPI>;
  let mockConfig: ReturnType<typeof createMockConfig>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockLogger = createMockLogger();
    mockAPI = createMockAPI();
    mockConfig = createMockConfig();

    // Reset mock client methods with default successful responses
    mockFetchReadings.mockResolvedValue(new Map());
    mockSetHotWaterSetpoint.mockResolvedValue(undefined);
    mockSetCurveOffset.mockResolvedValue(undefined);
    mockSetHeatingRoomSetpoint.mockResolvedValue(undefined);
    mockSetSeasonMode.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with logger, config, and API', () => {
      const platform = new IESHeatPumpPlatform(mockLogger, mockConfig, mockAPI);

      expect(platform.log).toBe(mockLogger);
      expect(platform.config).toBe(mockConfig);
      expect(platform.api).toBe(mockAPI);
      expect(mockLogger.debug).toHaveBeenCalledWith('Initializing IES Heat Pump platform');
    });

    it('should register didFinishLaunching callback', () => {
      new IESHeatPumpPlatform(mockLogger, mockConfig, mockAPI);

      expect(mockAPI.on).toHaveBeenCalledWith('didFinishLaunching', expect.any(Function));
    });
  });

  describe('configureAccessory', () => {
    it('should cache restored accessories', () => {
      const platform = new IESHeatPumpPlatform(mockLogger, mockConfig, mockAPI);
      const mockAccessory = {
        UUID: 'test-uuid',
        displayName: 'Test Accessory',
        context: {},
      };

      platform.configureAccessory(mockAccessory as any);

      expect(mockLogger.info).toHaveBeenCalledWith('Restoring cached accessory:', 'Test Accessory');
    });
  });

  describe('setupPlatform', () => {
    it('should error on missing deviceId', async () => {
      const configWithoutDeviceId = createMockConfig({ deviceId: undefined });
      new IESHeatPumpPlatform(mockLogger, configWithoutDeviceId, mockAPI);

      // Trigger didFinishLaunching
      const callback = (mockAPI.on as ReturnType<typeof vi.fn>).mock.calls[0][1];
      await callback();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Missing required config: deviceId. Please configure your device ID in the plugin settings.',
      );
    });

    it('should error on missing username', async () => {
      const configWithoutUsername = createMockConfig({ username: undefined });
      new IESHeatPumpPlatform(mockLogger, configWithoutUsername, mockAPI);

      const callback = (mockAPI.on as ReturnType<typeof vi.fn>).mock.calls[0][1];
      await callback();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Missing required config: username. Please provide your IES account email in the plugin settings.',
      );
    });

    it('should error on missing password', async () => {
      const configWithoutPassword = createMockConfig({ password: undefined });
      new IESHeatPumpPlatform(mockLogger, configWithoutPassword, mockAPI);

      const callback = (mockAPI.on as ReturnType<typeof vi.fn>).mock.calls[0][1];
      await callback();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Missing required config: password. Please provide your IES account password in the plugin settings.',
      );
    });

    it('should initialize API client and start polling', async () => {
      new IESHeatPumpPlatform(mockLogger, mockConfig, mockAPI);

      const callback = (mockAPI.on as ReturnType<typeof vi.fn>).mock.calls[0][1];
      await callback();

      // Verify the API client was used (fetchReadings is called during initial poll)
      expect(mockFetchReadings).toHaveBeenCalled();
    });

    it('should use default polling interval when not specified', async () => {
      const configWithoutInterval = createMockConfig({ pollingInterval: undefined });
      new IESHeatPumpPlatform(mockLogger, configWithoutInterval, mockAPI);

      const callback = (mockAPI.on as ReturnType<typeof vi.fn>).mock.calls[0][1];
      await callback();

      expect(mockLogger.info).toHaveBeenCalledWith('Starting API polling every 60 seconds');
    });

    it('should enforce minimum polling interval', async () => {
      const configWithLowInterval = createMockConfig({ pollingInterval: 10 });
      new IESHeatPumpPlatform(mockLogger, configWithLowInterval, mockAPI);

      const callback = (mockAPI.on as ReturnType<typeof vi.fn>).mock.calls[0][1];
      await callback();

      expect(mockLogger.info).toHaveBeenCalledWith('Starting API polling every 30 seconds');
    });

    it('should discover all accessory types', async () => {
      new IESHeatPumpPlatform(mockLogger, mockConfig, mockAPI);

      const callback = (mockAPI.on as ReturnType<typeof vi.fn>).mock.calls[0][1];
      await callback();

      // Check for sensor discovery
      expect(mockLogger.info).toHaveBeenCalledWith('Adding new sensor:', 'Outdoor Temperature');
      // Check for hot water discovery
      expect(mockLogger.info).toHaveBeenCalledWith('Adding new Hot Water thermostat');
      // Check for curve offset discovery
      expect(mockLogger.info).toHaveBeenCalledWith('Adding new Curve Offset accessory');
      // Check for room setpoint discovery
      expect(mockLogger.info).toHaveBeenCalledWith('Adding new Heating Room Setpoint accessory');
      // Check for season mode discovery
      expect(mockLogger.info).toHaveBeenCalledWith('Adding new Summer Mode accessory');
      expect(mockLogger.info).toHaveBeenCalledWith('Adding new Winter Mode accessory');
      expect(mockLogger.info).toHaveBeenCalledWith('Adding new Auto Mode accessory');
    });
  });

  describe('pollApi', () => {
    it('should update all accessories with readings', async () => {
      const mockReadings = new Map([
        ['_USER.Input.Tamb', { value: 15.5, raw: '15.5' }],
        ['_USER.Input.TWaterTank', { value: 48.2, raw: '48.2' }],
        ['_USER.HotWater.SetPoint', { value: 50.0, raw: '50.0' }],
        ['_USER.Output.HotTapWater', { value: 1, raw: 'TOGGLE_VALUE_OFFON_1' }],
        ['_USER.HeatSPCtrl.ToffSet', { value: 2.0, raw: '2.0' }],
        ['_USER.HeatSPCtrl.TroomSet', { value: 21.0, raw: '21.0' }],
        ['_USER.Parameters.SeasonMode', { value: 1, raw: 'TXT_TGT_SEA_MODE1' }],
      ]);

      mockFetchReadings.mockResolvedValue(mockReadings);

      new IESHeatPumpPlatform(mockLogger, mockConfig, mockAPI);

      const callback = (mockAPI.on as ReturnType<typeof vi.fn>).mock.calls[0][1];
      await callback();

      expect(mockFetchReadings).toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith('Received 7 readings from API');
    });

    it('should log warning for missing sensor readings', async () => {
      mockFetchReadings.mockResolvedValue(new Map());

      new IESHeatPumpPlatform(mockLogger, mockConfig, mockAPI);

      const callback = (mockAPI.on as ReturnType<typeof vi.fn>).mock.calls[0][1];
      await callback();

      expect(mockLogger.warn).toHaveBeenCalledWith('No reading found for sensor: _USER.Input.Tamb');
    });

    it('should handle auto-hide threshold for sensors', async () => {
      const mockReadings = new Map([['_USER.Input.Tamb', { value: -50, raw: '-50' }]]);

      mockFetchReadings.mockResolvedValue(mockReadings);

      new IESHeatPumpPlatform(mockLogger, mockConfig, mockAPI);

      const callback = (mockAPI.on as ReturnType<typeof vi.fn>).mock.calls[0][1];
      await callback();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('showing invalid reading: -50°C (below threshold'),
      );
    });

    it('should handle hot water heating state ON', async () => {
      const mockReadings = new Map([
        ['_USER.Input.TWaterTank', { value: 48.2, raw: '48.2' }],
        ['_USER.HotWater.SetPoint', { value: 50.0, raw: '50.0' }],
        ['_USER.Output.HotTapWater', { value: 1, raw: 'TOGGLE_VALUE_OFFON_1' }],
      ]);

      mockFetchReadings.mockResolvedValue(mockReadings);

      new IESHeatPumpPlatform(mockLogger, mockConfig, mockAPI);

      const callback = (mockAPI.on as ReturnType<typeof vi.fn>).mock.calls[0][1];
      await callback();

      expect(mockLogger.debug).toHaveBeenCalledWith('Hot Water heating: ON');
    });

    it('should handle hot water heating state OFF', async () => {
      const mockReadings = new Map([
        ['_USER.Input.TWaterTank', { value: 48.2, raw: '48.2' }],
        ['_USER.HotWater.SetPoint', { value: 50.0, raw: '50.0' }],
        ['_USER.Output.HotTapWater', { value: 0, raw: 'TOGGLE_VALUE_OFFON_0' }],
      ]);

      mockFetchReadings.mockResolvedValue(mockReadings);

      new IESHeatPumpPlatform(mockLogger, mockConfig, mockAPI);

      const callback = (mockAPI.on as ReturnType<typeof vi.fn>).mock.calls[0][1];
      await callback();

      expect(mockLogger.debug).toHaveBeenCalledWith('Hot Water heating: OFF');
    });

    it('should parse season mode from API response', async () => {
      const mockReadings = new Map([['_USER.Parameters.SeasonMode', { value: 2, raw: 'TXT_TGT_SEA_MODE2' }]]);

      mockFetchReadings.mockResolvedValue(mockReadings);

      new IESHeatPumpPlatform(mockLogger, mockConfig, mockAPI);

      const callback = (mockAPI.on as ReturnType<typeof vi.fn>).mock.calls[0][1];
      await callback();

      // Season mode 2 = Auto, switch should be initialized
      expect(mockLogger.debug).toHaveBeenCalledWith('Initialized Season Mode switch: Auto Mode');
    });

    it('should handle IESApiError with auth error', async () => {
      const authError = new IESApiError('Authentication failed', undefined, true);
      mockFetchReadings.mockRejectedValue(authError);

      new IESHeatPumpPlatform(mockLogger, mockConfig, mockAPI);

      const callback = (mockAPI.on as ReturnType<typeof vi.fn>).mock.calls[0][1];
      await callback();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Authentication failed - please check your username and password in the plugin config',
      );
    });

    it('should handle IESApiError with non-auth error', async () => {
      const apiError = new IESApiError('Server error');
      mockFetchReadings.mockRejectedValue(apiError);

      new IESHeatPumpPlatform(mockLogger, mockConfig, mockAPI);

      const callback = (mockAPI.on as ReturnType<typeof vi.fn>).mock.calls[0][1];
      await callback();

      expect(mockLogger.error).toHaveBeenCalledWith('API error: Server error');
    });

    it('should handle unexpected errors', async () => {
      const unexpectedError = new Error('Network failure');
      mockFetchReadings.mockRejectedValue(unexpectedError);

      new IESHeatPumpPlatform(mockLogger, mockConfig, mockAPI);

      const callback = (mockAPI.on as ReturnType<typeof vi.fn>).mock.calls[0][1];
      await callback();

      expect(mockLogger.error).toHaveBeenCalledWith('Unexpected error during API poll:', unexpectedError);
    });
  });

  describe('setHotWaterSetpoint', () => {
    it('should call API to set hot water setpoint', async () => {
      const platform = new IESHeatPumpPlatform(mockLogger, mockConfig, mockAPI);

      const callback = (mockAPI.on as ReturnType<typeof vi.fn>).mock.calls[0][1];
      await callback();

      await platform.setHotWaterSetpoint(55);

      expect(mockSetHotWaterSetpoint).toHaveBeenCalledWith(55);
    });

    it('should error when API client not initialized', async () => {
      const platform = new IESHeatPumpPlatform(mockLogger, mockConfig, mockAPI);

      // Don't trigger didFinishLaunching, so apiClient is not initialized
      await platform.setHotWaterSetpoint(55);

      expect(mockLogger.error).toHaveBeenCalledWith('Cannot set hot water setpoint - API client not initialized');
    });

    it('should handle IESApiError when setting setpoint', async () => {
      const apiError = new IESApiError('Write failed');
      mockSetHotWaterSetpoint.mockRejectedValue(apiError);

      const platform = new IESHeatPumpPlatform(mockLogger, mockConfig, mockAPI);

      const callback = (mockAPI.on as ReturnType<typeof vi.fn>).mock.calls[0][1];
      await callback();

      await platform.setHotWaterSetpoint(55);

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to set hot water setpoint: Write failed');
    });

    it('should handle unexpected error when setting setpoint', async () => {
      const unexpectedError = new Error('Network failure');
      mockSetHotWaterSetpoint.mockRejectedValue(unexpectedError);

      const platform = new IESHeatPumpPlatform(mockLogger, mockConfig, mockAPI);

      const callback = (mockAPI.on as ReturnType<typeof vi.fn>).mock.calls[0][1];
      await callback();

      await platform.setHotWaterSetpoint(55);

      expect(mockLogger.error).toHaveBeenCalledWith('Unexpected error setting hot water setpoint:', unexpectedError);
    });
  });

  describe('setCurveOffset', () => {
    it('should call API to set curve offset', async () => {
      const platform = new IESHeatPumpPlatform(mockLogger, mockConfig, mockAPI);

      const callback = (mockAPI.on as ReturnType<typeof vi.fn>).mock.calls[0][1];
      await callback();

      await platform.setCurveOffset(3);

      expect(mockSetCurveOffset).toHaveBeenCalledWith(3);
    });

    it('should error when API client not initialized', async () => {
      const platform = new IESHeatPumpPlatform(mockLogger, mockConfig, mockAPI);

      await platform.setCurveOffset(3);

      expect(mockLogger.error).toHaveBeenCalledWith('Cannot set curve offset - API client not initialized');
    });

    it('should handle IESApiError when setting offset', async () => {
      const apiError = new IESApiError('Write failed');
      mockSetCurveOffset.mockRejectedValue(apiError);

      const platform = new IESHeatPumpPlatform(mockLogger, mockConfig, mockAPI);

      const callback = (mockAPI.on as ReturnType<typeof vi.fn>).mock.calls[0][1];
      await callback();

      await platform.setCurveOffset(3);

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to set curve offset: Write failed');
    });

    it('should handle unexpected error when setting offset', async () => {
      const unexpectedError = new Error('Network failure');
      mockSetCurveOffset.mockRejectedValue(unexpectedError);

      const platform = new IESHeatPumpPlatform(mockLogger, mockConfig, mockAPI);

      const callback = (mockAPI.on as ReturnType<typeof vi.fn>).mock.calls[0][1];
      await callback();

      await platform.setCurveOffset(3);

      expect(mockLogger.error).toHaveBeenCalledWith('Unexpected error setting curve offset:', unexpectedError);
    });
  });

  describe('setHeatingRoomSetpoint', () => {
    it('should call API to set heating room setpoint', async () => {
      const platform = new IESHeatPumpPlatform(mockLogger, mockConfig, mockAPI);

      const callback = (mockAPI.on as ReturnType<typeof vi.fn>).mock.calls[0][1];
      await callback();

      await platform.setHeatingRoomSetpoint(22);

      expect(mockSetHeatingRoomSetpoint).toHaveBeenCalledWith(22);
    });

    it('should error when API client not initialized', async () => {
      const platform = new IESHeatPumpPlatform(mockLogger, mockConfig, mockAPI);

      await platform.setHeatingRoomSetpoint(22);

      expect(mockLogger.error).toHaveBeenCalledWith('Cannot set heating room setpoint - API client not initialized');
    });

    it('should handle IESApiError when setting setpoint', async () => {
      const apiError = new IESApiError('Write failed');
      mockSetHeatingRoomSetpoint.mockRejectedValue(apiError);

      const platform = new IESHeatPumpPlatform(mockLogger, mockConfig, mockAPI);

      const callback = (mockAPI.on as ReturnType<typeof vi.fn>).mock.calls[0][1];
      await callback();

      await platform.setHeatingRoomSetpoint(22);

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to set heating room setpoint: Write failed');
    });

    it('should handle unexpected error when setting setpoint', async () => {
      const unexpectedError = new Error('Network failure');
      mockSetHeatingRoomSetpoint.mockRejectedValue(unexpectedError);

      const platform = new IESHeatPumpPlatform(mockLogger, mockConfig, mockAPI);

      const callback = (mockAPI.on as ReturnType<typeof vi.fn>).mock.calls[0][1];
      await callback();

      await platform.setHeatingRoomSetpoint(22);

      expect(mockLogger.error).toHaveBeenCalledWith('Unexpected error setting heating room setpoint:', unexpectedError);
    });
  });

  describe('setSeasonMode', () => {
    it('should call API to set season mode', async () => {
      const platform = new IESHeatPumpPlatform(mockLogger, mockConfig, mockAPI);

      const callback = (mockAPI.on as ReturnType<typeof vi.fn>).mock.calls[0][1];
      await callback();

      await platform.setSeasonMode(0);

      expect(mockSetSeasonMode).toHaveBeenCalledWith(0);
    });

    it('should error when API client not initialized', async () => {
      const platform = new IESHeatPumpPlatform(mockLogger, mockConfig, mockAPI);

      await platform.setSeasonMode(0);

      expect(mockLogger.error).toHaveBeenCalledWith('Cannot set season mode - API client not initialized');
    });

    it('should handle IESApiError when setting mode', async () => {
      const apiError = new IESApiError('Write failed');
      mockSetSeasonMode.mockRejectedValue(apiError);

      const platform = new IESHeatPumpPlatform(mockLogger, mockConfig, mockAPI);

      const callback = (mockAPI.on as ReturnType<typeof vi.fn>).mock.calls[0][1];
      await callback();

      await platform.setSeasonMode(0);

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to set season mode: Write failed');
    });

    it('should handle unexpected error when setting mode', async () => {
      const unexpectedError = new Error('Network failure');
      mockSetSeasonMode.mockRejectedValue(unexpectedError);

      const platform = new IESHeatPumpPlatform(mockLogger, mockConfig, mockAPI);

      const callback = (mockAPI.on as ReturnType<typeof vi.fn>).mock.calls[0][1];
      await callback();

      await platform.setSeasonMode(0);

      expect(mockLogger.error).toHaveBeenCalledWith('Unexpected error setting season mode:', unexpectedError);
    });
  });

  describe('accessory restoration from cache', () => {
    // Helper to create a proper cached accessory mock
    function createCachedAccessoryMock(uuid: string, displayName: string): object {
      const mockService = {
        setCharacteristic: vi.fn().mockReturnThis(),
        getCharacteristic: vi.fn().mockReturnValue({
          setProps: vi.fn().mockReturnThis(),
          onGet: vi.fn().mockReturnThis(),
          onSet: vi.fn().mockReturnThis(),
        }),
        updateCharacteristic: vi.fn().mockReturnThis(),
      };
      const services = new Map<string, typeof mockService>();
      services.set('AccessoryInformation', mockService);

      return {
        UUID: uuid,
        displayName,
        context: {},
        getService: vi.fn((serviceType: any) => {
          const key = typeof serviceType === 'string' ? serviceType : serviceType?.name;
          return services.get(key);
        }),
        addService: vi.fn((serviceType: any) => {
          const key = typeof serviceType === 'string' ? serviceType : serviceType?.name;
          services.set(key, mockService);
          return mockService;
        }),
        removeService: vi.fn(),
      };
    }

    it('should restore cached sensor accessories', async () => {
      const cachedAccessory = createCachedAccessoryMock('uuid-test-device-123-_USER.Input.Tamb', 'Outdoor Temperature');

      const platform = new IESHeatPumpPlatform(mockLogger, mockConfig, mockAPI);
      platform.configureAccessory(cachedAccessory as any);

      const callback = (mockAPI.on as ReturnType<typeof vi.fn>).mock.calls[0][1];
      await callback();

      expect(mockLogger.info).toHaveBeenCalledWith('Restoring sensor from cache:', 'Outdoor Temperature');
    });

    it('should restore cached hot water accessory', async () => {
      const cachedAccessory = createCachedAccessoryMock('uuid-test-device-123-hot-water-thermostat', 'Hot Water');

      const platform = new IESHeatPumpPlatform(mockLogger, mockConfig, mockAPI);
      platform.configureAccessory(cachedAccessory as any);

      const callback = (mockAPI.on as ReturnType<typeof vi.fn>).mock.calls[0][1];
      await callback();

      expect(mockLogger.info).toHaveBeenCalledWith('Restoring Hot Water thermostat from cache');
    });

    it('should restore cached curve offset accessory', async () => {
      const cachedAccessory = createCachedAccessoryMock('uuid-test-device-123-curve-offset', 'Curve Offset');

      const platform = new IESHeatPumpPlatform(mockLogger, mockConfig, mockAPI);
      platform.configureAccessory(cachedAccessory as any);

      const callback = (mockAPI.on as ReturnType<typeof vi.fn>).mock.calls[0][1];
      await callback();

      expect(mockLogger.info).toHaveBeenCalledWith('Restoring Curve Offset from cache');
    });

    it('should restore cached heating room setpoint accessory', async () => {
      const cachedAccessory = createCachedAccessoryMock('uuid-test-device-123-heating-room-setpoint', 'Room Setpoint');

      const platform = new IESHeatPumpPlatform(mockLogger, mockConfig, mockAPI);
      platform.configureAccessory(cachedAccessory as any);

      const callback = (mockAPI.on as ReturnType<typeof vi.fn>).mock.calls[0][1];
      await callback();

      expect(mockLogger.info).toHaveBeenCalledWith('Restoring Heating Room Setpoint from cache');
    });

    it('should restore cached season mode accessories', async () => {
      const cachedSummerMode = createCachedAccessoryMock('uuid-test-device-123-season-summer-mode', 'Summer Mode');

      const platform = new IESHeatPumpPlatform(mockLogger, mockConfig, mockAPI);
      platform.configureAccessory(cachedSummerMode as any);

      const callback = (mockAPI.on as ReturnType<typeof vi.fn>).mock.calls[0][1];
      await callback();

      expect(mockLogger.info).toHaveBeenCalledWith('Restoring Summer Mode from cache');
    });

    it('should remove obsolete cached accessories', async () => {
      const obsoleteAccessory = {
        UUID: 'uuid-obsolete-accessory',
        displayName: 'Obsolete Accessory',
        context: {},
      };

      const platform = new IESHeatPumpPlatform(mockLogger, mockConfig, mockAPI);
      platform.configureAccessory(obsoleteAccessory as any);

      const callback = (mockAPI.on as ReturnType<typeof vi.fn>).mock.calls[0][1];
      await callback();

      expect(mockLogger.info).toHaveBeenCalledWith('Removing obsolete accessory:', 'Obsolete Accessory');
      expect(mockAPI.unregisterPlatformAccessories).toHaveBeenCalled();
    });
  });
});

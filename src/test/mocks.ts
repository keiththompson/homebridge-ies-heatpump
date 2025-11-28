import type { API, Characteristic, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';
import { vi } from 'vitest';

/**
 * Create a mock Homebridge Logging interface
 */
export function createMockLogger(): Logging {
  return {
    prefix: 'TestPlugin',
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
    success: vi.fn(),
  } as unknown as Logging;
}

// Internal mock characteristic type
interface MockCharacteristicInternal {
  setProps: ReturnType<typeof vi.fn>;
  onGet: ReturnType<typeof vi.fn>;
  onSet: ReturnType<typeof vi.fn>;
  updateValue: ReturnType<typeof vi.fn>;
  value: unknown;
}

/**
 * Create a mock Characteristic with common properties
 */
export function createMockCharacteristic(): Characteristic & MockCharacteristicInternal {
  const char: MockCharacteristicInternal = {
    setProps: vi.fn().mockReturnThis(),
    onGet: vi.fn().mockReturnThis(),
    onSet: vi.fn().mockReturnThis(),
    updateValue: vi.fn().mockReturnThis(),
    value: null,
  };
  return char as unknown as Characteristic & MockCharacteristicInternal;
}

/**
 * Mock characteristic constants
 */
export const MockCharacteristicConstants = {
  CurrentTemperature: 'CurrentTemperature',
  TargetTemperature: 'TargetTemperature',
  CurrentHeatingCoolingState: 'CurrentHeatingCoolingState',
  TargetHeatingCoolingState: 'TargetHeatingCoolingState',
  TemperatureDisplayUnits: 'TemperatureDisplayUnits',
  StatusFault: {
    NO_FAULT: 0,
    GENERAL_FAULT: 1,
  },
  Name: 'Name',
  Manufacturer: 'Manufacturer',
  Model: 'Model',
  SerialNumber: 'SerialNumber',
  On: 'On',
  Brightness: 'Brightness',
};

/**
 * Create a mock Service
 */
export function createMockService(): Service {
  const characteristics = new Map<string, MockCharacteristicInternal>();

  const service = {
    setCharacteristic: vi.fn((name: string, value: unknown) => {
      const char = characteristics.get(name) || createMockCharacteristic();
      char.value = value;
      characteristics.set(name, char);
      return service;
    }),
    updateCharacteristic: vi.fn((name: string, value: unknown) => {
      const char = characteristics.get(name) || createMockCharacteristic();
      char.value = value;
      characteristics.set(name, char);
      return service;
    }),
    getCharacteristic: vi.fn((name: string) => {
      if (!characteristics.has(name)) {
        characteristics.set(name, createMockCharacteristic());
      }
      return characteristics.get(name);
    }),
    addCharacteristic: vi.fn((name: string) => {
      const char = createMockCharacteristic();
      characteristics.set(name, char);
      return char;
    }),
    displayName: 'MockService',
    UUID: 'mock-service-uuid',
    _characteristics: characteristics,
  };

  return service as unknown as Service;
}

/**
 * Create a mock PlatformAccessory
 */
export function createMockAccessory(displayName = 'Mock Accessory'): PlatformAccessory {
  const services = new Map<string, Service>();
  const infoService = createMockService();
  services.set('AccessoryInformation', infoService);

  const accessory = {
    UUID: `mock-uuid-${displayName.replace(/\s/g, '-').toLowerCase()}`,
    displayName,
    context: {
      sensorDefinition: {
        paramId: '_USER.Input.Test',
        name: displayName,
        subtypeId: 'test',
      },
    },
    getService: vi.fn((serviceType: string | Service) => {
      const key = typeof serviceType === 'string' ? serviceType : (serviceType as unknown as { name: string }).name;
      return services.get(key);
    }),
    addService: vi.fn((serviceType: string | Service) => {
      const key = typeof serviceType === 'string' ? serviceType : (serviceType as unknown as { name: string }).name;
      const service = createMockService();
      services.set(key, service);
      return service;
    }),
    removeService: vi.fn(),
    _services: services,
  };

  return accessory as unknown as PlatformAccessory;
}

/**
 * Create mock Service and Characteristic types for the API
 */
export function createMockServiceTypes(): typeof Service {
  return {
    TemperatureSensor: { name: 'TemperatureSensor', UUID: 'temp-sensor-uuid' },
    Thermostat: { name: 'Thermostat', UUID: 'thermostat-uuid' },
    Switch: { name: 'Switch', UUID: 'switch-uuid' },
    Lightbulb: { name: 'Lightbulb', UUID: 'lightbulb-uuid' },
    AccessoryInformation: { name: 'AccessoryInformation', UUID: 'info-uuid' },
  } as unknown as typeof Service;
}

export function createMockCharacteristicTypes(): typeof Characteristic {
  return {
    ...MockCharacteristicConstants,
    CurrentHeatingCoolingState: {
      OFF: 0,
      HEAT: 1,
      COOL: 2,
    },
    TargetHeatingCoolingState: {
      OFF: 0,
      HEAT: 1,
      COOL: 2,
      AUTO: 3,
    },
    TemperatureDisplayUnits: {
      CELSIUS: 0,
      FAHRENHEIT: 1,
    },
    StatusFault: MockCharacteristicConstants.StatusFault,
  } as unknown as typeof Characteristic;
}

/**
 * Mock PlatformAccessory class for use with 'new' keyword
 */
class MockPlatformAccessory {
  UUID: string;
  displayName: string;
  context: Record<string, unknown> = {};
  private services = new Map<string, Service>();

  constructor(name: string, uuid: string) {
    this.displayName = name;
    this.UUID = uuid;
    this.services.set('AccessoryInformation', createMockService());
  }

  getService(serviceType: string | Service): Service | undefined {
    const key = typeof serviceType === 'string' ? serviceType : (serviceType as unknown as { name: string }).name;
    return this.services.get(key);
  }

  addService(serviceType: string | Service): Service {
    const key = typeof serviceType === 'string' ? serviceType : (serviceType as unknown as { name: string }).name;
    const service = createMockService();
    this.services.set(key, service);
    return service;
  }

  removeService(_service: Service): void {
    // No-op for mock
  }
}

/**
 * Create a mock Homebridge API
 */
export function createMockAPI(): API {
  const accessories = new Map<string, PlatformAccessory>();

  return {
    hap: {
      Service: createMockServiceTypes(),
      Characteristic: createMockCharacteristicTypes(),
      uuid: {
        generate: vi.fn((input: string) => `uuid-${input}`),
      },
    },
    on: vi.fn(),
    registerPlatformAccessories: vi.fn((pluginName: string, platformName: string, accs: PlatformAccessory[]) => {
      for (const acc of accs) {
        accessories.set(acc.UUID, acc);
      }
    }),
    unregisterPlatformAccessories: vi.fn((pluginName: string, platformName: string, accs: PlatformAccessory[]) => {
      for (const acc of accs) {
        accessories.delete(acc.UUID);
      }
    }),
    platformAccessory: MockPlatformAccessory as unknown as typeof PlatformAccessory,
    _accessories: accessories,
  } as unknown as API;
}

/**
 * Create a mock platform config
 */
export function createMockConfig(overrides: Partial<PlatformConfig> = {}): PlatformConfig {
  return {
    platform: 'IESHeatPump',
    name: 'IES Heat Pump',
    deviceId: 'test-device-123',
    username: 'test@example.com',
    password: 'test-password',
    pollingInterval: 60,
    ...overrides,
  } as PlatformConfig;
}

/**
 * Create mock fetch response
 */
export function createMockResponse(options: {
  status?: number;
  ok?: boolean;
  headers?: Record<string, string | string[]>;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
  redirected?: boolean;
  url?: string;
}): Response {
  const defaultHeaders = new Map<string, string>();
  if (options.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      if (typeof value === 'string') {
        defaultHeaders.set(key.toLowerCase(), value);
      }
    }
  }

  return {
    status: options.status ?? 200,
    ok: options.ok ?? (options.status ? options.status >= 200 && options.status < 300 : true),
    headers: {
      get: (name: string) => defaultHeaders.get(name.toLowerCase()) ?? null,
      getSetCookie: () => {
        const cookies = options.headers?.['set-cookie'];
        if (Array.isArray(cookies)) {
          return cookies;
        }
        return cookies ? [cookies] : [];
      },
    },
    json: options.json ?? (() => Promise.resolve({})),
    text: options.text ?? (() => Promise.resolve('')),
    redirected: options.redirected ?? false,
    url: options.url ?? 'https://www.ies-heatpumps.com',
  } as unknown as Response;
}

/**
 * Create a sample API response for monitoring data
 */
export function createMockMonitoringResponse(): object {
  return {
    groups: [
      {
        id: 'group1',
        name: 'Temperatures',
        viewParameters: [
          { id: '_USER.Input.Tamb', actualValue: '15.5', displayText: 'Outdoor Temperature' },
          { id: '_USER.Input.TWaterTank', actualValue: '48.2', displayText: 'Hot Water Tank' },
          { id: '_USER.Input.THeatSupply', actualValue: '32.5', displayText: 'Heating Supply' },
        ],
      },
      {
        id: 'group2',
        name: 'Settings',
        viewParameters: [
          { id: '_USER.HotWater.SetPoint', actualValue: '50.0', displayText: 'Hot Water Setpoint' },
          { id: '_USER.Output.HotTapWater', actualValue: 'TOGGLE_VALUE_OFFON_1', displayText: 'Hot Water Heating' },
        ],
      },
    ],
    deviceId: 'test-device-123',
    deviceOnline: true,
  };
}

/**
 * Create a sample API response for settings data
 */
export function createMockSettingsResponse(): object {
  return {
    groups: [
      {
        id: 'settings',
        name: 'User Settings',
        viewParameters: [
          { id: '_USER.HeatSPCtrl.ToffSet', actualValue: '2.0', displayText: 'Curve Offset' },
          { id: '_USER.HeatSPCtrl.TroomSet', actualValue: '21.0', displayText: 'Room Setpoint' },
          { id: '_USER.Parameters.SeasonMode', actualValue: 'TXT_TGT_SEA_MODE1', displayText: 'Season Mode' },
        ],
      },
    ],
    deviceId: 'test-device-123',
  };
}

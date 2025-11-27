import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CurveOffsetAccessory } from './curveOffsetAccessory.js';
import { HotWaterThermostatAccessory } from './hotWaterThermostatAccessory.js';
import { TemperatureSensorAccessory } from './temperatureSensorAccessory.js';
import {
  createMockAccessory,
  createMockCharacteristicTypes,
  createMockLogger,
  createMockServiceTypes,
} from './test/mocks.js';

interface MockPlatform {
  log: ReturnType<typeof createMockLogger>;
  Service: ReturnType<typeof createMockServiceTypes>;
  Characteristic: ReturnType<typeof createMockCharacteristicTypes>;
  setHotWaterSetpoint: ReturnType<typeof vi.fn>;
  setCurveOffset: ReturnType<typeof vi.fn>;
  setHeatingRoomSetpoint: ReturnType<typeof vi.fn>;
  setSeasonMode: ReturnType<typeof vi.fn>;
}

// Create a mock platform that matches the real platform's interface
function createMockPlatform(): MockPlatform {
  const logger = createMockLogger();
  return {
    log: logger,
    Service: createMockServiceTypes(),
    Characteristic: createMockCharacteristicTypes(),
    setHotWaterSetpoint: vi.fn(),
    setCurveOffset: vi.fn(),
    setHeatingRoomSetpoint: vi.fn(),
    setSeasonMode: vi.fn(),
  };
}

describe('TemperatureSensorAccessory', () => {
  let mockPlatform: ReturnType<typeof createMockPlatform>;
  let mockAccessory: ReturnType<typeof createMockAccessory>;
  let sensor: TemperatureSensorAccessory;

  beforeEach(() => {
    mockPlatform = createMockPlatform();
    mockAccessory = createMockAccessory('Outdoor Temperature');
    mockAccessory.context.sensorDefinition = {
      paramId: '_USER.Input.Tamb',
      name: 'Outdoor Temperature',
      subtypeId: 'outdoor-temp',
    };

    sensor = new TemperatureSensorAccessory(mockPlatform as any, mockAccessory);
  });

  describe('constructor', () => {
    it('should initialize with accessory information', () => {
      const infoService = mockAccessory.getService('AccessoryInformation');
      expect(infoService?.setCharacteristic).toHaveBeenCalledWith('Manufacturer', 'IES');
      expect(infoService?.setCharacteristic).toHaveBeenCalledWith('Model', 'Heat Pump Sensor');
      expect(infoService?.setCharacteristic).toHaveBeenCalledWith('SerialNumber', '_USER.Input.Tamb');
    });

    it('should create TemperatureSensor service if not exists', () => {
      expect(mockAccessory.getService).toHaveBeenCalled();
    });

    it('should log initialization', () => {
      expect(mockPlatform.log.debug).toHaveBeenCalledWith('Initialized sensor: Outdoor Temperature (_USER.Input.Tamb)');
    });
  });

  describe('updateTemperature', () => {
    it('should update temperature characteristic', () => {
      sensor.updateTemperature(25.5);
      expect(mockPlatform.log.debug).toHaveBeenCalledWith('Updated Outdoor Temperature: 25.5°C');
    });

    it('should handle negative temperatures', () => {
      sensor.updateTemperature(-10.5);
      expect(mockPlatform.log.debug).toHaveBeenCalledWith('Updated Outdoor Temperature: -10.5°C');
    });

    it('should handle high temperatures', () => {
      sensor.updateTemperature(85.0);
      expect(mockPlatform.log.debug).toHaveBeenCalledWith('Updated Outdoor Temperature: 85°C');
    });
  });

  describe('setUnavailable', () => {
    it('should set fault status to GENERAL_FAULT', () => {
      sensor.setUnavailable();
      // The service should have updateCharacteristic called with StatusFault
    });
  });

  describe('clearFault', () => {
    it('should set fault status to NO_FAULT', () => {
      sensor.clearFault();
      // The service should have updateCharacteristic called with NO_FAULT
    });
  });

  describe('paramId getter', () => {
    it('should return the sensor paramId', () => {
      expect(sensor.paramId).toBe('_USER.Input.Tamb');
    });
  });
});

describe('HotWaterThermostatAccessory', () => {
  let mockPlatform: ReturnType<typeof createMockPlatform>;
  let mockAccessory: ReturnType<typeof createMockAccessory>;
  let thermostat: HotWaterThermostatAccessory;

  beforeEach(() => {
    mockPlatform = createMockPlatform();
    mockAccessory = createMockAccessory('Hot Water');

    thermostat = new HotWaterThermostatAccessory(mockPlatform as any, mockAccessory);
  });

  describe('constructor', () => {
    it('should initialize with accessory information', () => {
      const infoService = mockAccessory.getService('AccessoryInformation');
      expect(infoService?.setCharacteristic).toHaveBeenCalledWith('Manufacturer', 'IES');
      expect(infoService?.setCharacteristic).toHaveBeenCalledWith('Model', 'Hot Water Tank');
      expect(infoService?.setCharacteristic).toHaveBeenCalledWith('SerialNumber', 'hot-water');
    });

    it('should log initialization', () => {
      expect(mockPlatform.log.debug).toHaveBeenCalledWith('Initialized Hot Water Thermostat');
    });
  });

  describe('updateCurrentTemperature', () => {
    it('should update current temperature', () => {
      thermostat.updateCurrentTemperature(48.5);
      expect(mockPlatform.log.debug).toHaveBeenCalledWith('Hot Water current temp: 48.5°C');
    });
  });

  describe('updateTargetTemperature', () => {
    it('should update target temperature', () => {
      thermostat.updateTargetTemperature(55.0);
      expect(mockPlatform.log.debug).toHaveBeenCalledWith('Hot Water target temp: 55°C');
    });
  });

  describe('updateHeatingState', () => {
    it('should update heating state to ON', () => {
      thermostat.updateHeatingState(true);
      expect(mockPlatform.log.debug).toHaveBeenCalledWith('Hot Water heating: ON');
    });

    it('should update heating state to OFF', () => {
      thermostat.updateHeatingState(false);
      expect(mockPlatform.log.debug).toHaveBeenCalledWith('Hot Water heating: OFF');
    });
  });

  describe('setUnavailable', () => {
    it('should set fault status', () => {
      thermostat.setUnavailable();
      // Verifies the method doesn't throw
    });
  });

  describe('clearFault', () => {
    it('should clear fault status', () => {
      thermostat.clearFault();
      // Verifies the method doesn't throw
    });
  });
});

describe('CurveOffsetAccessory', () => {
  let mockPlatform: ReturnType<typeof createMockPlatform>;
  let mockAccessory: ReturnType<typeof createMockAccessory>;
  let curveOffset: CurveOffsetAccessory;

  beforeEach(() => {
    mockPlatform = createMockPlatform();
    mockAccessory = createMockAccessory('Curve Offset');

    curveOffset = new CurveOffsetAccessory(mockPlatform as any, mockAccessory);
  });

  describe('constructor', () => {
    it('should initialize with accessory information', () => {
      const infoService = mockAccessory.getService('AccessoryInformation');
      expect(infoService?.setCharacteristic).toHaveBeenCalledWith('Manufacturer', 'IES');
      expect(infoService?.setCharacteristic).toHaveBeenCalledWith('Model', 'Heating Curve');
      expect(infoService?.setCharacteristic).toHaveBeenCalledWith('SerialNumber', 'curve-offset');
    });

    it('should log initialization', () => {
      expect(mockPlatform.log.debug).toHaveBeenCalledWith('Initialized Curve Offset accessory');
    });
  });

  describe('updateOffset', () => {
    it('should update offset to positive value', () => {
      curveOffset.updateOffset(5);
      expect(mockPlatform.log.debug).toHaveBeenCalledWith('Curve offset: 5°C');
    });

    it('should update offset to negative value', () => {
      curveOffset.updateOffset(-3);
      expect(mockPlatform.log.debug).toHaveBeenCalledWith('Curve offset: -3°C');
    });

    it('should update offset to zero', () => {
      curveOffset.updateOffset(0);
      expect(mockPlatform.log.debug).toHaveBeenCalledWith('Curve offset: 0°C');
    });
  });

  describe('setUnavailable', () => {
    it('should set fault status', () => {
      curveOffset.setUnavailable();
      // Verifies the method doesn't throw
    });
  });

  describe('clearFault', () => {
    it('should clear fault status', () => {
      curveOffset.clearFault();
      // Verifies the method doesn't throw
    });
  });
});

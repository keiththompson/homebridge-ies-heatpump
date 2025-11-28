import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CurveOffsetAccessory } from './curveOffsetAccessory.js';
import { HeatingRoomSetpointAccessory } from './heatingRoomSetpointAccessory.js';
import { HotWaterThermostatAccessory } from './hotWaterThermostatAccessory.js';
import { SeasonModeSwitchAccessory } from './seasonModeAccessory.js';
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
      const service = (mockAccessory.addService as ReturnType<typeof vi.fn>).mock.results[0]?.value;
      expect(service?.updateCharacteristic).toHaveBeenCalledWith(
        mockPlatform.Characteristic.StatusFault,
        mockPlatform.Characteristic.StatusFault.GENERAL_FAULT,
      );
    });
  });

  describe('clearFault', () => {
    it('should set fault status to NO_FAULT', () => {
      sensor.clearFault();
      const service = (mockAccessory.addService as ReturnType<typeof vi.fn>).mock.results[0]?.value;
      expect(service?.updateCharacteristic).toHaveBeenCalledWith(
        mockPlatform.Characteristic.StatusFault,
        mockPlatform.Characteristic.StatusFault.NO_FAULT,
      );
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
    it('should set fault status to GENERAL_FAULT', () => {
      thermostat.setUnavailable();
      const service = (mockAccessory.addService as ReturnType<typeof vi.fn>).mock.results[0]?.value;
      expect(service?.updateCharacteristic).toHaveBeenCalledWith(
        mockPlatform.Characteristic.StatusFault,
        mockPlatform.Characteristic.StatusFault.GENERAL_FAULT,
      );
    });
  });

  describe('clearFault', () => {
    it('should clear fault status to NO_FAULT', () => {
      thermostat.clearFault();
      const service = (mockAccessory.addService as ReturnType<typeof vi.fn>).mock.results[0]?.value;
      expect(service?.updateCharacteristic).toHaveBeenCalledWith(
        mockPlatform.Characteristic.StatusFault,
        mockPlatform.Characteristic.StatusFault.NO_FAULT,
      );
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
    it('should set fault status to GENERAL_FAULT', () => {
      curveOffset.setUnavailable();
      const service = (mockAccessory.addService as ReturnType<typeof vi.fn>).mock.results[0]?.value;
      expect(service?.updateCharacteristic).toHaveBeenCalledWith(
        mockPlatform.Characteristic.StatusFault,
        mockPlatform.Characteristic.StatusFault.GENERAL_FAULT,
      );
    });
  });

  describe('clearFault', () => {
    it('should clear fault status to NO_FAULT', () => {
      curveOffset.clearFault();
      const service = (mockAccessory.addService as ReturnType<typeof vi.fn>).mock.results[0]?.value;
      expect(service?.updateCharacteristic).toHaveBeenCalledWith(
        mockPlatform.Characteristic.StatusFault,
        mockPlatform.Characteristic.StatusFault.NO_FAULT,
      );
    });
  });
});

describe('HeatingRoomSetpointAccessory', () => {
  let mockPlatform: ReturnType<typeof createMockPlatform>;
  let mockAccessory: ReturnType<typeof createMockAccessory>;
  let heatingSetpoint: HeatingRoomSetpointAccessory;

  beforeEach(() => {
    mockPlatform = createMockPlatform();
    mockAccessory = createMockAccessory('Room Setpoint');

    heatingSetpoint = new HeatingRoomSetpointAccessory(mockPlatform as any, mockAccessory);
  });

  describe('constructor', () => {
    it('should initialize with accessory information', () => {
      const infoService = mockAccessory.getService('AccessoryInformation');
      expect(infoService?.setCharacteristic).toHaveBeenCalledWith('Manufacturer', 'IES');
      expect(infoService?.setCharacteristic).toHaveBeenCalledWith('Model', 'Heating Control');
      expect(infoService?.setCharacteristic).toHaveBeenCalledWith('SerialNumber', 'heating-room-setpoint');
    });

    it('should log initialization', () => {
      expect(mockPlatform.log.debug).toHaveBeenCalledWith('Initialized Heating Room Setpoint accessory');
    });
  });

  describe('updateSetpoint', () => {
    it('should update setpoint temperature', () => {
      heatingSetpoint.updateSetpoint(22);
      expect(mockPlatform.log.debug).toHaveBeenCalledWith('Heating room setpoint: 22°C');
    });

    it('should update to minimum value', () => {
      heatingSetpoint.updateSetpoint(5);
      expect(mockPlatform.log.debug).toHaveBeenCalledWith('Heating room setpoint: 5°C');
    });

    it('should update to maximum value', () => {
      heatingSetpoint.updateSetpoint(40);
      expect(mockPlatform.log.debug).toHaveBeenCalledWith('Heating room setpoint: 40°C');
    });
  });

  describe('setUnavailable', () => {
    it('should set fault status to GENERAL_FAULT', () => {
      heatingSetpoint.setUnavailable();
      const service = (mockAccessory.addService as ReturnType<typeof vi.fn>).mock.results[0]?.value;
      expect(service?.updateCharacteristic).toHaveBeenCalledWith(
        mockPlatform.Characteristic.StatusFault,
        mockPlatform.Characteristic.StatusFault.GENERAL_FAULT,
      );
    });
  });

  describe('clearFault', () => {
    it('should clear fault status to NO_FAULT', () => {
      heatingSetpoint.clearFault();
      const service = (mockAccessory.addService as ReturnType<typeof vi.fn>).mock.results[0]?.value;
      expect(service?.updateCharacteristic).toHaveBeenCalledWith(
        mockPlatform.Characteristic.StatusFault,
        mockPlatform.Characteristic.StatusFault.NO_FAULT,
      );
    });
  });
});

describe('SeasonModeSwitchAccessory', () => {
  let mockPlatform: ReturnType<typeof createMockPlatform>;
  let mockAccessory: ReturnType<typeof createMockAccessory>;
  let seasonSwitch: SeasonModeSwitchAccessory;
  let mockOnSetMode: (mode: number) => Promise<void>;
  let mockGetCurrentMode: () => number;

  beforeEach(() => {
    mockPlatform = createMockPlatform();
    mockAccessory = createMockAccessory('Winter Mode');
    mockOnSetMode = vi.fn().mockResolvedValue(undefined) as unknown as (mode: number) => Promise<void>;
    mockGetCurrentMode = vi.fn().mockReturnValue(1) as unknown as () => number;

    seasonSwitch = new SeasonModeSwitchAccessory(
      mockPlatform as any,
      mockAccessory,
      1, // modeValue: Winter
      'Winter Mode',
      mockOnSetMode,
      mockGetCurrentMode,
    );
  });

  describe('constructor', () => {
    it('should initialize with accessory information', () => {
      const infoService = mockAccessory.getService('AccessoryInformation');
      expect(infoService?.setCharacteristic).toHaveBeenCalledWith('Manufacturer', 'IES');
      expect(infoService?.setCharacteristic).toHaveBeenCalledWith('Model', 'Season Mode');
      expect(infoService?.setCharacteristic).toHaveBeenCalledWith('SerialNumber', 'season-winter mode');
    });

    it('should log initialization', () => {
      expect(mockPlatform.log.debug).toHaveBeenCalledWith('Initialized Season Mode switch: Winter Mode');
    });

    it('should expose modeValue and modeName', () => {
      expect(seasonSwitch.modeValue).toBe(1);
      expect(seasonSwitch.modeName).toBe('Winter Mode');
    });
  });

  describe('updateState', () => {
    it('should update switch state to ON when mode matches', () => {
      seasonSwitch.updateState(1); // Winter mode
      const service = (mockAccessory.addService as ReturnType<typeof vi.fn>).mock.results[0]?.value;
      expect(service?.updateCharacteristic).toHaveBeenCalledWith('On', true);
    });

    it('should update switch state to OFF when mode does not match', () => {
      seasonSwitch.updateState(0); // Summer mode
      const service = (mockAccessory.addService as ReturnType<typeof vi.fn>).mock.results[0]?.value;
      expect(service?.updateCharacteristic).toHaveBeenCalledWith('On', false);
    });
  });

  describe('setUnavailable', () => {
    it('should set fault status to GENERAL_FAULT', () => {
      seasonSwitch.setUnavailable();
      const service = (mockAccessory.addService as ReturnType<typeof vi.fn>).mock.results[0]?.value;
      expect(service?.updateCharacteristic).toHaveBeenCalledWith(
        mockPlatform.Characteristic.StatusFault,
        mockPlatform.Characteristic.StatusFault.GENERAL_FAULT,
      );
    });
  });

  describe('clearFault', () => {
    it('should clear fault status to NO_FAULT', () => {
      seasonSwitch.clearFault();
      const service = (mockAccessory.addService as ReturnType<typeof vi.fn>).mock.results[0]?.value;
      expect(service?.updateCharacteristic).toHaveBeenCalledWith(
        mockPlatform.Characteristic.StatusFault,
        mockPlatform.Characteristic.StatusFault.NO_FAULT,
      );
    });
  });
});

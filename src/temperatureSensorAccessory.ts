import type { PlatformAccessory, Service } from 'homebridge';

import type { IESHeatPumpPlatform } from './platform.js';
import type { SensorDefinition } from './settings.js';

/**
 * Temperature Sensor Accessory
 * Exposes a HomeKit TemperatureSensor service for IES heat pump temperature readings
 */
export class TemperatureSensorAccessory {
  private readonly service: Service;
  public readonly accessory: PlatformAccessory;

  constructor(
    private readonly platform: IESHeatPumpPlatform,
    accessory: PlatformAccessory,
  ) {
    this.accessory = accessory;
    const sensorDef: SensorDefinition = accessory.context.sensorDefinition;

    // Set accessory information
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'IES')
      .setCharacteristic(this.platform.Characteristic.Model, 'Heat Pump Sensor')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, sensorDef.paramId);

    // Get or create TemperatureSensor service
    this.service =
      this.accessory.getService(this.platform.Service.TemperatureSensor) ||
      this.accessory.addService(this.platform.Service.TemperatureSensor);

    // Set display name
    this.service.setCharacteristic(this.platform.Characteristic.Name, sensorDef.name);

    // Configure temperature characteristic
    // HomeKit TemperatureSensor has default range of 0-100, extend to show actual API values
    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature).setProps({
      minValue: -100,
      maxValue: 150,
    });

    this.platform.log.debug(`Initialized sensor: ${sensorDef.name} (${sensorDef.paramId})`);
  }

  /**
   * Update the temperature reading from API data
   */
  updateTemperature(value: number): void {
    this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, value);
    this.platform.log.debug(`Updated ${this.accessory.context.sensorDefinition.name}: ${value}°C`);
  }

  /**
   * Mark sensor as unavailable (e.g., API error)
   */
  setUnavailable(): void {
    this.service.updateCharacteristic(
      this.platform.Characteristic.StatusFault,
      this.platform.Characteristic.StatusFault.GENERAL_FAULT,
    );
  }

  /**
   * Clear fault status
   */
  clearFault(): void {
    this.service.updateCharacteristic(
      this.platform.Characteristic.StatusFault,
      this.platform.Characteristic.StatusFault.NO_FAULT,
    );
  }

  /**
   * Get the paramId this sensor tracks
   */
  get paramId(): string {
    return this.accessory.context.sensorDefinition.paramId;
  }
}

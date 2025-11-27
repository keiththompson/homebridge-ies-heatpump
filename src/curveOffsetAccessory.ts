import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { IESHeatPumpPlatform } from './platform.js';

/**
 * Curve Offset Accessory
 * Exposes a HomeKit Thermostat service for adjusting the heating curve offset
 * Range: -10 to +10°C, whole numbers only
 */
export class CurveOffsetAccessory {
  private readonly service: Service;
  public readonly accessory: PlatformAccessory;

  // Current state
  private currentOffset = 0;

  // Offset range from API
  private readonly minOffset = -10;
  private readonly maxOffset = 10;

  constructor(
    private readonly platform: IESHeatPumpPlatform,
    accessory: PlatformAccessory,
  ) {
    this.accessory = accessory;

    // Set accessory information
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'IES')
      .setCharacteristic(this.platform.Characteristic.Model, 'Heating Curve')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, 'curve-offset');

    // Get or create Thermostat service
    this.service =
      this.accessory.getService(this.platform.Service.Thermostat) ||
      this.accessory.addService(this.platform.Service.Thermostat);

    // Set display name
    this.service.setCharacteristic(this.platform.Characteristic.Name, 'Curve Offset');

    // Configure Current Temperature (shows current offset)
    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature).setProps({
      minValue: this.minOffset,
      maxValue: this.maxOffset,
    });

    // Configure Target Temperature (settable offset)
    this.service
      .getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .setProps({
        minValue: this.minOffset,
        maxValue: this.maxOffset,
        minStep: 1,
      })
      .onGet(this.getTargetOffset.bind(this))
      .onSet(this.setTargetOffset.bind(this));

    // Only AUTO mode - offset is always active
    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState).setProps({
      validValues: [this.platform.Characteristic.CurrentHeatingCoolingState.OFF],
    });

    this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState).setProps({
      validValues: [this.platform.Characteristic.TargetHeatingCoolingState.AUTO],
    });

    // Set target state to AUTO
    this.service.updateCharacteristic(
      this.platform.Characteristic.TargetHeatingCoolingState,
      this.platform.Characteristic.TargetHeatingCoolingState.AUTO,
    );

    // Set current state to OFF (offset doesn't "heat")
    this.service.updateCharacteristic(
      this.platform.Characteristic.CurrentHeatingCoolingState,
      this.platform.Characteristic.CurrentHeatingCoolingState.OFF,
    );

    this.platform.log.debug('Initialized Curve Offset accessory');
  }

  /**
   * Update current offset from API
   */
  updateOffset(value: number): void {
    this.currentOffset = value;
    this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, value);
    this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature, value);
    this.platform.log.debug(`Curve offset: ${value}°C`);
  }

  /**
   * Get target offset for HomeKit
   */
  private async getTargetOffset(): Promise<CharacteristicValue> {
    return this.currentOffset;
  }

  /**
   * Set target offset from HomeKit
   */
  private async setTargetOffset(value: CharacteristicValue): Promise<void> {
    const newOffset = value as number;
    this.platform.log.info(`Setting curve offset to ${newOffset}°C`);

    this.currentOffset = newOffset;
    await this.platform.setCurveOffset(newOffset);
  }

  /**
   * Mark as unavailable
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
}

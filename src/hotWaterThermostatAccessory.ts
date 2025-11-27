import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import type { IESHeatPumpPlatform } from './platform.js';

/**
 * Hot Water Thermostat Accessory
 * Exposes a HomeKit Thermostat service for hot water tank control
 */
export class HotWaterThermostatAccessory {
  private readonly service: Service;
  public readonly accessory: PlatformAccessory;

  // Current state
  private currentTemperature = 0;
  private targetTemperature = 50; // Default setpoint
  private isHeating = false;

  // Setpoint range from API
  private readonly minSetpoint = 5;
  private readonly maxSetpoint = 70;

  constructor(
    private readonly platform: IESHeatPumpPlatform,
    accessory: PlatformAccessory,
  ) {
    this.accessory = accessory;

    // Set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'IES')
      .setCharacteristic(this.platform.Characteristic.Model, 'Hot Water Tank')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, 'hot-water');

    // Get or create Thermostat service
    this.service = this.accessory.getService(this.platform.Service.Thermostat)
      || this.accessory.addService(this.platform.Service.Thermostat);

    // Set display name
    this.service.setCharacteristic(this.platform.Characteristic.Name, 'Hot Water');

    // Configure Current Temperature
    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .setProps({
        minValue: 0,
        maxValue: 100,
      });

    // Configure Target Temperature with valid range
    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .setProps({
        minValue: this.minSetpoint,
        maxValue: this.maxSetpoint,
        minStep: 1,
      })
      .onGet(this.getTargetTemperature.bind(this))
      .onSet(this.setTargetTemperature.bind(this));

    // Configure Heating/Cooling State
    // Hot water only heats, so we limit the valid values
    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .setProps({
        validValues: [
          this.platform.Characteristic.CurrentHeatingCoolingState.OFF,
          this.platform.Characteristic.CurrentHeatingCoolingState.HEAT,
        ],
      });

    // Only AUTO mode - heat pump manages heating automatically
    this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .setProps({
        validValues: [
          this.platform.Characteristic.TargetHeatingCoolingState.AUTO,
        ],
      });

    // Set target state to AUTO (heat pump controls it)
    this.service.updateCharacteristic(
      this.platform.Characteristic.TargetHeatingCoolingState,
      this.platform.Characteristic.TargetHeatingCoolingState.AUTO,
    );

    this.platform.log.debug('Initialized Hot Water Thermostat');
  }

  /**
   * Update current temperature from API
   */
  updateCurrentTemperature(value: number): void {
    this.currentTemperature = value;
    this.service.updateCharacteristic(
      this.platform.Characteristic.CurrentTemperature,
      value,
    );
    this.platform.log.debug(`Hot Water current temp: ${value}°C`);
  }

  /**
   * Update target temperature (setpoint) from API
   */
  updateTargetTemperature(value: number): void {
    this.targetTemperature = value;
    this.service.updateCharacteristic(
      this.platform.Characteristic.TargetTemperature,
      value,
    );
    this.platform.log.debug(`Hot Water target temp: ${value}°C`);
  }

  /**
   * Update heating state from API
   */
  updateHeatingState(isHeating: boolean): void {
    this.isHeating = isHeating;
    const state = isHeating
      ? this.platform.Characteristic.CurrentHeatingCoolingState.HEAT
      : this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
    this.service.updateCharacteristic(
      this.platform.Characteristic.CurrentHeatingCoolingState,
      state,
    );
    this.platform.log.debug(`Hot Water heating: ${isHeating ? 'ON' : 'OFF'}`);
  }

  /**
   * Get target temperature for HomeKit
   */
  private async getTargetTemperature(): Promise<CharacteristicValue> {
    return this.targetTemperature;
  }

  /**
   * Set target temperature from HomeKit
   */
  private async setTargetTemperature(value: CharacteristicValue): Promise<void> {
    const newTemp = value as number;
    this.platform.log.info(`Setting hot water setpoint to ${newTemp}°C`);

    // TODO: Implement API write
    // For now, just update local state
    this.targetTemperature = newTemp;

    // Notify platform to write to API
    await this.platform.setHotWaterSetpoint(newTemp);
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

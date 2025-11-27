import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import type { IESHeatPumpPlatform } from './platform.js';

/**
 * Heating Room Setpoint Accessory
 * Exposes a HomeKit Thermostat service for adjusting the heating room setpoint
 * Range: 5 to 40°C, whole numbers only
 */
export class HeatingRoomSetpointAccessory {
  private readonly service: Service;
  public readonly accessory: PlatformAccessory;

  // Current state
  private currentSetpoint = 20;

  // Setpoint range from API
  private readonly minSetpoint = 5;
  private readonly maxSetpoint = 40;

  constructor(
    private readonly platform: IESHeatPumpPlatform,
    accessory: PlatformAccessory,
  ) {
    this.accessory = accessory;

    // Set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'IES')
      .setCharacteristic(this.platform.Characteristic.Model, 'Heating Control')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, 'heating-room-setpoint');

    // Get or create Thermostat service
    this.service = this.accessory.getService(this.platform.Service.Thermostat)
      || this.accessory.addService(this.platform.Service.Thermostat);

    // Set display name
    this.service.setCharacteristic(this.platform.Characteristic.Name, 'Room Setpoint');

    // Configure Current Temperature (shows current setpoint)
    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .setProps({
        minValue: this.minSetpoint,
        maxValue: this.maxSetpoint,
      });

    // Configure Target Temperature (settable setpoint)
    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .setProps({
        minValue: this.minSetpoint,
        maxValue: this.maxSetpoint,
        minStep: 1,
      })
      .onGet(this.getTargetSetpoint.bind(this))
      .onSet(this.setTargetSetpoint.bind(this));

    // Only AUTO mode
    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .setProps({
        validValues: [
          this.platform.Characteristic.CurrentHeatingCoolingState.OFF,
        ],
      });

    this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .setProps({
        validValues: [
          this.platform.Characteristic.TargetHeatingCoolingState.AUTO,
        ],
      });

    // Set target state to AUTO
    this.service.updateCharacteristic(
      this.platform.Characteristic.TargetHeatingCoolingState,
      this.platform.Characteristic.TargetHeatingCoolingState.AUTO,
    );

    // Set current state to OFF
    this.service.updateCharacteristic(
      this.platform.Characteristic.CurrentHeatingCoolingState,
      this.platform.Characteristic.CurrentHeatingCoolingState.OFF,
    );

    this.platform.log.debug('Initialized Heating Room Setpoint accessory');
  }

  /**
   * Update setpoint from API
   */
  updateSetpoint(value: number): void {
    this.currentSetpoint = value;
    this.service.updateCharacteristic(
      this.platform.Characteristic.CurrentTemperature,
      value,
    );
    this.service.updateCharacteristic(
      this.platform.Characteristic.TargetTemperature,
      value,
    );
    this.platform.log.debug(`Heating room setpoint: ${value}°C`);
  }

  /**
   * Get target setpoint for HomeKit
   */
  private async getTargetSetpoint(): Promise<CharacteristicValue> {
    return this.currentSetpoint;
  }

  /**
   * Set target setpoint from HomeKit
   */
  private async setTargetSetpoint(value: CharacteristicValue): Promise<void> {
    const newSetpoint = value as number;
    this.platform.log.info(`Setting heating room setpoint to ${newSetpoint}°C`);

    this.currentSetpoint = newSetpoint;
    await this.platform.setHeatingRoomSetpoint(newSetpoint);
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

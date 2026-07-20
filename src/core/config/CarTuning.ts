import { VEHICLE_CONFIG, type VehicleConfig } from './GameplayScale';

export interface CarTuning {
  readonly mass: number;
  readonly halfExtents: { readonly x: number; readonly y: number; readonly z: number };
  readonly colliderBorderRadius: number;
  readonly colliderPoints: readonly { readonly x: number; readonly y: number; readonly z: number }[];
  readonly wheelRadius: number;
  readonly wheelContactTolerance: number;
  readonly surfaceAdhesionForce: number;
  readonly surfaceAdhesionSpeedForce: number;
  readonly surfaceMinimumAdhesionFactor: number;
  readonly surfaceGravityCompensation: number;
  readonly surfaceAlignmentTorque: number;
  readonly surfaceHeadingTorque: number;
  readonly surfaceHeadingDamping: number;
  readonly surfaceAdhesionGraceSeconds: number;
  readonly surfaceContactProbeExtension: number;
  readonly engineForce: number;
  readonly reverseForce: number;
  readonly maximumGroundDriveSpeed: number;
  readonly maximumGroundReverseSpeed: number;
  readonly groundDriveSpeedFalloffRange: number;
  readonly brakeForce: number;
  readonly brakeToReverseSpeed: number;
  readonly coastDrag: number;
  readonly idleBrakeDrag: number;
  readonly idleBrakeSpeed: number;
  readonly maximumCoastForce: number;
  readonly lateralGrip: number;
  readonly powerslideGrip: number;
  readonly maximumLateralForce: number;
  readonly maximumPowerslideForce: number;
  readonly maximumSteerAngle: number;
  readonly powerslideSteerMultiplier: number;
  readonly groundTurnRadius: number;
  readonly groundSteeringTorque: number;
  readonly groundSteeringResponse: number;
  readonly surfaceSteeringAssist: number;
  readonly groundTractionAlignmentTorque: number;
  readonly maximumGroundTractionAlignmentTorque: number;
  readonly groundYawDamping: number;
  readonly powerslideSteeringTorque: number;
  readonly boostForce: number;
  readonly maximumGroundBoostSpeed: number;
  readonly groundBoostSpeedFalloffRange: number;
  readonly boostConsumption: number;
  readonly boostRecharge: number;
  readonly ceilingRecoverySeconds: number;
  readonly ceilingBounceFactor: number;
  readonly minimumCeilingFallSpeed: number;
  readonly jumpImpulse: number;
  readonly dodgeImpulse: number;
  readonly dodgePitchTorque: number;
  readonly dodgeRollTorque: number;
  readonly dodgeControlLockSeconds: number;
  readonly dodgeAutoLevelSeconds: number;
  readonly dodgeAutoLevelDelaySeconds: number;
  readonly dodgeAutoLevelTorque: number;
  readonly dodgeAutoLevelDamping: number;
  readonly aerialTorque: number;
  readonly aerialControlGain: number;
  readonly maximumAerialAngularSpeed: number;
  readonly recoveryJumpImpulse: number;
  readonly recoveryControlLockSeconds: number;
  readonly recoveryTorque: number;
  readonly sideRecoveryTorque: number;
  readonly recoveryUprightThreshold: number;
  readonly secondJumpWindowSeconds: number;
}

export const carTuningForVehicleConfig = (vehicle: VehicleConfig): CarTuning => ({
  mass: 850,
  halfExtents: { x: 0.92, y: 0.42, z: 1.38 },
  colliderBorderRadius: 0.12,
  colliderPoints: [
    // The physical wheels support the car; the chassis stays clear of curved surfaces.
    { x: -0.58, y: -0.14, z: -1.02 }, { x: 0.58, y: -0.14, z: -1.02 },
    { x: -0.58, y: -0.14, z: 1.02 }, { x: 0.58, y: -0.14, z: 1.02 },
    { x: -0.92, y: -0.1, z: -1.2 }, { x: 0.92, y: -0.1, z: -1.2 },
    { x: -0.92, y: -0.1, z: 1.2 }, { x: 0.92, y: -0.1, z: 1.2 },
    { x: -0.82, y: 0.04, z: -1.38 }, { x: 0.82, y: 0.04, z: -1.38 },
    { x: -0.92, y: 0.34, z: -0.48 }, { x: 0.92, y: 0.34, z: -0.48 },
    { x: -0.92, y: 0.42, z: 0.48 }, { x: 0.92, y: 0.42, z: 0.48 },
    { x: -0.92, y: 0.34, z: 1.38 }, { x: 0.92, y: 0.34, z: 1.38 },
  ],
  wheelRadius: 0.34,
  wheelContactTolerance: 0.12,
  surfaceAdhesionForce: 12_000,
  surfaceAdhesionSpeedForce: 260,
  surfaceMinimumAdhesionFactor: 0.65,
  surfaceGravityCompensation: 0.72,
  surfaceAlignmentTorque: 200_000,
  surfaceHeadingTorque: 75_000,
  surfaceHeadingDamping: 20_000,
  surfaceAdhesionGraceSeconds: 0.3,
  surfaceContactProbeExtension: 0.9,
  engineForce: 9_500 * vehicle.accelerationMultiplier,
  reverseForce: 6_500 * vehicle.reverseAccelerationMultiplier,
  maximumGroundDriveSpeed: vehicle.driveTopSpeed,
  maximumGroundReverseSpeed: vehicle.reverseTopSpeed,
  groundDriveSpeedFalloffRange: 4,
  brakeForce: 24_000 * vehicle.brakeMultiplier,
  brakeToReverseSpeed: 0.8,
  coastDrag: 1_200,
  idleBrakeDrag: 10_000,
  idleBrakeSpeed: 0.3,
  maximumCoastForce: 1_200,
  lateralGrip: 12_500,
  powerslideGrip: 1_800,
  maximumLateralForce: 14_000,
  maximumPowerslideForce: 5_500,
  maximumSteerAngle: 0.265 * vehicle.steeringMultiplier,
  powerslideSteerMultiplier: 1.95,
  groundTurnRadius: 28 / vehicle.steeringMultiplier,
  groundSteeringTorque: 5_000 * vehicle.steeringMultiplier,
  groundSteeringResponse: 8_000,
  surfaceSteeringAssist: 1,
  groundTractionAlignmentTorque: 12_000,
  maximumGroundTractionAlignmentTorque: 4_000,
  groundYawDamping: 8_000,
  powerslideSteeringTorque: 2_300 * vehicle.steeringMultiplier,
  boostForce: 24_000 * vehicle.boostAccelerationMultiplier,
  maximumGroundBoostSpeed: vehicle.boostTopSpeed,
  groundBoostSpeedFalloffRange: 4,
  boostConsumption: vehicle.boostConsumptionPerSecond,
  boostRecharge: vehicle.boostRechargePerSecond,
  ceilingRecoverySeconds: 0.65,
  ceilingBounceFactor: 0.3,
  minimumCeilingFallSpeed: 2,
  jumpImpulse: 10_000 * vehicle.jumpPowerMultiplier,
  dodgeImpulse: 4_500 * vehicle.dodgePowerMultiplier,
  dodgePitchTorque: 5_200 * vehicle.dodgePowerMultiplier,
  dodgeRollTorque: 3_400 * vehicle.dodgePowerMultiplier,
  dodgeControlLockSeconds: 0.55,
  dodgeAutoLevelSeconds: 1.6,
  dodgeAutoLevelDelaySeconds: 0.28,
  dodgeAutoLevelTorque: 18_000,
  dodgeAutoLevelDamping: 4_200,
  aerialTorque: 12_000 * vehicle.aerialControlMultiplier,
  aerialControlGain: 7_000 * vehicle.aerialControlMultiplier,
  maximumAerialAngularSpeed: 5.2 * vehicle.aerialControlMultiplier,
  recoveryJumpImpulse: 3_800 * vehicle.jumpPowerMultiplier,
  recoveryControlLockSeconds: 0.75,
  recoveryTorque: 2_200,
  sideRecoveryTorque: 1_100,
  recoveryUprightThreshold: 0.45,
  secondJumpWindowSeconds: 1.25,
});

export const DEFAULT_CAR_TUNING: CarTuning = Object.freeze(carTuningForVehicleConfig(VEHICLE_CONFIG));

import { VEHICLE_CONFIG } from './GameplayScale';

export interface CarTuning {
  readonly mass: number;
  readonly halfExtents: { readonly x: number; readonly y: number; readonly z: number };
  readonly colliderBorderRadius: number;
  readonly colliderPoints: readonly { readonly x: number; readonly y: number; readonly z: number }[];
  readonly suspensionRestLength: number;
  readonly wheelRadius: number;
  readonly springStrength: number;
  readonly damperStrength: number;
  readonly maximumSuspensionForce: number;
  readonly surfaceAdhesionForce: number;
  readonly surfaceMinimumAdhesionFactor: number;
  readonly surfaceGravityCompensation: number;
  readonly surfaceAlignmentTorque: number;
  readonly surfaceAdhesionGraceSeconds: number;
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
  readonly groundSteeringTorque: number;
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

export const DEFAULT_CAR_TUNING: CarTuning = Object.freeze({
  mass: 850,
  halfExtents: { x: 0.92, y: 0.42, z: 1.38 },
  colliderBorderRadius: 0.12,
  colliderPoints: [
    { x: -0.92, y: -0.42, z: -1.38 }, { x: 0.92, y: -0.42, z: -1.38 },
    { x: -0.92, y: -0.42, z: 1.38 }, { x: 0.92, y: -0.42, z: 1.38 },
    { x: -0.92, y: 0.04, z: -1.38 }, { x: 0.92, y: 0.04, z: -1.38 },
    { x: -0.92, y: 0.34, z: -0.48 }, { x: 0.92, y: 0.34, z: -0.48 },
    { x: -0.92, y: 0.42, z: 0.48 }, { x: 0.92, y: 0.42, z: 0.48 },
    { x: -0.92, y: 0.34, z: 1.38 }, { x: 0.92, y: 0.34, z: 1.38 },
  ],
  suspensionRestLength: 0.22,
  wheelRadius: 0.34,
  springStrength: 28_000,
  damperStrength: 3_200,
  maximumSuspensionForce: 64_000,
  surfaceAdhesionForce: 12_000,
  surfaceMinimumAdhesionFactor: 0.65,
  surfaceGravityCompensation: 0.72,
  surfaceAlignmentTorque: 16_000,
  surfaceAdhesionGraceSeconds: 0.3,
  engineForce: 9_500 * VEHICLE_CONFIG.accelerationMultiplier,
  reverseForce: 6_500 * VEHICLE_CONFIG.reverseAccelerationMultiplier,
  maximumGroundDriveSpeed: VEHICLE_CONFIG.driveTopSpeed,
  maximumGroundReverseSpeed: VEHICLE_CONFIG.reverseTopSpeed,
  groundDriveSpeedFalloffRange: 4,
  brakeForce: 18_000 * VEHICLE_CONFIG.brakeMultiplier,
  brakeToReverseSpeed: 0.8,
  coastDrag: 1_200,
  idleBrakeDrag: 10_000,
  idleBrakeSpeed: 0.3,
  maximumCoastForce: 1_200,
  lateralGrip: 12_500,
  powerslideGrip: 1_800,
  maximumLateralForce: 14_000,
  maximumPowerslideForce: 5_500,
  maximumSteerAngle: 0.265 * VEHICLE_CONFIG.steeringMultiplier,
  powerslideSteerMultiplier: 1.95,
  groundSteeringTorque: 550 * VEHICLE_CONFIG.steeringMultiplier,
  powerslideSteeringTorque: 2_300 * VEHICLE_CONFIG.steeringMultiplier,
  boostForce: 24_000 * VEHICLE_CONFIG.boostAccelerationMultiplier,
  maximumGroundBoostSpeed: VEHICLE_CONFIG.boostTopSpeed,
  groundBoostSpeedFalloffRange: 4,
  boostConsumption: VEHICLE_CONFIG.boostConsumptionPerSecond,
  boostRecharge: VEHICLE_CONFIG.boostRechargePerSecond,
  ceilingRecoverySeconds: 0.65,
  ceilingBounceFactor: 0.3,
  minimumCeilingFallSpeed: 2,
  jumpImpulse: 5_700 * VEHICLE_CONFIG.jumpPowerMultiplier,
  dodgeImpulse: 4_500 * VEHICLE_CONFIG.dodgePowerMultiplier,
  dodgePitchTorque: 5_200 * VEHICLE_CONFIG.dodgePowerMultiplier,
  dodgeRollTorque: 3_400 * VEHICLE_CONFIG.dodgePowerMultiplier,
  dodgeControlLockSeconds: 0.55,
  dodgeAutoLevelSeconds: 1.6,
  dodgeAutoLevelDelaySeconds: 0.28,
  dodgeAutoLevelTorque: 18_000,
  dodgeAutoLevelDamping: 4_200,
  aerialTorque: 12_000 * VEHICLE_CONFIG.aerialControlMultiplier,
  aerialControlGain: 7_000 * VEHICLE_CONFIG.aerialControlMultiplier,
  maximumAerialAngularSpeed: 5.2 * VEHICLE_CONFIG.aerialControlMultiplier,
  recoveryJumpImpulse: 3_800 * VEHICLE_CONFIG.jumpPowerMultiplier,
  recoveryControlLockSeconds: 0.75,
  recoveryTorque: 2_200,
  sideRecoveryTorque: 1_100,
  recoveryUprightThreshold: 0.45,
  secondJumpWindowSeconds: 1.25,
});

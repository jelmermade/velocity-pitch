# Gameplay configuration

Edit `gameplay-config.json` to change arena, ball, and vehicle tuning. The default vehicle section is:

```json
{
  "arenaScale": 1,
  "ballSize": 1,
  "vehicle": {
    "driveTopSpeed": 22,
    "reverseTopSpeed": 12,
    "accelerationMultiplier": 1,
    "reverseAccelerationMultiplier": 1,
    "brakeMultiplier": 1,
    "steeringMultiplier": 1,
    "boostTopSpeed": 28,
    "boostAccelerationMultiplier": 1,
    "boostConsumptionPerSecond": 30,
    "boostRechargePerSecond": 5,
    "jumpPowerMultiplier": 1,
    "dodgePowerMultiplier": 1,
    "aerialControlMultiplier": 1
  }
}
```

The arena and ball settings are multipliers, so `1` is the default and `1.25` is 25% larger. `arenaScale` proportionally changes the field, goals, wall curves, and ceiling. `ballSize` changes both the visible ball and its physical collider; its mass is adjusted to preserve the same density.

Vehicle top speeds use game units per second. Values ending in `Multiplier` scale the existing force or control strength, so `1.25` is 25% stronger. Boost consumption and recharge use boost points per second; either may be set to `0`. Match-lobby boost power remains a multiplier on `boostAccelerationMultiplier`, and the lobby recharge setting overrides `boostRechargePerSecond` for that match. Restart the development server or rebuild after editing this file.

# Bot evaluation data

Run `npm run test:bot-evaluation` to simulate a five-minute 3v3 Bot Lab match. The test writes a JSON report named `bot-evaluation-<label>.json` in this directory. Set `BOT_EVALUATION_LABEL` to keep named baseline and candidate runs for comparison.

Each successful evaluation also merges its signed policy observations into `data/bot-knowledge.json`. The multiplayer service exposes the same file through `/api/bot-knowledge`, so every device loads the shared generation and contributes observations back to it after Bot Lab matches.

Generated match reports are ignored by Git; the compact shared knowledge model is intentionally tracked.

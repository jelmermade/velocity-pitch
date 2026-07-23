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

## Bot Lab live tuning

Start `3V3 BOT LAB` and select `LIVE TUNING` in the upper-left corner. Vehicle sliders affect all six bots immediately. Arena and ball sliders update the configuration preview; select `REBUILD BOT LAB` to reconstruct the arena, ball collider, rendering, and simulation with those temporary sizes. The game returns directly to Bot Lab after rebuilding.

Temporary tuning values are stored only for the current browser tab and are not written to this file or into persistent bot knowledge. Bot Lab's normal policy learning continues separately. `RESET` restores the currently loaded values, and `COPY JSON` creates the complete configuration to paste into this file. Returning to the menu clears the temporary size override and reloads the file-backed configuration.

# Bot evaluation data

Historical bot learning data from the original behavior model is archived in `data/v1/`. The active `data/bot-knowledge.json` starts at generation zero so observations use only the current movement, jump, aerial, team, and spawn behavior.

Run `npm run test:bot-evaluation` to simulate a five-minute 3v3 Bot Lab match. The test writes a JSON report named `bot-evaluation-<label>.json` in this directory. Set `BOT_EVALUATION_LABEL` to keep named baseline and candidate runs for comparison.

Each Bot Lab match shuffles bot identities between teams while preserving two strikers and one defender on each side. This prevents identity-specific policy and kickoff behavior from remaining tied to the same team across generations.

Kickoffs select from six distinct formation groups: flat line, forward triangle, inverted triangle, diagonal staircase, center column, and offset split. Each has dedicated 1v1, 2v2, and 3v3 layouts. Every Coral slot is an exact midfield mirror of the corresponding Azure slot, and the selected group remains consistent for the duration of the match.

Each successful evaluation also merges its signed policy observations into `data/bot-knowledge.json`. The multiplayer service exposes the same file through `/api/bot-knowledge`, so every device loads the shared generation and contributes observations back to it after Bot Lab matches.

Set `BOT_EVALUATION_PERSIST_KNOWLEDGE=false` for candidate comparisons that should write a report without changing shared knowledge. Reports also include grounded reverse time, powerslide time, unstable boost time, failed contact jumps, and jump-contact conversion so inefficient movement cannot hide behind aggregate reward.

Generated match reports are ignored by Git; the compact shared knowledge model is intentionally tracked.

## Evaluation v3

Evaluation v3 separates tactical policy learning from contact-technique learning. The tactical
policies still decide pressure, rotation, staging, and aerial eligibility. Ground and aerial
techniques now learn independently from actual contact outcomes, including missed close approaches,
failed aerials, and whether the outgoing ball trajectory crosses the usable goal mouth.

The v3 report adds `shotOnTargetRate`, `aerialShotOnTargetRate`, `meanShotAlignment`, ground/aerial
shot counts, `groundBoostBotSeconds`, `aboveDriveTopSpeedBoostBotSeconds`, and the technique values
and sample counts used by each bot. This fixes the earlier blind spots where a touch counted as
productive merely because it moved upfield, even if it was headed wide of goal, and where aggregate
boost time could not show whether bots used boost to exceed normal drive speed on the ground.

Hit strength is tracked separately from direction. `hardTouchRate` requires both at least 8
units/second of velocity change and at least 14 units/second of outgoing ball speed. The report also
includes `productiveHardTouchRate`, `meanTouchImpulseSpeed`, and `meanPostTouchBallSpeed`, with the
same fields split by tactical intent under `touchDiagnostics`. Training rewards combine this impact
power with useful forward speed, so a weak tap no longer receives the same technique feedback as a
forceful shot or clear.

`productiveTouchRate` counts one outcome per complete physics contact episode. A touch is productive
when it increases progress toward the opponent goal or preserves at least 2 units/second of existing
forward progress; wall bounces, nearby non-contact events, and repeated frames from one collision are
not separate touches. Evaluation v3 requires at least 80% productive touches.

`alignedApproachConversionRate` is the share of open-play, tactically assigned ground challenges
that produce a real car-ball collision after the car enters a close, aligned approach. Kickoffs,
support, cover, and rotation movement are excluded. `defenseHitRate` is stricter: a defensive
approach only succeeds when its completed contact leaves the ball travelling away from the bot's
own goal, rather than merely registering a collision.

`aerialAttemptConversionRate` is the share of resolved controller aerial launches that make a real
car-ball collision. It does not count duplicate jump commands or ordinary recovery/contact jumps
as new aerial attempts. `aerialAttemptDiagnostics` compares the launch distance, ball height,
vertical speed, available boost, closest distance, and maximum car height of successful and failed
launches. Evaluation v3 requires at least 90% ground conversion, 75% aerial conversion, and 80%
defense conversion.

Use the non-persisting command for before/after comparisons:

```bash
npm run evaluate:bot-v3
```

When a candidate is healthy, collect and merge a training generation with:

```bash
npm run train:bot-v3
```

The knowledge normalizer migrates schema-v1 tactical data in memory and initializes the new
schema-v2 technique bands at zero, so existing shared knowledge remains usable during rollout.

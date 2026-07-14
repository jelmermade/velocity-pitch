import { clamp } from '../../core/math/MathUtils';

export class BoostSystem {
  private amount = 100;

  update(
    requested: boolean,
    consumptionPerSecond: number,
    rechargePerSecond: number,
    deltaSeconds: number,
    allowed = true,
  ): boolean {
    const active = requested && allowed && this.amount > 0;
    const changePerSecond = active ? -consumptionPerSecond : requested ? 0 : rechargePerSecond;
    this.amount = clamp(
      this.amount + changePerSecond * deltaSeconds,
      0,
      100,
    );
    return active;
  }

  add(amount: number): number {
    const previous = this.amount;
    this.amount = clamp(this.amount + amount, 0, 100);
    return this.amount - previous;
  }

  value(): number { return this.amount; }
  reset(): void { this.amount = 100; }
}

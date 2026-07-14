export interface FixedStepResult {
  readonly steps: number;
  readonly alpha: number;
}

export class FixedStepClock {
  private accumulator = 0;
  private previousSeconds: number | null = null;

  constructor(
    readonly stepSeconds = 1 / 120,
    private readonly maximumSteps = 8,
  ) {}

  update(nowMilliseconds: number): FixedStepResult {
    const nowSeconds = nowMilliseconds / 1000;
    if (this.previousSeconds === null) {
      this.previousSeconds = nowSeconds;
      return { steps: 0, alpha: 0 };
    }
    const frameTime = Math.min(0.1, Math.max(0, nowSeconds - this.previousSeconds));
    this.previousSeconds = nowSeconds;
    this.accumulator += frameTime;
    const available = Math.floor(this.accumulator / this.stepSeconds);
    const steps = Math.min(available, this.maximumSteps);
    this.accumulator -= steps * this.stepSeconds;
    if (available > this.maximumSteps) this.accumulator = 0;
    return { steps, alpha: this.accumulator / this.stepSeconds };
  }

  reset(): void {
    this.accumulator = 0;
    this.previousSeconds = null;
  }
}

const SAMPLE_SECONDS = 1;

export class AdaptivePixelRatio {
  private elapsed = 0;
  private frames = 0;

  constructor(
    private current: number,
    private readonly minimum: number,
    private readonly maximum: number,
    private readonly targetFramesPerSecond: number,
  ) {}

  update(deltaSeconds: number): number | null {
    if (deltaSeconds <= 0 || deltaSeconds > 0.25) return null;
    this.elapsed += deltaSeconds;
    this.frames += 1;
    if (this.elapsed < SAMPLE_SECONDS) return null;

    const framesPerSecond = this.frames / this.elapsed;
    this.elapsed = 0;
    this.frames = 0;
    let next = this.current;
    if (framesPerSecond < this.targetFramesPerSecond - 4) {
      const scaleForTarget = this.current * Math.sqrt(framesPerSecond / this.targetFramesPerSecond) * 0.95;
      next = Math.max(this.minimum, Math.min(this.current - 0.1, scaleForTarget));
    } else if (framesPerSecond >= this.targetFramesPerSecond - 1) {
      next = Math.min(this.maximum, this.current + 0.05);
    }

    next = Math.round(next * 100) / 100;
    if (Math.abs(next - this.current) < 0.01) return null;
    this.current = next;
    return next;
  }
}

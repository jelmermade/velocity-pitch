import { FixedStepClock } from '../core/time/FixedStepClock';
import { RUNTIME_CONFIG } from './RuntimeConfig';

export class GameLoop {
  private readonly clock = new FixedStepClock(1 / RUNTIME_CONFIG.physicsHz);
  private animationFrame = 0;
  private lastRenderSeconds: number | null = null;
  private fixedUpdatesEnabled = true;

  constructor(
    private readonly fixedUpdate: (deltaSeconds: number) => void,
    private readonly render: (alpha: number, deltaSeconds: number) => void,
  ) {}

  start(): void {
    this.clock.reset();
    this.animationFrame = requestAnimationFrame(this.frame);
  }

  stop(): void {
    cancelAnimationFrame(this.animationFrame);
    this.animationFrame = 0;
  }

  setFixedUpdatesEnabled(enabled: boolean): void {
    this.fixedUpdatesEnabled = enabled;
    this.clock.reset();
  }

  private readonly frame = (nowMilliseconds: number): void => {
    const nowSeconds = nowMilliseconds / 1000;
    const renderDelta = this.lastRenderSeconds === null ? 0 : Math.min(0.1, nowSeconds - this.lastRenderSeconds);
    this.lastRenderSeconds = nowSeconds;
    const result = this.clock.update(nowMilliseconds);
    if (this.fixedUpdatesEnabled) {
      for (let index = 0; index < result.steps; index += 1) this.fixedUpdate(this.clock.stepSeconds);
    }
    this.render(result.alpha, renderDelta);
    this.animationFrame = requestAnimationFrame(this.frame);
  };
}

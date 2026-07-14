export class KickoffManager {
  private lastAnnounced = -1;

  countdownValue(seconds: number): number {
    return Math.max(0, Math.ceil(seconds));
  }

  shouldAnnounce(value: number): boolean {
    if (value === this.lastAnnounced) return false;
    this.lastAnnounced = value;
    return true;
  }

  reset(): void {
    this.lastAnnounced = -1;
  }
}

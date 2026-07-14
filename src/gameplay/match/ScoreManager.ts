export class ScoreManager {
  private azure = 0;
  private coral = 0;

  add(team: 'azure' | 'coral'): void {
    if (team === 'azure') this.azure += 1;
    else this.coral += 1;
  }

  scores(): { readonly azure: number; readonly coral: number } {
    return { azure: this.azure, coral: this.coral };
  }
}

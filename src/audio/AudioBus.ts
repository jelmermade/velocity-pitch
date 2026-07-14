export class AudioBus {
  readonly gain: GainNode;

  constructor(context: AudioContext, volume: number) {
    this.gain = context.createGain();
    this.gain.gain.value = volume;
    this.gain.connect(context.destination);
  }

  setVolume(volume: number): void {
    this.gain.gain.value = volume;
  }
}

import type { EventBus } from '../core/events/EventBus';
import type { GameEventMap } from '../core/events/GameEvents';
import { AudioBus } from './AudioBus';

export class AudioManager {
  private readonly context = new AudioContext();
  private readonly bus = new AudioBus(this.context, 0.55);
  private readonly unsubscribers: (() => void)[];

  constructor(events: EventBus<GameEventMap>) {
    this.unsubscribers = [
      events.on('kickoff', ({ count }) => this.tone(280 + (3 - count) * 65, 0.09, 'sine', 0.16)),
      events.on('goal', () => this.goalExplosion()),
      events.on('carImpact', ({ intensity }) => this.noise(Math.min(0.16, intensity / 80))),
      events.on('ballImpact', ({ intensity }) => this.tone(115 + intensity * 2, 0.045, 'triangle', 0.06)),
      events.on('boostPickup', ({ amount }) => this.tone(amount >= 90 ? 620 : 480, 0.16, 'sine', 0.09)),
    ];
    window.addEventListener('keydown', this.resume, { once: true });
    window.addEventListener('pointerdown', this.resume, { once: true });
  }

  setVolume(volume: number): void { this.bus.setVolume(volume); }

  dispose(): void {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    window.removeEventListener('keydown', this.resume);
    window.removeEventListener('pointerdown', this.resume);
    void this.context.close();
  }

  private readonly resume = (): void => { void this.context.resume(); };

  private tone(frequency: number, duration: number, type: OscillatorType, gainValue: number, delay = 0): void {
    if (this.context.state !== 'running') return;
    const start = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(gainValue, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(gain).connect(this.bus.gain);
    oscillator.start(start);
    oscillator.stop(start + duration);
  }

  private goalChord(): void {
    [220, 330, 440, 660].forEach((frequency, index) => this.tone(frequency, 0.45, 'sawtooth', 0.055, index * 0.07));
  }

  private goalExplosion(): void {
    this.goalChord();
    this.noise(0.24, 0.34);
    if (this.context.state !== 'running') return;
    const start = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(105, start);
    oscillator.frequency.exponentialRampToValueAtTime(34, start + 0.48);
    gain.gain.setValueAtTime(0.32, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.52);
    oscillator.connect(gain).connect(this.bus.gain);
    oscillator.start(start);
    oscillator.stop(start + 0.52);
  }

  private noise(gainValue: number, duration = 0.08): void {
    if (this.context.state !== 'running') return;
    const samples = Math.floor(this.context.sampleRate * duration);
    const buffer = this.context.createBuffer(1, samples, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < samples; index += 1) data[index] = Math.random() * 2 - 1;
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    gain.gain.setValueAtTime(gainValue, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.context.currentTime + duration);
    source.connect(gain).connect(this.bus.gain);
    source.start();
  }
}

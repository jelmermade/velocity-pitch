import type { EventBus } from '../core/events/EventBus';
import type { GameEventMap } from '../core/events/GameEvents';
import type { CarState } from '../gameplay/car/CarState';
import { AudioBus } from './AudioBus';
import { gearForSpeed, resolveVehicleGear, vehicleAudioTargets } from './VehicleAudioModel';

export class AudioManager {
  private readonly context = new AudioContext();
  private readonly bus = new AudioBus(this.context, 0.55);
  private readonly engineOscillator = this.context.createOscillator();
  private readonly engineFilter = this.context.createBiquadFilter();
  private readonly engineGain = this.context.createGain();
  private readonly boostNoise = this.context.createBufferSource();
  private readonly boostFilter = this.context.createBiquadFilter();
  private readonly boostNoiseGain = this.context.createGain();
  private readonly boostTone = this.context.createOscillator();
  private readonly boostToneGain = this.context.createGain();
  private readonly unsubscribers: (() => void)[];
  private currentGear = 1;
  private gearShiftCooldown = 0;
  private hasVehicleSample = false;
  private wasBoosting = false;

  constructor(events: EventBus<GameEventMap>) {
    this.configureVehicleAudio();
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

  update(car: CarState, deltaSeconds: number, paused: boolean): void {
    const active = !paused;
    const speed = Math.hypot(car.linearVelocity.x, car.linearVelocity.z);
    const previousGear = this.currentGear;
    const nextGear = this.hasVehicleSample
      ? resolveVehicleGear(speed, previousGear)
      : gearForSpeed(speed);
    const safeDelta = Number.isFinite(deltaSeconds) ? Math.max(0, Math.min(deltaSeconds, 0.25)) : 0;
    this.gearShiftCooldown = Math.max(0, this.gearShiftCooldown - safeDelta);

    if (this.hasVehicleSample && nextGear !== previousGear && this.gearShiftCooldown === 0 && active) {
      this.gearShift(nextGear > previousGear);
      this.gearShiftCooldown = 0.16;
    }
    this.currentGear = nextGear;
    this.hasVehicleSample = true;

    const targets = vehicleAudioTargets(car, nextGear, active);
    const now = this.context.currentTime;
    this.engineOscillator.frequency.setTargetAtTime(targets.engineFrequency, now, 0.045);
    this.engineFilter.frequency.setTargetAtTime(520 + targets.engineFrequency * 4.5, now, 0.05);
    this.engineGain.gain.setTargetAtTime(targets.engineGain, now, 0.055);
    this.boostFilter.frequency.setTargetAtTime(targets.boostFilterFrequency, now, 0.04);
    this.boostNoiseGain.gain.setTargetAtTime(targets.boostNoiseGain, now, car.boosting ? 0.025 : 0.055);
    this.boostTone.frequency.setTargetAtTime(90 + targets.speed * 1.6, now, 0.04);
    this.boostToneGain.gain.setTargetAtTime(targets.boostToneGain, now, car.boosting ? 0.025 : 0.055);

    const startedBoosting = active && car.boosting && !this.wasBoosting;
    if (startedBoosting) this.boostIgnition();
    this.wasBoosting = active && car.boosting;
  }

  dispose(): void {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    window.removeEventListener('keydown', this.resume);
    window.removeEventListener('pointerdown', this.resume);
    this.engineOscillator.stop();
    this.boostNoise.stop();
    this.boostTone.stop();
    void this.context.close();
  }

  private readonly resume = (): void => { void this.context.resume(); };

  private configureVehicleAudio(): void {
    this.engineOscillator.type = 'sawtooth';
    this.engineOscillator.frequency.value = 77;
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 870;
    this.engineFilter.Q.value = 1.2;
    this.engineGain.gain.value = 0;
    this.engineOscillator.connect(this.engineFilter).connect(this.engineGain).connect(this.bus.gain);

    this.boostNoise.buffer = this.createNoiseBuffer(1);
    this.boostNoise.loop = true;
    this.boostFilter.type = 'bandpass';
    this.boostFilter.frequency.value = 720;
    this.boostFilter.Q.value = 0.8;
    this.boostNoiseGain.gain.value = 0;
    this.boostNoise.connect(this.boostFilter).connect(this.boostNoiseGain).connect(this.bus.gain);

    this.boostTone.type = 'sawtooth';
    this.boostTone.frequency.value = 90;
    this.boostToneGain.gain.value = 0;
    this.boostTone.connect(this.boostToneGain).connect(this.bus.gain);

    this.engineOscillator.start();
    this.boostNoise.start();
    this.boostTone.start();
  }

  private gearShift(upshift: boolean): void {
    this.sweep(upshift ? 190 : 105, upshift ? 92 : 175, 0.09, 'square', 0.055);
    this.noise(0.035, 0.06);
  }

  private boostIgnition(): void {
    this.sweep(85, 185, 0.12, 'sawtooth', 0.075);
    this.noise(0.055, 0.1);
  }

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

  private sweep(from: number, to: number, duration: number, type: OscillatorType, gainValue: number): void {
    if (this.context.state !== 'running') return;
    const start = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, start);
    oscillator.frequency.exponentialRampToValueAtTime(to, start + duration);
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
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = this.createNoiseBuffer(duration);
    gain.gain.setValueAtTime(gainValue, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.context.currentTime + duration);
    source.connect(gain).connect(this.bus.gain);
    source.start();
  }

  private createNoiseBuffer(duration: number): AudioBuffer {
    const samples = Math.floor(this.context.sampleRate * duration);
    const buffer = this.context.createBuffer(1, samples, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < samples; index += 1) data[index] = Math.random() * 2 - 1;
    return buffer;
  }
}

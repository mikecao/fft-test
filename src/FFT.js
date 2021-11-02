import fft from "fourier-transform";
import blackman from "window-function/blackman";
import { db2mag, val2pct, toDecibel, normalize } from "./utils";

const MAX_FFT_SIZE = 32768;
const SAMPLE_RATE = 44100;
const smoothingTimeConstant = 0.55;
const minDecibels = -100;
const maxDecibels = -6;

export default class FFT {
  constructor(audioContext, audioData, fftSize) {
    this.context = audioContext;

    this.audioData = audioData;
    this.audioBuffer = audioContext.createBuffer(1, MAX_FFT_SIZE, SAMPLE_RATE);
    this.bufferOffset = 0;

    this.blackmanTable = new Float32Array(fftSize);
    this.smoothing = new Float32Array(fftSize / 2);

    for (let i = 0; i < fftSize; i++) {
      this.blackmanTable[i] = blackman(i, fftSize);
    }

    for (let i = 0; i < this.audioBuffer.length; i++) {
      this.audioBuffer[i] = 0;
    }

    this.fftSize = fftSize;
  }

  getFloatTimeDomainData(array) {
    const { fftSize, bufferOffset, audioBuffer } = this;
    const i0 = (bufferOffset - fftSize + MAX_FFT_SIZE) % MAX_FFT_SIZE;
    const i1 = Math.min(i0 + fftSize, MAX_FFT_SIZE);
    const copied = i1 - i0;
    const busData = audioBuffer.getChannelData(0);

    array.set(busData.subarray(i0, i1));

    if (copied !== fftSize) {
      const remain = fftSize - copied;
      const subarray2 = busData.subarray(0, remain);

      array.set(subarray2, copied);
    }
  }

  getFloatFrequencyData(array) {
    const { fftSize } = this;
    const waveform = new Float32Array(fftSize);
    const length = Math.min(array.length, fftSize / 2);

    // 1. down-mix
    this.getFloatTimeDomainData(waveform);

    // 2. Apply Blackman window
    for (let i = 0; i < fftSize; i++) {
      waveform[i] = waveform[i] * this.blackmanTable[i] || 0;
    }

    // 3. FFT
    const spectrum = fft(waveform);

    // re-size to frequencyBinCount, then do more processing
    for (let i = 0; i < length; i++) {
      const v0 = spectrum[i];
      // 4. Smooth over data
      this.smoothing[i] =
        smoothingTimeConstant * this.smoothing[i] +
        (1 - smoothingTimeConstant) * v0;
      // 5. Convert to dB
      const v1 = toDecibel(this.smoothing[i]);
      // store in array
      array[i] = Number.isFinite(v1) ? v1 : 0;
    }
  }

  getByteFrequencyData(array) {
    const { fftSize } = this;
    const length = Math.min(array.length, fftSize / 2);
    const spectrum = new Float32Array(length);

    this.getFloatFrequencyData(spectrum);

    for (let i = 0; i < length; i++) {
      array[i] = Math.round(
        normalize(spectrum[i], minDecibels, maxDecibels) * 255
      );
    }
  }

  process(data) {
    const { audioBuffer, bufferOffset } = this;

    audioBuffer.copyToChannel(data, 0, bufferOffset);

    this.bufferOffset += data.length;
    if (this.bufferOffset >= MAX_FFT_SIZE) {
      this.bufferOffset = 0;
    }
  }
}

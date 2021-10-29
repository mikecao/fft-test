import { useEffect, useRef } from "react";
import fft from "fourier-transform";
import blackman from "window-function/blackman";
import { db2mag, val2pct, toDecibel, normalize } from "./utils";
import { RenderingAudioContext as AudioContext2 } from "web-audio-engine";

const MAX_FFT_SIZE = 32768;
const NUM_CHANNELS = 2;
const BLOCK_SIZE = 128;
const BIT_DEPTH = 16;
const minDecibels = -100;
const maxDecibels = -12;
const sampleRate = 44100;
const fftSize = 1024;
const smoothingTimeConstant = 0.5;
const CANVAS_WIDTH = 1024;
const CANVAS_HEIGHT = 300;

const blackmanTable = new Float32Array(fftSize);
const previousSmooth = new Float32Array(fftSize / 2);

const context = new AudioContext({ sampleRate });
let analyser = Object.assign(context.createAnalyser(), {
  fftSize,
  minDecibels,
  maxDecibels,
  smoothingTimeConstant,
});

const context2 = new AudioContext2({ sampleRate });
let analyser2 = Object.assign(context2.createAnalyser(), {
  fftSize,
  minDecibels,
  maxDecibels,
  smoothingTimeConstant,
});

for (let i = 0; i < fftSize; i++) {
  blackmanTable[i] = blackman(i, fftSize);
}

let analyserBusOffset = 0;
const analyserBus = context.createBuffer(
  NUM_CHANNELS,
  MAX_FFT_SIZE,
  sampleRate
);

const bufferLength = analyser.frequencyBinCount;
const byteArray = new Uint8Array(bufferLength);
const byteArray2 = new Uint8Array(bufferLength);
const byteArray3 = new Uint8Array(bufferLength);
const floatArray = new Float32Array(bufferLength);
const floatArray2 = new Float32Array(bufferLength);
const floatArray3 = new Float32Array(bufferLength);

let source;
let source2;
let startTime;
let audioBuffer;
let audioBuffer2;
let audioData;
let audioData2;
let playing = false;
let print = false;

console.log({ context, context2, analyser, analyser2 });

export default function App() {
  const canvas1 = useRef();
  const canvas2 = useRef();
  const canvas3 = useRef();

  async function handleLoad(e) {
    e.stopPropagation();
    e.preventDefault();

    if (source) {
      source.stop();
    }

    const file = e.target.files[0];

    if (file) {
      const arrayBuffer = await file.arrayBuffer();
      const arrayBuffer2 = arrayBuffer.slice(0);

      audioBuffer = await context.decodeAudioData(arrayBuffer);
      audioData = audioBuffer.getChannelData(0);

      audioBuffer2 = await context2.decodeAudioData(arrayBuffer2);
      audioData2 = audioBuffer2.getChannelData(0);

      console.log({
        duration: audioBuffer.duration,
        length: audioBuffer.length,
        audioBuffer,
        audioBuffer2,
        audioData: audioData.slice(0, 10),
        audioData2: audioData2.slice(0, 10),
      });
    }
  }

  function handlePlay() {
    if (source) {
      source.disconnect();
      source2.disconnect();
    }

    source = context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(analyser);
    analyser.connect(context.destination);
    source.start();

    source2 = context2.createBufferSource();
    source2.buffer = audioBuffer2;
    source2.connect(analyser2);
    analyser2.connect(context2.destination);
    source2.start();
    context2.resume();

    console.log("STARTED");

    startTime = context.currentTime;
    playing = true;
  }

  function handleStop() {
    source.stop();
    source2.stop();
    console.log("STOPPED");

    playing = false;
  }

  function getFloatTimeDomainData(array) {
    const i0 = (analyserBusOffset - fftSize + MAX_FFT_SIZE) % MAX_FFT_SIZE;
    const i1 = Math.min(i0 + fftSize, MAX_FFT_SIZE);
    const copied = i1 - i0;
    const busData = analyserBus.getChannelData(0);

    array.set(busData.subarray(i0, i1));

    if (copied !== fftSize) {
      const remain = fftSize - copied;
      const subarray2 = busData.subarray(0, remain);

      array.set(subarray2, copied);
    }
  }

  function getFloatFrequencyData(array) {
    const waveform = new Float32Array(fftSize);
    const length = Math.min(array.length, fftSize / 2);

    // 1. down-mix
    getFloatTimeDomainData(waveform);

    // 2. Apply Blackman window
    for (let i = 0; i < fftSize; i++) {
      waveform[i] = waveform[i] * blackmanTable[i] || 0;
    }

    // 3. FFT
    const spectrum = fft(waveform);

    // re-size to frequencyBinCount, then do more processing
    for (let i = 0; i < length; i++) {
      const v0 = spectrum[i];
      // 4. Smooth over data
      previousSmooth[i] =
        smoothingTimeConstant * previousSmooth[i] +
        (1 - smoothingTimeConstant) * v0;
      // 5. Convert to dB
      const v1 = toDecibel(previousSmooth[i]);
      // store in array
      array[i] = Number.isFinite(v1) ? v1 : 0;
    }
  }

  function getByteFrequencyData(array) {
    const length = Math.min(array.length, fftSize / 2);
    const spectrum = new Float32Array(length);

    getFloatFrequencyData(spectrum);

    for (let i = 0; i < length; i++) {
      array[i] = Math.round(
        normalize(spectrum[i], minDecibels, maxDecibels) * 255
      );
    }
  }

  function processAudio() {
    const currentTime = context.currentTime - startTime;
    const pct = currentTime / audioBuffer.duration;
    const pos = pct * audioBuffer.length;

    if (pct >= 1) return;

    // merge and store data in our buffer
    for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
      const channelData = audioBuffer.getChannelData(c);
      const data = channelData.slice(pos, pos + 128);
      analyserBus.copyToChannel(data, c, analyserBusOffset);
    }

    //analyserBusOffset += pos;

    analyserBusOffset += BLOCK_SIZE;
    if (MAX_FFT_SIZE <= analyserBusOffset) {
      analyserBusOffset = 0;
    }
  }

  function draw() {
    requestAnimationFrame(draw);

    if (!playing || !source) return;

    if (canvas1.current) {
      analyser.getByteFrequencyData(byteArray);
      analyser.getFloatFrequencyData(floatArray);
      drawBars(canvas1, byteArray);
    }

    if (canvas2.current) {
      context2.processTo(context.currentTime);
      context2.resume();

      analyser2.getByteFrequencyData(byteArray2);
      analyser2.getFloatFrequencyData(floatArray2);
      drawBars(canvas2, byteArray2);
    }

    if (canvas3.current) {
      processAudio();
      getByteFrequencyData(byteArray3);
      getFloatFrequencyData(floatArray3);
      drawBars(canvas3, byteArray3);
    }

    if (print) {
      console.log({
        byteArray,
        byteArray2,
        diff1and2: byteArray.map((n, i) => (n / byteArray2[i]) * 100),
        byteArray3,
        diff1and3: byteArray.map((n, i) => (n / byteArray3[i]) * 100),
      });
      print = false;
    }
  }

  function drawBars(ref, data) {
    const canvas = ref.current.getContext("2d");
    const width = ref.current.width;
    const height = ref.current.height;

    canvas.fillStyle = "lightgray";
    canvas.fillRect(0, 0, width, height);

    let barWidth = width / bufferLength;
    let barHeight;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      //barHeight = dataArray[i] / 2;

      const db = -100 * (1 - data[i] / 256);

      barHeight =
        val2pct(db2mag(db), db2mag(minDecibels), db2mag(maxDecibels)) * height;

      canvas.fillStyle = "red";
      canvas.fillRect(x, height - barHeight, barWidth, barHeight);

      x += barWidth + 1;
    }
  }

  useEffect(() => {
    if (source) {
      source.stop();
    }
    draw();
  }, []);

  return (
    <div className="App">
      <h1>web-audio</h1>
      <input type="file" id="file" name="filename" onChange={handleLoad} />
      <div>
        <button onClick={handlePlay}>Play</button>
        <button onClick={handleStop}>Stop</button>
      </div>
      <canvas
        ref={canvas1}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        onClick={() => (print = true)}
      />
      <canvas ref={canvas2} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} />
      <canvas ref={canvas3} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} />
    </div>
  );
}

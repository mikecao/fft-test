import { useEffect, useRef } from "react";
import fft from "fourier-transform";
import blackman from "window-function/blackman";
import { db2mag, val2pct, toDecibel, normalize } from "./utils";
import { RenderingAudioContext as AudioContext2 } from "web-audio-engine";
import FFT from "./FFT";

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
  maxDecibels: -10,
  smoothingTimeConstant,
});

for (let i = 0; i < fftSize; i++) {
  blackmanTable[i] = blackman(i, fftSize);
}

let analyserBusOffset = 0;
const analyserBus = context.createBuffer(1, MAX_FFT_SIZE, sampleRate);

const bufferLength = analyser.frequencyBinCount;
const byteArray = new Uint8Array(bufferLength);
const byteArray2 = new Uint8Array(bufferLength);
const byteArray3 = new Uint8Array(bufferLength);
const floatArray = new Float32Array(bufferLength);
const floatArray2 = new Float32Array(bufferLength);
const floatArray3 = new Float32Array(bufferLength);

let source;
let source2;
let startTime = 0;
let lastTime = 0;
let audioBuffer;
let audioBuffer2;
let audioData;
let audioData2;
let playing = false;
let print = false;
let fftParser;

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

    context2.processTo(context.currentTime);
    context2.resume();

    console.log("STARTED");

    startTime = context.currentTime;
    playing = true;

    fftParser = new FFT(context, audioBuffer, fftSize);
  }

  function handleStop() {
    source.stop();
    source2.stop();
    console.log("STOPPED");

    playing = false;
  }

  function processAudio() {
    const duration = context.currentTime - startTime;
    const pct = duration / audioBuffer.duration;
    const pos = Math.floor(pct * audioBuffer.length);

    if (pct >= 1) return;

    if (lastTime > 0) {
      const diff = context.currentTime - lastTime;
      const samples = (diff / audioBuffer.duration) * audioBuffer.length;

      // merge and store data in our buffer
      const channelData1 = audioBuffer
        .getChannelData(0)
        .slice(pos, pos + samples);
      const channelData2 = audioBuffer
        .getChannelData(0)
        .slice(pos, pos + samples);

      //const channelData2 = audioBuffer.getChannelData(0);
      // merge channels according to algorithm
      const data = channelData1.map((n, i) => (n + channelData2[i]) / 2);

      //analyserBus.copyToChannel(data, 0, analyserBusOffset);
      //analyserBusOffset += pos;
      fftParser.process(data);

      analyserBusOffset += samples;
      if (analyserBusOffset >= MAX_FFT_SIZE) {
        analyserBusOffset = 0;
      }
    }

    lastTime = context.currentTime;
  }

  function draw() {
    requestAnimationFrame(draw);

    if (!playing || !source) return;

    if (canvas1.current) {
      analyser.getByteFrequencyData(byteArray);
      analyser.getFloatFrequencyData(floatArray);
      drawBars(canvas1, byteArray, 1);
    }

    if (canvas2.current) {
      context2.processTo(context.currentTime);
      context2.resume();

      analyser2.getByteFrequencyData(byteArray2);
      analyser2.getFloatFrequencyData(floatArray2);
      drawBars(canvas2, byteArray2, 2);
    }

    if (canvas3.current) {
      processAudio();
      fftParser.getByteFrequencyData(byteArray3);
      fftParser.getFloatFrequencyData(floatArray3);
      drawBars(canvas3, byteArray3, 3);
    }

    if (print) {
      console.log({
        byteArray,
        byteArray2,
        diff1and2: byteArray.map(
          (n, i) => (100 * Math.abs(n - byteArray2[i])) / 255
        ),
        byteArray3,
        diff1and3: byteArray.map(
          (n, i) => (100 * Math.abs(n - byteArray3[i])) / 255
        ),
        buffer: fftParser.audioBuffer,
      });
      print = false;
    }
  }

  function drawBars(ref, data, type) {
    const canvas = ref.current.getContext("2d");
    const width = ref.current.width;
    const height = ref.current.height;

    const maxDb = type > 1 ? analyser2.maxDecibels : maxDecibels;
    const minDb = type > 1 ? analyser2.minDecibels : minDecibels;

    canvas.fillStyle = "lightgray";
    canvas.fillRect(0, 0, width, height);

    let barWidth = width / bufferLength;
    let barHeight;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const db = -100 * (1 - data[i] / 256);

      barHeight = val2pct(db2mag(db), db2mag(minDb), db2mag(maxDb)) * height;

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

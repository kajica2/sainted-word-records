// lib/recorder-worker.js — WebCodecs-based MP4 recorder running in a
// dedicated Web Worker so the H.264 encode happens off the main thread.
//
// Public protocol (main → worker):
//
//   { type: 'init', width, height, fps, videoBitsPerSecond,
//     audioSampleRate, audioNumberOfChannels }
//   { type: 'video', frame }   // VideoFrame, transferred
//   { type: 'audio', data }    // AudioData, transferred
//   { type: 'stop' }
//
// Public protocol (worker → main):
//
//   { type: 'ready' }                       // init done, can stream
//   { type: 'unsupported', reason: string }  // codec / browser refused
//   { type: 'error',   message: string }    // encode error
//   { type: 'done',    buffer: ArrayBuffer } // final MP4 (transferred)
//
// The worker is started with { type: 'module' } so it can import the
// vendored mp4-muxer next to it.

import { Muxer, ArrayBufferTarget } from './mp4-muxer.js';

let videoEncoder = null;
let audioEncoder = null;
let muxer = null;
let videoFrameCount = 0;
let audioChunkCount = 0;
let cfg = null;
let muxerBuf = null;

async function init(c) {
  cfg = c;

  // ---- VideoEncoder (H.264 baseline) with hardware acceleration hint
  if (typeof VideoEncoder === 'undefined') {
    self.postMessage({ type: 'unsupported', reason: 'VideoEncoder unavailable' });
    return;
  }
  const vConf = {
    codec: c.videoCodec || 'avc1.42E01E',
    width:  c.width  | 0,
    height: c.height | 0,
    bitrate: c.videoBitsPerSecond || 4_000_000,
    framerate: c.fps || 24,
    hardwareAcceleration: 'prefer-hardware',
  };
  let support = null;
  try {
    support = await VideoEncoder.isConfigSupported(vConf);
  } catch (_) {}
  if (!support || !support.supported) {
    self.postMessage({ type: 'unsupported', reason: 'avc1 not supported by this browser' });
    return;
  }
  videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      try { muxer.addVideoChunk(chunk, meta); }
      catch (e) { self.postMessage({ type: 'error', message: 'addVideoChunk: ' + e.message }); }
    },
    error: (e) => {
      self.postMessage({ type: 'error', message: 'VideoEncoder: ' + (e && e.message || e) });
    },
  });
  videoEncoder.configure(support.config);

  // ---- AudioEncoder (AAC-LC) if audio config is provided
  if (c.audioSampleRate && c.audioNumberOfChannels && typeof AudioEncoder !== 'undefined') {
    const aConf = {
      codec: 'mp4a.40.2',
      sampleRate: c.audioSampleRate,
      numberOfChannels: c.audioNumberOfChannels,
      bitrate: 128_000,
    };
    let aSupport = null;
    try { aSupport = await AudioEncoder.isConfigSupported(aConf); } catch (_) {}
    if (aSupport && aSupport.supported) {
      audioEncoder = new AudioEncoder({
        output: (chunk, meta) => {
          try { muxer.addAudioChunk(chunk, meta); }
          catch (e) { self.postMessage({ type: 'error', message: 'addAudioChunk: ' + e.message }); }
        },
        error: (e) => {
          self.postMessage({ type: 'error', message: 'AudioEncoder: ' + (e && e.message || e) });
        },
      });
      audioEncoder.configure(aSupport.config);
    } else {
      // Audio unsupported — video-only MP4 is still valid
      audioEncoder = null;
    }
  }

  // ---- Muxer
  muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: {
      codec: 'avc',
      width: cfg.width,
      height: cfg.height,
      frameRate: cfg.fps || 24,
    },
    audio: audioEncoder
      ? { codec: 'aac', numberOfChannels: cfg.audioNumberOfChannels, sampleRate: cfg.audioSampleRate }
      : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  self.postMessage({ type: 'ready' });
}

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'init') {
      await init(msg);
    } else if (msg.type === 'video') {
      if (!videoEncoder) { msg.frame.close && msg.frame.close(); return; }
      // Force a keyframe once per second so the MP4 is seekable.
      const isKey = (videoFrameCount % (cfg.fps || 24)) === 0;
      videoEncoder.encode(msg.frame, { keyFrame: isKey });
      msg.frame.close();
      videoFrameCount++;
    } else if (msg.type === 'audio') {
      if (!audioEncoder) { msg.data.close && msg.data.close(); return; }
      audioEncoder.encode(msg.data);
      msg.data.close();
      audioChunkCount++;
    } else if (msg.type === 'stop') {
      if (videoEncoder) await videoEncoder.flush();
      if (audioEncoder) await audioEncoder.flush();
      if (muxer) muxer.finalize();
      muxerBuf = muxer ? muxer.target.buffer : new ArrayBuffer(0);
      self.postMessage({ type: 'done', buffer: muxerBuf, videoFrames: videoFrameCount, audioChunks: audioChunkCount },
                        [muxerBuf]);
      // Tear down for next session
      videoEncoder = null; audioEncoder = null; muxer = null; cfg = null;
      videoFrameCount = 0; audioChunkCount = 0;
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: (err && err.message) || String(err) });
  }
};

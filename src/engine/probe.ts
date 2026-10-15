import { ALL_FORMATS, BlobSource, EncodedPacketSink, Input } from 'mediabunny';
import { FriendlyError } from './errors';

export interface ProbeResult {
  file: File;
  width: number;
  height: number;
  duration: number;
  fps: number;
  codec: string | null;
  canDecode: boolean;
  /** Keyframes in the whole clip, or null when counting took too long. */
  keyframes: number | null;
  hasAudio: boolean;
}


const KEYFRAME_COUNT_LIMIT = 5000;

/** Reads what we need from the file without decoding any pictures. */
export async function probe(file: File): Promise<ProbeResult> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    let track;
    try {
      track = await input.getPrimaryVideoTrack();
    } catch (e) {
      throw new FriendlyError("That doesn't look like a video we can read. Try an MP4, MOV or WebM file.", String(e));
    }
    if (!track) throw new FriendlyError('This file has no video in it.');

    const [duration, stats, canDecode, audio] = await Promise.all([
      input.computeDuration(),
      track.computePacketStats(120),
      track.canDecode(),
      input.getPrimaryAudioTrack().catch(() => null),
    ]);

    return {
      file,
      width: track.displayWidth,
      height: track.displayHeight,
      duration,
      fps: Math.round(stats.averagePacketRate * 100) / 100,
      codec: track.codec,
      canDecode,
      keyframes: await countKeyframes(track),
      hasAudio: !!audio,
    };
  } finally {
    input.dispose();
  }
}

async function countKeyframes(track: ConstructorParameters<typeof EncodedPacketSink>[0]): Promise<number | null> {
  const sink = new EncodedPacketSink(track);
  const opts = { metadataOnly: true };
  let packet = await sink.getFirstKeyPacket(opts);
  let count = 0;
  while (packet) {
    count++;
    if (count > KEYFRAME_COUNT_LIMIT) return null;
    packet = await sink.getNextKeyPacket(packet, opts);
  }
  return count;
}

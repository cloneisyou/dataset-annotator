/**
 * MCAP loading and time synchronization — unified for desktop and mobile.
 *
 * Desktop datasets use a ScreenEvent with media_ref.pts_ns for time sync.
 * Mobile datasets use recording_timing metadata or statistics.messageStartTime.
 */
import { McapIndexedReader } from "@mcap/core";
import { decompress } from "fzstd";

// Blob-based readable for McapIndexedReader
class BlobReadable {
  constructor(blob) {
    this.blob = blob;
  }
  async size() {
    return BigInt(this.blob.size);
  }
  async read(offset, length) {
    const slice = this.blob.slice(Number(offset), Number(offset) + Number(length));
    return new Uint8Array(await slice.arrayBuffer());
  }
}

const decompressHandlers = {
  zstd: (data, size) => decompress(data, new Uint8Array(Number(size))),
};

export async function loadMcap(file) {
  const reader = await McapIndexedReader.Initialize({
    readable: new BlobReadable(file),
    decompressHandlers,
  });
  return { reader, channels: Array.from(reader.channelsById.values()) };
}

export async function loadMcapFromUrl(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch MCAP: ${response.status}`);
  return loadMcap(await response.blob());
}

// Time synchronization between video and MCAP
export class TimeSync {
  constructor() {
    this.basePtsTime = null;
  }

  /** Initialize from a ScreenEvent message (desktop path) */
  initFromScreenMessage(logTime, data) {
    this.basePtsTime = logTime - BigInt(data?.media_ref?.pts_ns || 0);
  }

  /** Initialize from MCAP reader metadata (mobile path) */
  async initFromReader(reader) {
    // Try to read recording_timing metadata first
    for await (const m of reader.readMetadata({ name: "recording_timing" })) {
      const startNs = m.metadata.get("start_time_ns");
      if (startNs) {
        this.basePtsTime = BigInt(startNs);
        console.log(`TimeSync: using recording_timing metadata: ${startNs}`);
        return;
      }
      break;
    }

    // Fallback: use first message time from statistics
    const stats = reader.statistics;
    if (stats) {
      this.basePtsTime = stats.messageStartTime;
      console.log(`TimeSync: falling back to messageStartTime: ${stats.messageStartTime}`);
    }
  }

  /** @param {number} videoTimeSec @returns {bigint} */
  videoTimeToMcap(videoTimeSec) {
    if (this.basePtsTime === null) return 0n;
    return this.basePtsTime + BigInt(Math.floor(videoTimeSec * 1e9));
  }

  /** @param {bigint} mcapTime @returns {number} seconds */
  mcapToVideoTime(mcapTime) {
    if (this.basePtsTime === null) return 0;
    return Number(mcapTime - this.basePtsTime) / 1e9;
  }

  /** @returns {bigint} */
  getBasePtsTime() {
    return this.basePtsTime ?? 0n;
  }
}

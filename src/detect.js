/**
 * Device type detection from MCAP channel topics and metadata.
 *
 * @param {import("@mcap/core").McapIndexedReader} reader
 * @returns {Promise<"mobile"|"desktop">}
 */
export async function detectDeviceType(reader) {
  const topics = new Set();
  for (const ch of reader.channelsById.values()) {
    topics.add(ch.topic);
  }

  // Primary: detect by topic names
  if (topics.has("touch")) return "mobile";
  if (topics.has("keyboard") || topics.has("mouse") || topics.has("mouse/raw")) return "desktop";

  // Fallback: check MCAP metadata for device info
  for await (const m of reader.readMetadata({ name: "android_device" })) {
    if (m.metadata) return "mobile";
    break;
  }
  for await (const m of reader.readMetadata({ name: "ios_device" })) {
    if (m.metadata) return "mobile";
    break;
  }

  return "desktop";
}

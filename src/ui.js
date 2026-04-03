/**
 * UI components: loading indicator, status, device info, window info,
 * MCAP info, annotation list rendering.
 * Unified for desktop and mobile.
 */
import { getAnnotations, removeAnnotation, updateAnnotation } from "./annotations.js";

export class LoadingIndicator {
  constructor(elementId = "loading-indicator") {
    this.element = document.getElementById(elementId);
  }
  show() {
    this.element?.classList.remove("hidden");
  }
  hide() {
    this.element?.classList.add("hidden");
  }
}

export function updateStatus(message, elementId = "status") {
  const el = document.getElementById(elementId);
  if (el) el.textContent = message;
}

/** Desktop: update window info panel */
export function updateWindowInfo(container, windowData) {
  if (!container) return;
  container.innerHTML = "";

  if (!windowData) {
    container.innerHTML = '<p class="placeholder">No window data</p>';
    return;
  }

  const rect = windowData.rect || [0, 0, 0, 0];
  container.innerHTML = `
    <p class="title">${windowData.title || "Unknown"}</p>
    <p class="coords">Position: ${rect[0]}, ${rect[1]}</p>
    <p class="coords">Size: ${rect[2] - rect[0]} × ${rect[3] - rect[1]}</p>
  `;
}

/** Mobile: update device info panel from MCAP metadata */
export async function updateDeviceInfo(container, reader) {
  if (!container) return;

  let androidMeta = null;
  for await (const m of reader.readMetadata({ name: "android_device" })) {
    androidMeta = m.metadata;
    break;
  }
  let iosMeta = null;
  for await (const m of reader.readMetadata({ name: "ios_device" })) {
    iosMeta = m.metadata;
    break;
  }
  let screenRes = null;
  for await (const m of reader.readMetadata({ name: "screen_resolution" })) {
    screenRes = m.metadata;
    break;
  }
  let rotationMeta = null;
  for await (const m of reader.readMetadata({ name: "initial_rotation" })) {
    rotationMeta = m.metadata;
    break;
  }

  const title = '<div class="section-title">Device Info</div>';
  const meta = androidMeta || iosMeta;
  if (!meta) {
    container.innerHTML = title + '<p class="placeholder">No device metadata</p>';
    return;
  }

  let html = title;
  if (androidMeta) {
    html += `
      <p><strong>Model:</strong> ${meta.get("device_manufacturer") || "?"} ${meta.get("device_model") || "?"}</p>
      <p><strong>Android:</strong> ${meta.get("android_version") || "?"} (SDK ${meta.get("sdk_version") || "?"})</p>
    `;
  } else if (iosMeta) {
    html += `
      <p><strong>Model:</strong> ${meta.get("device_model") || "?"} (${meta.get("hardware_model") || "?"})</p>
      <p><strong>iOS:</strong> ${meta.get("ios_version") || "?"} (${meta.get("build_version") || "?"})</p>
    `;
  }
  if (screenRes) {
    html += `<p><strong>Screen:</strong> ${screenRes.get("width") || "?"}×${screenRes.get("height") || "?"}</p>`;
  }
  if (rotationMeta) {
    const r = parseInt(rotationMeta.get("rotation") || "0");
    const labels = ["Portrait", "Landscape (90 CW)", "Portrait (180)", "Landscape (270 CW)"];
    html += `<p><strong>Initial Rotation:</strong> ${labels[r] || r}</p>`;
  }
  container.innerHTML = html;
}

export async function displayMcapInfo(container, reader) {
  if (!container) return;

  const topicStats = new Map();
  for (const ch of reader.channelsById.values()) {
    topicStats.set(ch.topic, { count: 0n });
  }

  const stats = reader.statistics;
  if (stats?.channelMessageCounts) {
    for (const [chId, count] of stats.channelMessageCounts) {
      const ch = reader.channelsById.get(chId);
      if (ch && topicStats.has(ch.topic)) topicStats.get(ch.topic).count = count;
    }
  }

  const durationSec = stats ? Number(stats.messageEndTime - stats.messageStartTime) / 1e9 : 0;

  let html = '<div class="section"><div class="section-title">Topics</div>';
  for (const [topic, info] of topicStats) {
    const count = info.count > 0n ? Number(info.count).toLocaleString() : "—";
    html += `<div class="topic-row"><span class="topic-name">${topic}</span><span class="topic-count">${count}</span></div>`;
  }
  html += "</div>";
  if (durationSec > 0) html += `<div class="time-range">Duration: ${durationSec.toFixed(1)}s</div>`;
  if (stats) html += `<div class="time-range">Messages: ${Number(stats.messageCount).toLocaleString()}</div>`;

  container.innerHTML = html;
}

/** Format seconds to MM:SS.mmm */
export function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
}

/** Render the annotation list in the panel */
export function renderAnnotationList(onSeek) {
  const listEl = document.getElementById("annotation-list");
  const emptyEl = document.getElementById("annotation-list-empty");
  const annotations = getAnnotations();

  if (annotations.length === 0) {
    listEl.innerHTML = "";
    if (emptyEl) {
      listEl.appendChild(emptyEl);
      emptyEl.style.display = "";
    }
    return;
  }
  if (emptyEl) emptyEl.style.display = "none";

  listEl.innerHTML = annotations
    .map(
      (a) => `
    <div class="annotation-item" data-id="${a.id}" data-time="${a.timestamp_sec}">
      <div class="annotation-item-header">
        <span class="annotation-item-time" title="Click to seek">@ ${formatTime(a.timestamp_sec)}</span>
        <div class="annotation-item-actions">
          <button class="annotation-item-edit" data-id="${a.id}" title="Edit">✎</button>
          <button class="annotation-item-delete" data-id="${a.id}" title="Remove">✕</button>
        </div>
      </div>
      <div class="annotation-item-text">${_escapeHtml(a.text)}</div>
    </div>`,
    )
    .join("");

  // Click-to-seek
  listEl.querySelectorAll(".annotation-item-time").forEach((el) => {
    el.addEventListener("click", () => {
      const time = parseFloat(el.closest(".annotation-item").dataset.time);
      if (onSeek) onSeek(time);
    });
  });
  // Edit
  listEl.querySelectorAll(".annotation-item-edit").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = btn.closest(".annotation-item");
      const id = btn.dataset.id;
      const timeEl = item.querySelector(".annotation-item-time");
      const textEl = item.querySelector(".annotation-item-text");
      const origTime = parseFloat(item.dataset.time);
      if (item.classList.contains("annotation-item-editing")) return;
      item.classList.add("annotation-item-editing");

      const editContainer = document.createElement("div");
      editContainer.className = "annotation-edit-container";

      const timeRow = document.createElement("div");
      timeRow.className = "annotation-edit-time-row";
      const timeLabel = document.createElement("span");
      timeLabel.className = "annotation-edit-time-label";
      timeLabel.textContent = "@ ";
      const timeInput = document.createElement("input");
      timeInput.type = "text";
      timeInput.className = "annotation-edit-time-input";
      timeInput.value = formatTime(origTime);
      timeRow.appendChild(timeLabel);
      timeRow.appendChild(timeInput);

      const textarea = document.createElement("textarea");
      textarea.className = "annotation-edit-textarea";
      textarea.value = textEl.textContent;
      textarea.rows = 3;

      const actions = document.createElement("div");
      actions.className = "annotation-edit-actions";
      actions.innerHTML = `<button class="annotation-edit-save">Save</button><button class="annotation-edit-cancel">Cancel</button>`;

      timeEl.style.display = "none";
      textEl.style.display = "none";
      editContainer.appendChild(timeRow);
      editContainer.appendChild(textarea);
      editContainer.appendChild(actions);
      item.appendChild(editContainer);
      textarea.focus();

      const parseTime = (str) => {
        const m = str.match(/^(\d+):(\d+(?:\.\d+)?)$/);
        if (!m) return null;
        return parseInt(m[1]) * 60 + parseFloat(m[2]);
      };

      const save = () => {
        const newText = textarea.value.trim();
        const newTime = parseTime(timeInput.value.trim());
        if (!newText) { cleanup(); return; }
        if (newTime === null || newTime < 0) { timeInput.classList.add("input-error"); return; }
        const textChanged = newText !== textEl.textContent;
        const timeChanged = Math.abs(newTime - origTime) > 0.0005;
        if (textChanged || timeChanged) updateAnnotation(id, newText, timeChanged ? newTime : undefined);
        else cleanup();
      };
      const cleanup = () => {
        item.classList.remove("annotation-item-editing");
        timeEl.style.display = "";
        textEl.style.display = "";
        editContainer.remove();
      };

      actions.querySelector(".annotation-edit-save").addEventListener("click", save);
      actions.querySelector(".annotation-edit-cancel").addEventListener("click", cleanup);
      textarea.addEventListener("keydown", (e) => {
        if (e.ctrlKey && e.key === "Enter") { e.preventDefault(); save(); }
        if (e.key === "Escape") cleanup();
      });
      timeInput.addEventListener("keydown", (e) => {
        if (e.ctrlKey && e.key === "Enter") { e.preventDefault(); save(); }
        if (e.key === "Escape") cleanup();
      });
    });
  });
  // Delete
  listEl.querySelectorAll(".annotation-item-delete").forEach((btn) => {
    btn.addEventListener("click", () => removeAnnotation(btn.dataset.id));
  });
}

function _escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

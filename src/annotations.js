/**
 * Annotation management — add, remove, save, load annotations.
 *
 * JSON format:
 * {
 *   "annotations": [
 *     { "id": "uuid", "timestamp_sec": 1.234, "text": "reasoning..." },
 *     ...
 *   ]
 * }
 */

let _annotations = [];
let _listeners = [];
let _instruction = null;
let _os = null;

function _notify() {
  for (const fn of _listeners) fn(_annotations);
}

/** Subscribe to annotation changes */
export function onAnnotationsChanged(fn) {
  _listeners.push(fn);
}

/** Get all annotations sorted by timestamp */
export function getAnnotations() {
  return _annotations.slice().sort((a, b) => a.timestamp_sec - b.timestamp_sec);
}

/** Add a new annotation */
export function addAnnotation(timestamp_sec, text) {
  const id = crypto.randomUUID();
  _annotations.push({ id, timestamp_sec: Math.round(timestamp_sec * 1000) / 1000, text });
  _annotations.sort((a, b) => a.timestamp_sec - b.timestamp_sec);
  _notify();
  return id;
}

/** Update annotation text and/or timestamp by id */
export function updateAnnotation(id, newText, newTimestampSec) {
  const annotation = _annotations.find((a) => a.id === id);
  if (!annotation) return;
  annotation.text = newText;
  if (newTimestampSec !== undefined) {
    annotation.timestamp_sec = Math.round(newTimestampSec * 1000) / 1000;
    _annotations.sort((a, b) => a.timestamp_sec - b.timestamp_sec);
  }
  _notify();
}

/** Remove annotation by id */
export function removeAnnotation(id) {
  _annotations = _annotations.filter((a) => a.id !== id);
  _notify();
}

/** Clear all annotations */
export function clearAnnotations() {
  _annotations = [];
  _notify();
}

/** Load annotations from JSON string */
export function loadAnnotationsFromJSON(jsonString) {
  const data = JSON.parse(jsonString);

  // Store OS and Recorder, display in device-info
  _os = data.os || null;
  const deviceEl = document.getElementById("device-info");
  if (deviceEl) {
    if (_os) {
      const existing = deviceEl.querySelector(".os-line");
      if (existing) existing.remove();
      const p = document.createElement("p");
      p.className = "os-line";
      p.innerHTML = `<strong>OS:</strong> ${_os}`;
      const title = deviceEl.querySelector(".section-title");
      if (title) title.after(p); else deviceEl.prepend(p);
    }
    if (data.recorder) {
      const existing = deviceEl.querySelector(".recorder-line");
      if (existing) existing.remove();
      const p = document.createElement("p");
      p.className = "recorder-line";
      p.innerHTML = `<strong>Recorder:</strong> ${data.recorder}`;
      const osLine = deviceEl.querySelector(".os-line");
      if (osLine) osLine.after(p);
      else {
        const title = deviceEl.querySelector(".section-title");
        if (title) title.after(p); else deviceEl.prepend(p);
      }
    }
  }

  // Store and display instruction
  _instruction = data.instructions || null;
  const instrEl = document.getElementById("instruction-text");
  if (instrEl) {
    instrEl.value = data.instructions || "";
  }

  // Load annotations if present
  if (data.annotations && Array.isArray(data.annotations)) {
    _annotations = data.annotations.map((a) => ({
      id: a.id || crypto.randomUUID(),
      timestamp_sec: a.timestamp_sec,
      text: a.text,
    }));
    _annotations.sort((a, b) => a.timestamp_sec - b.timestamp_sec);
  } else {
    _annotations = [];
  }
  _notify();
}

/** Export annotations to JSON string (reads current instruction from textarea) */
export function exportAnnotationsToJSON() {
  const instrEl = document.getElementById("instruction-text");
  const instruction = instrEl ? instrEl.value.trim() || null : _instruction;
  const sorted = getAnnotations();
  return JSON.stringify({ os: _os, instructions: instruction, annotations: sorted }, null, 2);
}

/** Save annotations as a downloadable JSON file */
export function saveAnnotationsToFile(filename) {
  const json = exportAnnotationsToJSON();
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Get the OS value from the loaded JSON */
export function getOs() {
  return _os;
}

/** Load annotations from a File object */
export async function loadAnnotationsFromFile(file) {
  const text = await file.text();
  loadAnnotationsFromJSON(text);
}

/** Get the annotation closest to (and at or before) the given time */
export function getAnnotationsUpTo(timeSec) {
  return _annotations.filter((a) => a.timestamp_sec <= timeSec);
}

/** Get the latest annotation at or before timeSec */
export function getLatestAnnotationAt(timeSec) {
  const before = getAnnotationsUpTo(timeSec);
  return before.length > 0 ? before[before.length - 1] : null;
}

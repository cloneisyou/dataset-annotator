/**
 * Unified annotator viewer — detects device type and delegates to
 * desktop or mobile rendering modules.
 */
import { loadMcap, loadMcapFromUrl, TimeSync } from "./mcap.js";
import { detectDeviceType } from "./detect.js";
import { LoadingIndicator, updateStatus, displayMcapInfo, updateWindowInfo, updateDeviceInfo, formatTime, renderAnnotationList } from "./ui.js";
import { Timeline } from "./timeline.js";
import {
  addAnnotation,
  onAnnotationsChanged,
  saveAnnotationsToFile,
  loadAnnotationsFromFile,
  getOs,
} from "./annotations.js";

const video = document.getElementById("video");

let mcapReader = null;
const timeSync = new TimeSync();
const loading = new LoadingIndicator();
let stateManager = null;
let userWantsToPlay = false;
let timeline = null;
let _baseName = "recording";
let _deviceType = null;

// Desktop-specific modules (lazy loaded)
let desktopOverlay = null;
let desktopConstants = null;

// Mobile-specific modules (lazy loaded)
let mobileOverlay = null;
let mobileConstants = null;

// -----------------------------------------------------------------------
// State loading for seek
// -----------------------------------------------------------------------

async function loadStateAt(targetTime) {
  if (!mcapReader) return;
  stateManager.isLoading = true;
  video.pause();
  loading.show();

  try {
    stateManager.reset(targetTime);

    if (_deviceType === "desktop") {
      await _loadDesktopStateAt(targetTime);
    } else {
      // Mobile: replay all messages from start to target
      for await (const msg of mcapReader.readMessages({
        endTime: targetTime,
        topics: stateManager.getUpdateTopics(),
      })) {
        const channel = mcapReader.channelsById.get(msg.channelId);
        stateManager.processMessage(channel.topic, JSON.parse(new TextDecoder().decode(msg.data)), msg.logTime);
      }
    }

    stateManager.lastProcessedTime = targetTime;
  } finally {
    stateManager.isLoading = false;
    loading.hide();
  }
  if (userWantsToPlay) video.play();
}

async function _loadDesktopStateAt(targetTime) {
  const TOPICS = desktopConstants.TOPICS;

  // Load from nearest keyboard state snapshot
  let keyboardStateTime = 0n;
  for await (const msg of mcapReader.readMessages({
    endTime: targetTime,
    topics: [TOPICS.KEYBOARD_STATE],
    reverse: true,
  })) {
    stateManager.applyKeyboardState(JSON.parse(new TextDecoder().decode(msg.data)));
    keyboardStateTime = msg.logTime;
    break;
  }

  if (keyboardStateTime > 0n) {
    for await (const msg of mcapReader.readMessages({
      startTime: keyboardStateTime + 1n,
      endTime: targetTime,
      topics: [TOPICS.KEYBOARD],
    })) {
      stateManager.processMessage(TOPICS.KEYBOARD, JSON.parse(new TextDecoder().decode(msg.data)), msg.logTime);
    }
  }

  // Load from nearest mouse state snapshot
  let mouseStateTime = 0n;
  for await (const msg of mcapReader.readMessages({
    endTime: targetTime,
    topics: [TOPICS.MOUSE_STATE],
    reverse: true,
  })) {
    stateManager.applyMouseState(JSON.parse(new TextDecoder().decode(msg.data)));
    mouseStateTime = msg.logTime;
    break;
  }

  const mouseTopic = stateManager.getMouseTopic();
  if (mouseStateTime > 0n) {
    for await (const msg of mcapReader.readMessages({
      startTime: mouseStateTime + 1n,
      endTime: targetTime,
      topics: [mouseTopic],
    })) {
      stateManager.processMessage(mouseTopic, JSON.parse(new TextDecoder().decode(msg.data)), msg.logTime);
    }
  }

  // Latest window info
  for await (const msg of mcapReader.readMessages({ endTime: targetTime, topics: [TOPICS.WINDOW], reverse: true })) {
    stateManager.applyWindowState(JSON.parse(new TextDecoder().decode(msg.data)));
    break;
  }
}

async function updateStateUpTo(targetTime) {
  if (!mcapReader || stateManager.isLoading || targetTime <= stateManager.lastProcessedTime) return;

  for await (const msg of mcapReader.readMessages({
    startTime: stateManager.lastProcessedTime,
    endTime: targetTime,
    topics: stateManager.getUpdateTopics(),
  })) {
    if (stateManager.isLoading) return;
    const channel = mcapReader.channelsById.get(msg.channelId);
    stateManager.processMessage(channel.topic, JSON.parse(new TextDecoder().decode(msg.data)), msg.logTime);
  }

  if (!stateManager.isLoading) stateManager.lastProcessedTime = targetTime;
}

function seekTo(timeSec) {
  video.currentTime = timeSec;
}

// -----------------------------------------------------------------------
// Render loops
// -----------------------------------------------------------------------

function startDesktopRenderLoop() {
  const overlay = document.getElementById("overlay");
  const ctx = overlay.getContext("2d");
  const { KEYBOARD_COLUMNS, KEY_SIZE, KEY_MARGIN, SCREEN_WIDTH, SCREEN_HEIGHT } = desktopConstants;
  const { drawKeyboard, drawMouse, drawMinimap } = desktopOverlay;
  const keyboardWidth = KEYBOARD_COLUMNS * (KEY_SIZE + KEY_MARGIN);
  const mouseX = 10 + keyboardWidth + 20;
  const windowInfoEl = document.getElementById("window-info");

  (function render() {
    const mcapTime = timeSync.videoTimeToMcap(video.currentTime);
    updateStateUpTo(mcapTime).catch(console.error);
    stateManager.decayWheel();

    ctx.clearRect(0, 0, overlay.width, overlay.height);
    const { keyboard, mouse, window: win } = stateManager.state;
    drawKeyboard(ctx, 10, 10, keyboard);
    drawMouse(ctx, mouseX, 10, mouse.buttons, mouse.wheel);
    drawMinimap(ctx, mouseX + 70, 10, 160, 100, mouse.x, mouse.y, SCREEN_WIDTH, SCREEN_HEIGHT, mouse.buttons);
    updateWindowInfo(windowInfoEl, win);

    _sharedRenderUpdate();
    requestAnimationFrame(render);
  })();
}

function startMobileRenderLoop() {
  const touchCanvas = document.getElementById("touch-canvas");
  const ctx = touchCanvas.getContext("2d");
  const { drawTouches, drawKeys } = mobileOverlay;
  const { COLORS } = mobileConstants;

  const phoneFrame = document.getElementById("phone-frame");
  const btnVolumeUp = document.getElementById("btn-volume-up");
  const btnVolumeDown = document.getElementById("btn-volume-down");
  const btnPower = document.getElementById("btn-power");
  const touchInfo = document.querySelector("#touch-info span");
  const rotationInfoSpan = document.querySelector("#rotation-info span");
  const HW_KEY_BUTTONS = [
    { key: "KEY_VOLUMEUP", el: btnVolumeUp },
    { key: "KEY_VOLUMEDOWN", el: btnVolumeDown },
    { key: "KEY_POWER", el: btnPower },
  ];
  const HW_KEY_SET = new Set(HW_KEY_BUTTONS.map(b => b.key));
  const ROTATION_LABELS = ["Portrait", "Landscape", "Portrait (180)", "Landscape (270)"];
  let lastAppliedRotation = -1;

  (function render() {
    const mcapTime = timeSync.videoTimeToMcap(video.currentTime);
    updateStateUpTo(mcapTime).catch(console.error);
    stateManager.cleanupFading();

    ctx.clearRect(0, 0, touchCanvas.width, touchCanvas.height);
    ctx.fillStyle = COLORS.canvasBg;
    ctx.fillRect(0, 0, touchCanvas.width, touchCanvas.height);

    const { touches, fadingTouches, activeKeys } = stateManager.state;
    drawTouches(ctx, touches, fadingTouches);

    // Update hardware button visuals
    for (const { key, el } of HW_KEY_BUTTONS) {
      if (el) el.classList.toggle("active", activeKeys.has(key));
    }

    // Draw remaining keys at bottom (exclude hw buttons shown on the side)
    const otherKeys = new Set([...activeKeys].filter(k => !HW_KEY_SET.has(k)));
    drawKeys(ctx, otherKeys, 8, touchCanvas.height - 32, touchCanvas.width);

    if (touchInfo) touchInfo.textContent = `${touches.size}`;

    // Determine effective rotation
    let rot = stateManager.state.rotation;
    if (rot === 0 && video.videoWidth > 0 && video.videoHeight > 0) {
      if (video.videoWidth > video.videoHeight) rot = 1;
    }
    if (rotationInfoSpan) rotationInfoSpan.textContent = ROTATION_LABELS[rot] || "?";

    // Update phone frame rotation class
    if (rot !== lastAppliedRotation && phoneFrame) {
      phoneFrame.classList.remove("rotation-1", "rotation-2", "rotation-3");
      if (rot > 0) phoneFrame.classList.add(`rotation-${rot}`);
      lastAppliedRotation = rot;
      syncCanvasToVideo();
    }

    _sharedRenderUpdate();
    requestAnimationFrame(render);
  })();
}

function _sharedRenderUpdate() {
  const timeInfo = document.querySelector("#time-info span");
  if (timeInfo) timeInfo.textContent = `${video.currentTime.toFixed(2)}s`;

  const tsEl = document.getElementById("annotation-timestamp-display");
  if (tsEl) tsEl.textContent = `@ ${formatTime(video.currentTime)}`;

  if (timeline) timeline.update();
  _highlightCurrentAnnotation(video.currentTime);
}

function _highlightCurrentAnnotation(currentTimeSec) {
  const items = document.querySelectorAll(".annotation-item");
  let closest = null;
  let closestDist = Infinity;
  for (const item of items) {
    item.classList.remove("annotation-item-active");
    const t = parseFloat(item.dataset.time);
    if (t <= currentTimeSec && currentTimeSec - t < closestDist) {
      closestDist = currentTimeSec - t;
      closest = item;
    }
  }
  if (closest && closestDist < 2) closest.classList.add("annotation-item-active");
}

// -----------------------------------------------------------------------
// Canvas sync (mobile)
// -----------------------------------------------------------------------

function syncCanvasToVideo() {
  const touchCanvas = document.getElementById("touch-canvas");
  if (!touchCanvas) return;
  touchCanvas.width = video.videoWidth;
  touchCanvas.height = video.videoHeight;
  const rect = video.getBoundingClientRect();
  touchCanvas.style.width = rect.width + "px";
  touchCanvas.style.height = rect.height + "px";
}

// -----------------------------------------------------------------------
// Setup
// -----------------------------------------------------------------------

async function setup(reader) {
  mcapReader = reader;
  _deviceType = await detectDeviceType(reader);
  console.log(`Detected device type: ${_deviceType}`);

  // Toggle mode classes on viewer
  const viewerEl = document.getElementById("viewer");
  viewerEl.classList.remove("mode-desktop", "mode-mobile");
  viewerEl.classList.add(`mode-${_deviceType}`);

  // Load mode-specific modules
  if (_deviceType === "desktop") {
    const [stateModule, overlayModule, constantsModule] = await Promise.all([
      import("./desktop/state.js"),
      import("./desktop/overlay.js"),
      import("./desktop/constants.js"),
    ]);
    stateManager = new stateModule.StateManager();
    desktopOverlay = overlayModule;
    desktopConstants = constantsModule;

    // Init time sync from screen message
    for await (const msg of reader.readMessages({ topics: [constantsModule.TOPICS.SCREEN] })) {
      timeSync.initFromScreenMessage(msg.logTime, JSON.parse(new TextDecoder().decode(msg.data)));
      break;
    }
  } else {
    const [stateModule, overlayModule, constantsModule] = await Promise.all([
      import("./mobile/state.js"),
      import("./mobile/overlay.js"),
      import("./mobile/constants.js"),
    ]);
    stateManager = new stateModule.StateManager();
    mobileOverlay = overlayModule;
    mobileConstants = constantsModule;

    // Init time sync from reader metadata
    await timeSync.initFromReader(reader);
  }

  await displayMcapInfo(document.getElementById("mcap-info"), reader);

  if (_deviceType === "mobile") {
    await updateDeviceInfo(document.getElementById("device-info"), reader);
  }

  stateManager.lastProcessedTime = timeSync.getBasePtsTime();
  if (_deviceType === "desktop") {
    stateManager.lastRecenterTime = stateManager.lastProcessedTime;
  }

  let pendingSeek = null;
  video.addEventListener("seeked", async () => {
    const targetTime = timeSync.videoTimeToMcap(video.currentTime);
    pendingSeek = targetTime;
    if (stateManager.isLoading) return;
    await loadStateAt(targetTime);
    while (pendingSeek !== null && pendingSeek !== stateManager.lastProcessedTime) {
      const nextTarget = pendingSeek;
      pendingSeek = null;
      await loadStateAt(nextTarget);
    }
    pendingSeek = null;
  });

  video.addEventListener("play", () => {
    userWantsToPlay = true;
    if (stateManager.isLoading) video.pause();
  });
  video.addEventListener("pause", () => {
    if (!stateManager.isLoading) userWantsToPlay = false;
  });
}

function initViewer(channelCount) {
  document.getElementById("landing")?.classList.add("hidden");
  document.getElementById("file-select")?.classList.add("hidden");
  document.getElementById("viewer").classList.remove("hidden");

  video.onloadedmetadata = () => {
    if (_deviceType === "desktop") {
      const overlay = document.getElementById("overlay");
      const w = video.offsetWidth || 800;
      overlay.width = w;
      overlay.height = desktopConstants.OVERLAY_HEIGHT;
      overlay.style.width = w + "px";
    } else {
      syncCanvasToVideo();
      const ro = new ResizeObserver(() => syncCanvasToVideo());
      ro.observe(video);
      video.addEventListener("resize", () => syncCanvasToVideo());
    }

    // Create timeline
    timeline = new Timeline(video, { onSeek: () => {} });
    timeline.renderMarkers();

    if (_deviceType === "desktop") {
      startDesktopRenderLoop();
    } else {
      startMobileRenderLoop();
    }
  };

  // Transport controls
  const btnPlayPause = document.getElementById("btn-play-pause");
  const btnPrevFrame = document.getElementById("btn-prev-frame");
  const btnNextFrame = document.getElementById("btn-next-frame");

  if (btnPlayPause) {
    btnPlayPause.addEventListener("click", () => {
      if (video.paused) video.play(); else video.pause();
    });
    video.addEventListener("play", () => { btnPlayPause.textContent = "\u23F8"; });
    video.addEventListener("pause", () => { btnPlayPause.textContent = "\u25B6"; });
  }
  if (btnPrevFrame) btnPrevFrame.addEventListener("click", () => { video.pause(); video.currentTime = Math.max(0, video.currentTime - 1 / 30); });
  if (btnNextFrame) btnNextFrame.addEventListener("click", () => { video.pause(); video.currentTime = Math.min(video.duration, video.currentTime + 1 / 30); });

  // Skip forward/backward
  const skipIntervalInput = document.getElementById("skip-interval");
  const getSkipInterval = () => parseFloat(skipIntervalInput?.value) || 1;
  const btnSkipBack = document.getElementById("btn-skip-back");
  const btnSkipForward = document.getElementById("btn-skip-forward");
  if (btnSkipBack) btnSkipBack.addEventListener("click", () => { video.currentTime = Math.max(0, video.currentTime - getSkipInterval()); });
  if (btnSkipForward) btnSkipForward.addEventListener("click", () => { video.currentTime = Math.min(video.duration, video.currentTime + getSkipInterval()); });

  // Keyboard shortcuts
  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") return;
    if (e.code === "Space") { e.preventDefault(); if (video.paused) video.play(); else video.pause(); }
    if (e.code === "ArrowLeft") { e.preventDefault(); video.pause(); video.currentTime = Math.max(0, video.currentTime - 1 / 30); }
    if (e.code === "ArrowRight") { e.preventDefault(); video.pause(); video.currentTime = Math.min(video.duration, video.currentTime + 1 / 30); }
  });

  // Annotation: add button
  const btnAdd = document.getElementById("btn-add-annotation");
  const textArea = document.getElementById("annotation-text");
  if (btnAdd && textArea) {
    btnAdd.addEventListener("click", () => {
      const text = textArea.value.trim();
      if (!text) return;
      addAnnotation(video.currentTime, text);
      textArea.value = "";
    });
    textArea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); btnAdd.click(); }
    });
  }

  // Save / Load JSON
  const btnSave = document.getElementById("btn-save-json");
  if (btnSave) btnSave.addEventListener("click", () => saveAnnotationsToFile(`${_baseName}.json`));

  const jsonInput = document.getElementById("json-input-viewer");
  if (jsonInput) jsonInput.addEventListener("change", async (e) => {
    if (e.target.files[0]) {
      await loadAnnotationsFromFile(e.target.files[0]);
      if (_deviceType === "desktop" && desktopOverlay) {
        desktopOverlay.setKeyboardOS(getOs());
      }
      e.target.value = "";
    }
  });

  // Re-render annotation list + timeline markers whenever annotations change
  onAnnotationsChanged(() => {
    renderAnnotationList(seekTo);
    if (timeline) timeline.renderMarkers();
  });

  // Desktop-specific: mouse mode controls
  if (_deviceType === "desktop") {
    const recenterInput = document.getElementById("recenter-interval");
    recenterInput?.addEventListener("change", (e) => {
      stateManager.recenterIntervalMs = Math.max(0, parseInt(e.target.value, 10) || 0);
    });

    document.querySelectorAll('input[name="mouse-mode"]').forEach((radio) => {
      radio.addEventListener("change", (e) => {
        stateManager.mouseMode = e.target.value;
        if (recenterInput) recenterInput.disabled = stateManager.mouseMode !== "raw";
        loadStateAt(timeSync.videoTimeToMcap(video.currentTime));
      });
    });
  }

  // Initial render
  renderAnnotationList(seekTo);
  updateStatus(`Ready: ${channelCount} channels`);
}

// -----------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------

export async function loadFromFiles(mcapFile, mkvFile, statusEl, jsonFile) {
  updateStatus("Loading...");
  try {
    _baseName = mcapFile.name.replace(/\.mcap$/i, "");
    const { reader, channels } = await loadMcap(mcapFile);
    await setup(reader);
    video.src = URL.createObjectURL(mkvFile);
    initViewer(channels.length);
    if (jsonFile) {
      await loadAnnotationsFromFile(jsonFile);
      if (_deviceType === "desktop" && desktopOverlay) {
        desktopOverlay.setKeyboardOS(getOs());
      }
    }
  } catch (e) {
    console.error("loadFromFiles error:", e);
    const msg = `Error: ${e.message}`;
    updateStatus(msg);
    if (statusEl) statusEl.textContent = msg;
  }
}

export async function loadFromUrls(mcapUrl, mkvUrl) {
  updateStatus("Loading...");
  try {
    const { reader, channels } = await loadMcapFromUrl(mcapUrl);
    await setup(reader);
    video.src = mkvUrl;
    initViewer(channels.length);
  } catch (e) {
    updateStatus(`Error: ${e.message}`);
    console.error(e);
  }
}

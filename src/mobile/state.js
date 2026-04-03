/**
 * Android state manager — tracks active touches, trails, and key presses.
 */
import { TOPICS, MAX_TRAIL_LENGTH, TOUCH_FADE_MS } from "./constants.js";

export class StateManager {
  constructor() {
    this.reset(0n);
  }

  reset(time) {
    this.state = {
      touches: new Map(),
      fadingTouches: [],
      activeKeys: new Set(),
      /** Current screen rotation (0=portrait, 1=landscape, 2=180, 3=270) */
      rotation: 0,
      /** Current video dimensions (updated on rotation change) */
      videoWidth: 0,
      videoHeight: 0,
    };
    this.lastProcessedTime = time;
    this.isLoading = false;
  }

  processMessage(topic, data, logTime) {
    switch (topic) {
      case TOPICS.TOUCH:
        this._handleTouch(data, logTime);
        break;
      case TOPICS.KEY:
        this._handleKey(data);
        break;
      case TOPICS.ROTATION:
        this._handleRotation(data);
        break;
    }
  }

  getUpdateTopics() {
    return [TOPICS.TOUCH, TOPICS.KEY, TOPICS.ROTATION];
  }

  _handleTouch(data, logTime) {
    const { event_type, slot, tracking_id, x, y, pressure, touch_major } = data;

    if (event_type === "touch_down") {
      this.state.touches.set(slot, {
        trackingId: tracking_id, x, y,
        pressure: pressure || 0,
        touchMajor: touch_major || 0,
        trail: [{ x, y, time: logTime }],
      });
    } else if (event_type === "touch_move") {
      const touch = this.state.touches.get(slot);
      if (touch) {
        touch.x = x;
        touch.y = y;
        touch.pressure = pressure || touch.pressure;
        touch.touchMajor = touch_major || touch.touchMajor;
        touch.trail.push({ x, y, time: logTime });
        if (touch.trail.length > MAX_TRAIL_LENGTH) touch.trail.shift();
      } else {
        this.state.touches.set(slot, {
          trackingId: tracking_id, x, y,
          pressure: pressure || 0,
          touchMajor: touch_major || 0,
          trail: [{ x, y, time: logTime }],
        });
      }
    } else if (event_type === "touch_up") {
      const touch = this.state.touches.get(slot);
      if (touch) {
        this.state.fadingTouches.push({
          slot, x: touch.x, y: touch.y,
          trail: touch.trail.slice(),
          endTime: performance.now(),
        });
        this.state.touches.delete(slot);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Rotation handling
  // -----------------------------------------------------------------------

  _handleRotation(data) {
    this.state.rotation = data.rotation || 0;
    this.state.videoWidth = data.video_width || 0;
    this.state.videoHeight = data.video_height || 0;
  }

  static _TOUCH_PROTOCOL_KEYS = new Set([
    "BTN_TOUCH", "BTN_TOOL_FINGER", "BTN_TOOL_PEN", "BTN_TOOL_RUBBER",
    "BTN_TOOL_DOUBLETAP", "BTN_TOOL_TRIPLETAP", "BTN_TOOL_QUADTAP",
    "BTN_TOOL_QUINTTAP",
  ]);

  _handleKey(data) {
    const { event_type, key_code } = data;
    if (StateManager._TOUCH_PROTOCOL_KEYS.has(key_code)) return;
    if (event_type === "key_down" || event_type === "key_repeat") {
      this.state.activeKeys.add(key_code);
    } else if (event_type === "key_up") {
      this.state.activeKeys.delete(key_code);
    }
  }

  cleanupFading() {
    const now = performance.now();
    this.state.fadingTouches = this.state.fadingTouches.filter(
      (ft) => now - ft.endTime < TOUCH_FADE_MS,
    );
  }
}

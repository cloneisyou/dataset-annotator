/**
 * Custom timeline / scrubber component for frame-accurate seeking.
 * Draws annotation markers on the timeline track.
 */
import { getAnnotations } from "./annotations.js";
import { formatTime } from "./ui.js";

export class Timeline {
  /**
   * @param {HTMLVideoElement} video
   * @param {object} opts
   * @param {function} opts.onSeek - called with (timeSec) when user scrubs
   */
  constructor(video, { onSeek } = {}) {
    this.video = video;
    this.onSeek = onSeek;

    this.track = document.getElementById("timeline-track");
    this.progress = document.getElementById("timeline-progress");
    this.playhead = document.getElementById("timeline-playhead");
    this.timeDisplay = document.getElementById("timeline-time-display");
    this.durationDisplay = document.getElementById("timeline-duration");
    this.currentTimeLabel = document.getElementById("current-time-label");

    this._dragging = false;
    this._bindEvents();
  }

  _bindEvents() {
    // Click / drag on track
    this.track.addEventListener("mousedown", (e) => {
      this._dragging = true;
      this._scrubTo(e);
    });
    window.addEventListener("mousemove", (e) => {
      if (this._dragging) this._scrubTo(e);
    });
    window.addEventListener("mouseup", () => {
      this._dragging = false;
    });

    // Video metadata
    this.video.addEventListener("loadedmetadata", () => {
      if (this.durationDisplay) {
        this.durationDisplay.textContent = formatTime(this.video.duration);
      }
    });
  }

  _scrubTo(e) {
    const rect = this.track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const time = ratio * this.video.duration;
    this.video.currentTime = time;
    if (this.onSeek) this.onSeek(time);
  }

  /** Call every frame to update visual position */
  update() {
    if (!this.video.duration) return;
    const ratio = this.video.currentTime / this.video.duration;
    const pct = (ratio * 100).toFixed(3) + "%";

    this.progress.style.width = pct;
    this.playhead.style.left = pct;

    if (this.timeDisplay) this.timeDisplay.textContent = formatTime(this.video.currentTime);
    if (this.currentTimeLabel) this.currentTimeLabel.textContent = this.video.currentTime.toFixed(3) + "s";
  }

  /** Render annotation markers on timeline */
  renderMarkers() {
    // Remove existing markers
    this.track.querySelectorAll(".timeline-marker").forEach((m) => m.remove());

    const dur = this.video.duration;
    if (!dur) return;

    for (const a of getAnnotations()) {
      const pct = (a.timestamp_sec / dur) * 100;
      if (pct < 0 || pct > 100) continue;
      const marker = document.createElement("div");
      marker.className = "timeline-marker";
      marker.style.left = pct.toFixed(3) + "%";
      marker.title = `@ ${formatTime(a.timestamp_sec)}: ${a.text.slice(0, 60)}`;
      this.track.appendChild(marker);
    }
  }
}

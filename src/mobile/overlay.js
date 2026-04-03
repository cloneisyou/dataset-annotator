/**
 * Touch overlay drawing — red circles, trails, ripple and fade effects.
 */
import { COLORS, TOUCH_RADIUS, RIPPLE_RADIUS, TOUCH_FADE_MS } from "./constants.js";

export function drawTouches(ctx, touches, fading) {
  const now = performance.now();
  for (const ft of fading) {
    const elapsed = now - ft.endTime;
    const alpha = Math.max(0, 1 - elapsed / TOUCH_FADE_MS);
    if (alpha <= 0) continue;

    _drawTrail(ctx, ft.trail, alpha * 0.4);

    ctx.beginPath();
    ctx.arc(ft.x, ft.y, TOUCH_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(231, 76, 60, ${(0.5 * alpha).toFixed(3)})`;
    ctx.fill();

    const rippleR = RIPPLE_RADIUS + (1 - alpha) * 20;
    ctx.beginPath();
    ctx.arc(ft.x, ft.y, rippleR, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(231, 76, 60, ${(0.3 * alpha).toFixed(3)})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  for (const [, touch] of touches) {
    _drawTrail(ctx, touch.trail, 0.4);

    ctx.beginPath();
    ctx.arc(touch.x, touch.y, TOUCH_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.touchActive;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(touch.x, touch.y, RIPPLE_RADIUS, 0, Math.PI * 2);
    ctx.strokeStyle = COLORS.touchRipple;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function _drawTrail(ctx, trail, baseAlpha) {
  if (!trail || trail.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(trail[0].x, trail[0].y);
  for (let i = 1; i < trail.length; i++) ctx.lineTo(trail[i].x, trail[i].y);
  ctx.strokeStyle = `rgba(231, 76, 60, ${baseAlpha.toFixed(3)})`;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
}

export function drawKeys(ctx, activeKeys, x, y, canvasW) {
  if (activeKeys.size === 0) return;
  const keys = Array.from(activeKeys);
  const boxH = 24;
  const pad = 6;
  let cx = x;
  ctx.font = "12px Inter, monospace";
  for (const key of keys) {
    const label = key.replace("KEY_", "");
    const tw = ctx.measureText(label).width + pad * 2;
    ctx.fillStyle = COLORS.keyActive;
    ctx.beginPath();
    ctx.roundRect(cx, y, tw, boxH, 4);
    ctx.fill();
    ctx.fillStyle = COLORS.keyText;
    ctx.textBaseline = "middle";
    ctx.fillText(label, cx + pad, y + boxH / 2);
    cx += tw + 4;
    if (cx > canvasW - 10) break;
  }
}

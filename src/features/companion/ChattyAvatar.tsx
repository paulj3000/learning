import { useEffect, useRef } from 'react';
import styles from './ChattyAvatar.module.css';
import { prefersReducedMotion } from '../../lib/motionPreference';

const CHATTY_COLORS = {
  bodyGreenLight: '#4caf6b',
  bodyGreen: '#2f8f4e',
  bodyGreenDark: '#1f6b39',
  bellyYellowLight: '#fbe98a',
  bellyYellow: '#f4d35e',
  crestRed: '#d94f4f',
  crestBlue: '#3b7dd8',
  beakLight: '#ffcf7a',
  beak: '#f2a541',
  beakDark: '#c97a1a',
  eyeWhite: '#ffffff',
  eyeBlack: '#1b2733',
  perchBrown: '#8a5a34',
  perchBrownLight: '#a97645',
  perchBrownDark: '#5f3c22',
  shadow: 'rgba(15, 23, 31, 0.28)',
} as const;

/** A single animated pose. All fields default to Chatty standing still. */
export interface ChattyFrame {
  /** 0 = standing on the perch, up to ~1 = peak of a hop. */
  hop?: number;
  /** Extra wing-rotation while flapping, in radians. */
  wingFlap?: number;
  /** Side-to-side tilt, in radians. */
  tilt?: number;
}

/** Draws Chatty the Parrot into a fixed 200x200 logical coordinate space. */
export function drawChatty(ctx: CanvasRenderingContext2D, frame: ChattyFrame = {}): void {
  const { hop = 0, wingFlap = 0, tilt = 0 } = frame;
  ctx.clearRect(0, 0, 200, 200);

  drawGroundShadow(ctx, hop);
  drawPerch(ctx);

  ctx.save();
  ctx.translate(100, 168);
  ctx.rotate(tilt);
  ctx.translate(-100, -168 - hop * 20);

  drawTailFeathers(ctx);
  drawWing(ctx, wingFlap);
  drawBody(ctx);
  drawFeet(ctx);
  drawHead(ctx);
  drawCrest(ctx);
  drawEye(ctx);
  drawBeak(ctx);

  ctx.restore();
}

function drawGroundShadow(ctx: CanvasRenderingContext2D, hop: number): void {
  const shrink = 1 - Math.min(hop, 1) * 0.4;
  ctx.save();
  ctx.globalAlpha = 0.35 * shrink;
  ctx.fillStyle = CHATTY_COLORS.shadow;
  ctx.beginPath();
  ctx.ellipse(100, 196, 32 * shrink, 6 * shrink, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPerch(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = CHATTY_COLORS.perchBrown;
  ctx.strokeStyle = CHATTY_COLORS.perchBrownDark;
  ctx.lineWidth = 2;
  roundedRectPath(ctx, 50, 178, 100, 14, 6);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = CHATTY_COLORS.perchBrownLight;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(58, 183);
  ctx.lineTo(142, 183);
  ctx.stroke();
}

function drawTailFeathers(ctx: CanvasRenderingContext2D): void {
  drawFeatherStroke(ctx, 90, 150, 62, 188, CHATTY_COLORS.crestBlue);
  drawFeatherStroke(ctx, 100, 150, 100, 194, CHATTY_COLORS.crestRed);
  drawFeatherStroke(ctx, 110, 150, 138, 188, CHATTY_COLORS.bodyGreenDark);
}

function drawWing(ctx: CanvasRenderingContext2D, wingFlap: number): void {
  const rotation = -0.3 - wingFlap * 0.5;
  const gradient = ctx.createLinearGradient(115, 90, 155, 160);
  gradient.addColorStop(0, CHATTY_COLORS.bodyGreen);
  gradient.addColorStop(1, CHATTY_COLORS.bodyGreenDark);
  ctx.fillStyle = gradient;
  ctx.strokeStyle = CHATTY_COLORS.bodyGreenDark;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(135, 125, 22, 38, rotation, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function drawBody(ctx: CanvasRenderingContext2D): void {
  const bodyGradient = ctx.createRadialGradient(85, 90, 10, 100, 120, 70);
  bodyGradient.addColorStop(0, CHATTY_COLORS.bodyGreenLight);
  bodyGradient.addColorStop(1, CHATTY_COLORS.bodyGreen);
  ctx.fillStyle = bodyGradient;
  ctx.strokeStyle = CHATTY_COLORS.bodyGreenDark;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(100, 120, 45, 55, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  const bellyGradient = ctx.createRadialGradient(92, 125, 6, 100, 140, 32);
  bellyGradient.addColorStop(0, CHATTY_COLORS.bellyYellowLight);
  bellyGradient.addColorStop(1, CHATTY_COLORS.bellyYellow);
  ctx.fillStyle = bellyGradient;
  ctx.beginPath();
  ctx.ellipse(100, 140, 22, 30, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawFeet(ctx: CanvasRenderingContext2D): void {
  ctx.strokeStyle = CHATTY_COLORS.beakDark;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(88, 178);
  ctx.lineTo(85, 165);
  ctx.moveTo(112, 178);
  ctx.lineTo(115, 165);
  ctx.stroke();
}

function drawHead(ctx: CanvasRenderingContext2D): void {
  const gradient = ctx.createRadialGradient(88, 55, 6, 100, 68, 44);
  gradient.addColorStop(0, CHATTY_COLORS.bodyGreenLight);
  gradient.addColorStop(1, CHATTY_COLORS.bodyGreen);
  ctx.fillStyle = gradient;
  ctx.strokeStyle = CHATTY_COLORS.bodyGreenDark;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(100, 68, 40, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = CHATTY_COLORS.eyeWhite;
  ctx.beginPath();
  ctx.ellipse(82, 45, 14, 9, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCrest(ctx: CanvasRenderingContext2D): void {
  drawFeatherStroke(ctx, 85, 35, 75, 8, CHATTY_COLORS.crestRed);
  drawFeatherStroke(ctx, 100, 30, 100, 2, CHATTY_COLORS.crestBlue);
  drawFeatherStroke(ctx, 115, 35, 125, 8, CHATTY_COLORS.bellyYellow);
}

function drawEye(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = CHATTY_COLORS.eyeWhite;
  ctx.beginPath();
  ctx.arc(118, 62, 13, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = CHATTY_COLORS.eyeBlack;
  ctx.beginPath();
  ctx.arc(121, 62, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = CHATTY_COLORS.eyeWhite;
  ctx.beginPath();
  ctx.arc(123, 59, 2, 0, Math.PI * 2);
  ctx.fill();
}

function drawBeak(ctx: CanvasRenderingContext2D): void {
  const gradient = ctx.createLinearGradient(98, 72, 128, 96);
  gradient.addColorStop(0, CHATTY_COLORS.beakLight);
  gradient.addColorStop(1, CHATTY_COLORS.beak);
  ctx.fillStyle = gradient;
  ctx.strokeStyle = CHATTY_COLORS.beakDark;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(100, 72);
  ctx.quadraticCurveTo(130, 78, 128, 96);
  ctx.quadraticCurveTo(115, 100, 98, 88);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawFeatherStroke(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

const HOP_DURATION_MS = 650;

function easeOutQuad(t: number): number {
  return t * (2 - t);
}

/** Renders one hop-and-flap animation frame for elapsed time `t` in [0, 1]. */
function hopFrame(t: number): ChattyFrame {
  const eased = easeOutQuad(t);
  return {
    hop: Math.sin(Math.PI * eased),
    wingFlap: Math.sin(Math.PI * 2 * eased) * (1 - t),
    tilt: Math.sin(Math.PI * 3 * eased) * 0.08 * (1 - t),
  };
}

interface ChattyAvatarProps {
  /** Rendered width and height in CSS pixels. */
  size?: number;
  className?: string;
}

/**
 * Chatty's portrait, drawn with the HTML5 Canvas 2D API rather than an
 * image asset (no binary asset pipeline exists in this repo yet, matching
 * the inline-SVG-not-images precedent already used for the bridge
 * adventure's plank icons). Tapping Chatty plays a short hop-and-flap
 * animation (`hopFrame`/`drawChatty`'s `frame` argument), skipped in
 * favor of a single still redraw when the OS-level
 * `prefers-reduced-motion` preference is set. No audio yet — sound is a
 * later addition once the child-safety/parent-mute controls for it exist
 * (CLAUDE.md section 2, "parent controls voice, microphone").
 *
 * Rendered as a real `<button>` (CLAUDE.md section 13: accessible buttons
 * over clickable divs), so tap/click/keyboard (Enter/Space) all work and
 * it gets the app's normal focus-visible ring. The canvas pixels are
 * `aria-hidden`; the button's `aria-label` carries the accessible name,
 * and every call site still shows the visible "Chatty the Parrot" text
 * label next to it per docs/UX_AND_ACCESSIBILITY.md's "icon plus text,
 * not icon alone" rule.
 */
export function ChattyAvatar({ size = 96, className }: ChattyAvatarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const devicePixelRatio = window.devicePixelRatio || 1;
    canvas.width = size * devicePixelRatio;
    canvas.height = size * devicePixelRatio;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale((size / 200) * devicePixelRatio, (size / 200) * devicePixelRatio);
    drawChatty(ctx);
  }, [size]);

  useEffect(
    () => () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    },
    [],
  );

  function handleClick() {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) {
      return;
    }
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (prefersReducedMotion()) {
      drawChatty(ctx);
      return;
    }

    const startTime = performance.now();
    const step = (now: number) => {
      const t = Math.min((now - startTime) / HOP_DURATION_MS, 1);
      drawChatty(ctx, hopFrame(t));
      if (t < 1) {
        animationFrameRef.current = requestAnimationFrame(step);
      } else {
        animationFrameRef.current = null;
      }
    };
    animationFrameRef.current = requestAnimationFrame(step);
  }

  return (
    <button
      type="button"
      className={`${styles.avatarButton} ${className ?? ''}`.trim()}
      onClick={handleClick}
      aria-label="Chatty the Parrot. Tap to say hello!"
    >
      <canvas ref={canvasRef} aria-hidden="true" style={{ width: size, height: size }}>
        Chatty the Parrot, a friendly cartoon parrot
      </canvas>
    </button>
  );
}

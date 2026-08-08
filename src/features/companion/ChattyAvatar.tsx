import { useEffect, useRef } from 'react';

const CHATTY_COLORS = {
  bodyGreen: '#2f8f4e',
  bodyGreenDark: '#1f6b39',
  bellyYellow: '#f4d35e',
  crestRed: '#d94f4f',
  crestBlue: '#3b7dd8',
  beak: '#f2a541',
  beakDark: '#c97a1a',
  eyeWhite: '#ffffff',
  eyeBlack: '#1b2733',
  perchBrown: '#8a5a34',
  perchBrownDark: '#5f3c22',
} as const;

/** Draws Chatty the Parrot into a fixed 200x200 logical coordinate space. */
export function drawChatty(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, 200, 200);

  drawPerch(ctx);
  drawTailFeathers(ctx);
  drawWing(ctx);
  drawBody(ctx);
  drawFeet(ctx);
  drawHead(ctx);
  drawCrest(ctx);
  drawEye(ctx);
  drawBeak(ctx);
}

function drawPerch(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = CHATTY_COLORS.perchBrown;
  ctx.strokeStyle = CHATTY_COLORS.perchBrownDark;
  ctx.lineWidth = 2;
  roundedRectPath(ctx, 50, 178, 100, 14, 6);
  ctx.fill();
  ctx.stroke();
}

function drawTailFeathers(ctx: CanvasRenderingContext2D): void {
  drawFeatherStroke(ctx, 90, 150, 62, 188, CHATTY_COLORS.crestBlue);
  drawFeatherStroke(ctx, 100, 150, 100, 194, CHATTY_COLORS.crestRed);
  drawFeatherStroke(ctx, 110, 150, 138, 188, CHATTY_COLORS.bodyGreenDark);
}

function drawWing(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = CHATTY_COLORS.bodyGreenDark;
  ctx.beginPath();
  ctx.ellipse(135, 125, 22, 38, -0.3, 0, Math.PI * 2);
  ctx.fill();
}

function drawBody(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = CHATTY_COLORS.bodyGreen;
  ctx.beginPath();
  ctx.ellipse(100, 120, 45, 55, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = CHATTY_COLORS.bellyYellow;
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
  ctx.fillStyle = CHATTY_COLORS.bodyGreen;
  ctx.beginPath();
  ctx.arc(100, 68, 40, 0, Math.PI * 2);
  ctx.fill();
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
  ctx.fillStyle = CHATTY_COLORS.beak;
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

interface ChattyAvatarProps {
  /** Rendered width and height in CSS pixels. */
  size?: number;
  className?: string;
}

/**
 * Chatty's portrait, drawn with the HTML5 Canvas 2D API rather than an
 * image asset (no binary asset pipeline exists in this repo yet, matching
 * the inline-SVG-not-images precedent already used for the bridge
 * adventure's plank icons). Decorative: an `aria-label` on the canvas
 * carries the accessible name, and callers still show the visible
 * "Chatty the Parrot" text label alongside it per
 * docs/UX_AND_ACCESSIBILITY.md's "icon plus text, not icon alone" rule.
 */
export function ChattyAvatar({ size = 96, className }: ChattyAvatarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="Chatty the Parrot"
      className={className}
      style={{ width: size, height: size }}
    >
      Chatty the Parrot, a friendly cartoon parrot
    </canvas>
  );
}

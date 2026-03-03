'use client';

import { useState, useEffect, useCallback } from 'react';

export interface TourStep {
  target?: string;
  title: string;
  body: string;
  placement?: 'top' | 'bottom' | 'left' | 'right';
}

interface TourProps {
  steps: TourStep[];
  onFinish: () => void;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 8;

function getRect(selector: string): Rect | null {
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    top: r.top - PAD,
    left: r.left - PAD,
    width: r.width + PAD * 2,
    height: r.height + PAD * 2,
  };
}

function tooltipStyle(
  rect: Rect | null,
  placement: TourStep['placement'],
  vw: number,
  vh: number,
): React.CSSProperties {
  if (!rect) {
    return { top: '50%', left: '50%', transform: 'translate(-50%,-50%)', maxWidth: 360 };
  }

  const tooltipW = 320;
  const tooltipH = 200; // estimated
  const gap = 16;

  let top: number;
  let left: number;

  switch (placement) {
    case 'top':
      top = rect.top - tooltipH - gap;
      left = rect.left + rect.width / 2 - tooltipW / 2;
      break;
    case 'left':
      top = rect.top + rect.height / 2 - tooltipH / 2;
      left = rect.left - tooltipW - gap;
      break;
    case 'right':
      top = rect.top + rect.height / 2 - tooltipH / 2;
      left = rect.left + rect.width + gap;
      break;
    case 'bottom':
    default:
      top = rect.top + rect.height + gap;
      left = rect.left + rect.width / 2 - tooltipW / 2;
      break;
  }

  // Clamp to viewport
  top = Math.max(8, Math.min(top, vh - tooltipH - 8));
  left = Math.max(8, Math.min(left, vw - tooltipW - 8));

  return { top, left, width: tooltipW };
}

export function Tour({ steps, onFinish }: TourProps) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [vw, setVw] = useState(0);
  const [vh, setVh] = useState(0);

  const current = steps[step];

  const measureTarget = useCallback(() => {
    setVw(window.innerWidth);
    setVh(window.innerHeight);
    if (current.target) {
      setRect(getRect(current.target));
    } else {
      setRect(null);
    }
  }, [current]);

  useEffect(() => {
    measureTarget();
    window.addEventListener('resize', measureTarget);
    return () => window.removeEventListener('resize', measureTarget);
  }, [measureTarget]);

  const goNext = () => {
    if (step < steps.length - 1) setStep(step + 1);
    else onFinish();
  };

  const goBack = () => {
    if (step > 0) setStep(step - 1);
  };

  const total = steps.length;
  const isLast = step === total - 1;

  // SVG mask hole
  const holeX = rect ? rect.left : 0;
  const holeY = rect ? rect.top : 0;
  const holeW = rect ? rect.width : 0;
  const holeH = rect ? rect.height : 0;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9990, pointerEvents: 'none' }}>
      {/* Dark overlay via SVG mask */}
      <svg
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'auto' }}
        onClick={onFinish}
      >
        <defs>
          <mask id="tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {rect && (
              <rect
                x={holeX}
                y={holeY}
                width={holeW}
                height={holeH}
                rx={6}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.55)"
          mask="url(#tour-mask)"
        />
      </svg>

      {/* Spotlight border ring */}
      {rect && (
        <div
          style={{
            position: 'absolute',
            top: holeY,
            left: holeX,
            width: holeW,
            height: holeH,
            borderRadius: 6,
            boxShadow: '0 0 0 2px #667eea, 0 0 0 4px rgba(102,126,234,0.3)',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Tooltip card */}
      <div
        style={{
          position: 'absolute',
          ...tooltipStyle(rect, current.placement, vw, vh),
          zIndex: 9991,
          pointerEvents: 'auto',
          background: '#fff',
          borderRadius: 10,
          boxShadow: '0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10)',
          padding: '20px 20px 16px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ marginBottom: 8 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: '#667eea',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            Step {step + 1} of {total}
          </span>
          <h3 style={{ margin: '4px 0 0', fontSize: 15, fontWeight: 700, color: '#1a202c', lineHeight: 1.3 }}>
            {current.title}
          </h3>
        </div>

        {/* Body */}
        <p style={{ fontSize: 13, color: '#4a5568', lineHeight: 1.6, margin: '0 0 16px' }}>
          {current.body}
        </p>

        {/* Dot indicators */}
        <div style={{ display: 'flex', gap: 5, marginBottom: 14, justifyContent: 'center' }}>
          {steps.map((_, i) => (
            <div
              key={i}
              style={{
                width: i === step ? 18 : 6,
                height: 6,
                borderRadius: 3,
                background: i === step ? '#667eea' : '#e2e8f0',
                transition: 'width 0.2s, background 0.2s',
              }}
            />
          ))}
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <button
            onClick={onFinish}
            style={{
              fontSize: 12,
              color: '#a0aec0',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '4px 0',
              textDecoration: 'underline',
            }}
          >
            Skip tour
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            {step > 0 && (
              <button
                onClick={goBack}
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#667eea',
                  background: 'none',
                  border: '1px solid #667eea',
                  borderRadius: 6,
                  padding: '6px 14px',
                  cursor: 'pointer',
                }}
              >
                Back
              </button>
            )}
            <button
              onClick={goNext}
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: '#fff',
                background: 'linear-gradient(135deg,#667eea,#764ba2)',
                border: 'none',
                borderRadius: 6,
                padding: '6px 18px',
                cursor: 'pointer',
              }}
            >
              {isLast ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

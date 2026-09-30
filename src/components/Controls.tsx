import type { ReactNode } from 'react';
import type { Fill } from '../core/types';

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="row">
      <span>{label}</span>
      <div className="row-body">{children}</div>
    </label>
  );
}

export function Num({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  slider,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  slider?: boolean;
}) {
  return (
    <Row label={label}>
      {slider && (
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      )}
      <input
        type="number"
        className="num"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
        onChange={(e) => e.target.value !== '' && onChange(Number(e.target.value))}
      />
    </Row>
  );
}

function toHex(color: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  if (/^#[0-9a-f]{3}$/i.test(color)) return '#' + [...color.slice(1)].map((c) => c + c).join('');
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) return '#' + m.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, '0')).join('');
  return '#000000';
}

export function Color({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Row label={label}>
      <input type="color" value={toHex(value)} onChange={(e) => onChange(e.target.value)} />
      <input className="color-text" value={value} onChange={(e) => onChange(e.target.value)} />
    </Row>
  );
}

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <Row label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map(([v, t]) => (
          <option key={v} value={v}>
            {t}
          </option>
        ))}
      </select>
    </Row>
  );
}

export function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Row label={label}>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </Row>
  );
}

export function FillEditor({ label, fill, onChange }: { label: string; fill: Fill; onChange: (f: Fill) => void }) {
  return (
    <div className="group">
      <Select
        label={label}
        value={fill.kind}
        options={[
          ['solid', '단색'],
          ['linear', '그라데이션'],
        ]}
        onChange={(k) =>
          onChange(
            k === 'solid'
              ? { kind: 'solid', color: fill.kind === 'solid' ? fill.color : fill.from }
              : { kind: 'linear', from: fill.kind === 'solid' ? fill.color : fill.from, to: '#ec4899', angle: 135 },
          )
        }
      />
      {fill.kind === 'solid' ? (
        <Color label="색" value={fill.color} onChange={(color) => onChange({ ...fill, color })} />
      ) : (
        <>
          <Color label="시작색" value={fill.from} onChange={(from) => onChange({ ...fill, from })} />
          <Color label="끝색" value={fill.to} onChange={(to) => onChange({ ...fill, to })} />
          <Num label="각도" value={fill.angle} min={0} max={360} slider onChange={(angle) => onChange({ ...fill, angle })} />
        </>
      )}
    </div>
  );
}

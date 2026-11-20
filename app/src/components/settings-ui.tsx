import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { sound } from "@/services/sound";

export function Group({ title, icon, children, note }: { title?: string; icon?: IconName; note?: string; children: ReactNode }) {
  return (
    <section className="mb-5 rounded-[1.6rem] bg-white/80 p-6 shadow-[0_10px_30px_-22px_rgba(30,40,70,0.45)] ring-1 ring-white/70 backdrop-blur-sm">
      {title && (
        <div className="mb-3 flex items-center gap-2.5">
          {icon && (
            <span className="grid size-8 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--tone,var(--accent))_16%,var(--ibox-white))] text-[var(--tone-ink,var(--accent-text))]">
              <Icon name={icon} size="1em" />
            </span>
          )}
          <h2 className="text-[1.08rem] font-bold text-ink">{title}</h2>
        </div>
      )}
      {note && <p className="-mt-1 mb-3 text-[0.85rem] font-semibold text-ink-soft">{note}</p>}
      <div className="flex flex-col divide-y divide-ink/6">{children}</div>
    </section>
  );
}

export function Row({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5">
      <div className="min-w-0">
        <div className="text-[0.98rem] font-bold text-ink">{label}</div>
        {note && <div className="text-[0.8rem] font-semibold text-ink-soft">{note}</div>}
      </div>
      {children}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      data-focusable
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => {
        sound.play("toggle");
        onChange(!checked);
      }}
      className={`ibox-focusable relative h-8 w-14 shrink-0 rounded-full transition-colors duration-300 [--ring-radius:999px] ${checked ? "bg-[var(--accent-deep)]" : "bg-ink/15"}`}
    >
      <span
        className={`absolute top-1 left-1 grid h-6 w-6 place-items-center rounded-full bg-white shadow-sm transition-transform duration-300 ease-[var(--ease-bounce)] ${checked ? "translate-x-6" : ""}`}
      >
        <span className={`size-1.5 rounded-full transition-colors ${checked ? "bg-[var(--accent-deep)]" : "bg-ink/20"}`} />
      </span>
    </button>
  );
}

export function VolumeControl({ value, onChange, disabled, label, test }: { value: number; onChange: (v: number) => void; disabled?: boolean; label: string; test?: boolean }) {
  const step = (d: number) => {
    onChange(Math.min(1, Math.max(0, +(value + d).toFixed(1))));
    if (test) setTimeout(() => sound.play("select"), 30);
  };
  return (
    <div className={`flex items-center gap-2 ${disabled ? "pointer-events-none opacity-45" : ""}`}>
      <RoundButton icon="minus" label={`Baisser ${label}`} onClick={() => step(-0.1)} />
      <div
        role="meter"
        aria-label={`Volume de ${label}`}
        aria-valuenow={Math.round(value * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="flex h-8 w-36 items-end gap-[3px]"
      >
        {Array.from({ length: 10 }, (_, i) => (
          <span
            key={i}
            className={`flex-1 rounded-full transition-colors duration-200 ${i < Math.round(value * 10) ? "bg-[var(--accent-deep)]" : "bg-cream-deep"}`}
            style={{ height: `${30 + i * 7}%` }}
          />
        ))}
      </div>
      <RoundButton icon="plus" label={`Monter ${label}`} onClick={() => step(0.1)} />
      <span className="w-11 text-right text-[0.85rem] font-bold text-ink-soft tabular-nums">{Math.round(value * 100)} %</span>
    </div>
  );
}

export function RoundButton({ icon, label, onClick, disabled, rotate = 0 }: { icon: IconName; label: string; onClick: () => void; disabled?: boolean; rotate?: number }) {
  return (
    <button
      data-focusable
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => {
        onClick();
        sound.play("move");
      }}
      className="ibox-focusable grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-ink shadow-xs [--ring-radius:999px] disabled:opacity-35"
    >
      <Icon name={icon} size="1.1em" style={{ transform: `rotate(${rotate}deg)` }} />
    </button>
  );
}

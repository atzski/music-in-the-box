import { sound } from "@/services/sound";

/** Interrupteur focalisable (clavier, souris, manette). */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      data-focusable
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        sound.play(checked ? "off" : "on");
        onChange(!checked);
      }}
      className={`ibox-focusable relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-50 [--ring-radius:999px] ${checked ? "bg-mint-deep" : "bg-ink/15"}`}
    >
      <span
        className={`absolute top-1 left-1 h-6 w-6 rounded-full bg-white shadow-sm transition-transform duration-300 ease-[var(--ease-bounce)] ${checked ? "translate-x-6" : ""}`}
      />
    </button>
  );
}

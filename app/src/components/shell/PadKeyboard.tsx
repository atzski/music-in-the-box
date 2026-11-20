import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { input } from "@/input/InputController";
import { setFieldValue, useGamepad } from "@/input/gamepad";
import { useSettings } from "@/services/settings";
import { sound } from "@/services/sound";
import { PadGlyph, type PadKey } from "./PadGlyph";

type Field = HTMLInputElement | HTMLTextAreaElement;

const ROWS = ["1234567890", "azertyuiop", "qsdfghjklm", "wxcvbn,.-'", "éèêàçù@_?!"];

/**
 * Clavier virtuel : s'ouvre quand on valide un champ de texte à la manette
 * (recherche, messages, nom de profil…). Le texte s'écrit en direct dans le
 * champ. X efface, Y met une espace, L1 / LB les majuscules, Start valide.
 */
export function PadKeyboard() {
  const [open, setOpen] = useState<{ field: Field; n: number } | null>(null);
  useEffect(() => {
    let n = 0;
    const onOpen = (e: Event) => setOpen({ field: (e as CustomEvent<Field>).detail, n: ++n });
    window.addEventListener("ibox:pad-keyboard", onOpen);
    return () => window.removeEventListener("ibox:pad-keyboard", onOpen);
  }, []);
  if (!open || !open.field.isConnected) return null;
  return <KeyboardPanel key={open.n} field={open.field} onClose={() => setOpen(null)} />;
}

function KeyboardPanel({ field, onClose }: { field: Field; onClose: () => void }) {
  const [value, setValue] = useState(field.value);
  const [shift, setShift] = useState(false);
  const valueRef = useRef(value);
  const { family } = useGamepad();
  const side = useSettings((s) => s.gamepadConfirm);
  const label = field.getAttribute("aria-label") || field.placeholder || "Saisie";

  const write = (next: string) => {
    const max = field.maxLength > 0 ? field.maxLength : Infinity;
    if (next.length > max) return sound.play("error");
    valueRef.current = next;
    setValue(next);
    setFieldValue(field, next);
  };
  const type = (ch: string) => {
    sound.play("move");
    write(valueRef.current + (shift ? ch.toUpperCase() : ch));
    if (shift) setShift(false);
  };
  const erase = () => {
    sound.play("back");
    write(valueRef.current.slice(0, -1));
  };
  const close = () => {
    onClose();
    requestAnimationFrame(() => field.isConnected && field.focus({ preventScroll: true }));
  };
  const submit = () => {
    sound.play("select");
    onClose();
    requestAnimationFrame(() => {
      if (!field.isConnected) return;
      field.focus({ preventScroll: true });
      // comme la touche Entrée : envoi d'un message, lancement d'une recherche, formulaire
      const enter = new globalThis.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
      field.dispatchEvent(enter);
      if (!enter.defaultPrevented && field.form) field.form.requestSubmit();
    });
  };

  useEffect(() => {
    sound.play("open");
    const off = input.onBack(() => {
      close();
      return true;
    });
    const id = requestAnimationFrame(() => input.focusInitial());
    return () => {
      off();
      cancelAnimationFrame(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const synthetic = !e.nativeEvent.isTrusted; // bouton de manette traduit en touche
    const k = e.key;
    let handled = true;
    if (synthetic && k === "x") erase();
    else if (synthetic && k === "f") type(" ");
    else if (synthetic && (k === "q" || k === "e")) setShift((s) => !s);
    else if (k === "F1") submit();
    else if (!synthetic && k === "Backspace") erase();
    else if (!synthetic && k === "Enter" && !(e.target instanceof HTMLButtonElement)) submit();
    else if (!synthetic && k.length === 1 && k !== " ") {
      sound.play("move");
      write(valueRef.current + k);
    } else handled = false;
    if (handled) e.preventDefault();
  };

  const hints: [PadKey, string][] = [["confirm", "Écrire"], ["west", "Effacer"], ["north", "Espace"], ["lb", "Majuscules"], ["start", "Valider"], ["back", "Fermer"]];
  const keyClass = "ibox-focusable grid h-11 place-items-center rounded-xl bg-white text-[1.05rem] font-bold text-ink shadow-[0_2px_0_rgba(52,68,89,0.14)] [--ring-radius:0.75rem]";

  return createPortal(
    <motion.div
      data-nav-root
      role="dialog"
      aria-modal="true"
      aria-label={`Clavier : ${label}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-[70] flex items-end justify-center bg-[color-mix(in_oklab,var(--ibox-ink)_18%,transparent)] p-6"
      onPointerDown={(e) => e.target === e.currentTarget && close()}
      onKeyDown={onKeyDown}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
        className="w-[min(46rem,100%)] rounded-[1.6rem] bg-cream p-4 shadow-lg ring-1 ring-white/70"
      >
        <div className="mb-3 flex items-center gap-3 rounded-2xl bg-white px-4 py-3">
          <span className="shrink-0 text-[0.75rem] font-extrabold tracking-[0.12em] text-ink-soft uppercase">{label}</span>
          <span data-no-i18n className="min-w-0 flex-1 truncate text-right text-[1.15rem] font-semibold text-ink">
            {field instanceof HTMLInputElement && field.type === "password" ? "•".repeat(value.length) : value}
            <span className="ml-0.5 inline-block h-5 w-0.5 translate-y-0.5 animate-pulse bg-ink" />
          </span>
        </div>
        <div className="grid gap-1.5" data-nav-group="pad-keyboard">
          {ROWS.map((row, r) => (
            <div key={row} className="grid grid-cols-10 gap-1.5">
              {[...row].map((ch, i) => (
                <button key={ch} data-focusable data-no-i18n data-autofocus={(r === 1 && i === 0) || undefined} className={keyClass} onClick={() => type(ch)}>
                  {shift ? ch.toUpperCase() : ch}
                </button>
              ))}
            </div>
          ))}
          <div className="grid grid-cols-10 gap-1.5">
            <button data-focusable aria-pressed={shift} className={`${keyClass} col-span-2 text-[0.85rem] ${shift ? "!bg-ink !text-white" : ""}`} onClick={() => { sound.play("toggle"); setShift((s) => !s); }}>⇧ Maj</button>
            <button data-focusable className={`${keyClass} col-span-4 text-[0.85rem]`} onClick={() => type(" ")}>Espace</button>
            <button data-focusable className={`${keyClass} col-span-2 text-[0.85rem]`} onClick={erase}>⌫ Effacer</button>
            <button data-focusable className={`${keyClass} col-span-2 !bg-mint text-[0.85rem]`} onClick={submit}>✓ Valider</button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[0.78rem] font-bold text-ink-soft">
          {hints.map(([k, text]) => (
            <span key={k} className="flex items-center gap-1.5">
              <PadGlyph k={k} family={family} side={side} size={22} />
              {text}
            </span>
          ))}
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

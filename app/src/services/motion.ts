import { useSyncExternalStore } from "react";
import { useSettings } from "./settings";

const mq = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
const subscribe = (cb: () => void) => {
  mq?.addEventListener("change", cb);
  return () => mq?.removeEventListener("change", cb);
};

/** Animations réduites : réglage de l'app, sinon celui de Windows. */
export function useReducedMotion(): boolean {
  const pref = useSettings((s) => s.motion);
  const system = useSyncExternalStore(subscribe, () => mq?.matches ?? false);
  return pref === "reduced" || (pref === "system" && system);
}

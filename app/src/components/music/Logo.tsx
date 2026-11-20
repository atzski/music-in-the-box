import { motion } from "motion/react";
import logo from "../../../../logo.png";

/**
 * Logo Music in the Box : la boîte rouge ouverte avec le bouton de YouTube Music (image du
 * créateur, réduite à 128 px). Elle apparaît d'un rebond et bouge à peine pendant la lecture.
 */
export function Logo({ size = 36, playing, still }: { size?: number; playing?: boolean; still?: boolean }) {
  return (
    <motion.img
      src={logo}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
      initial={still ? false : { scale: 0.7, opacity: 0 }}
      animate={playing ? { scale: 1, opacity: 1, y: [0, -1.5, 0] } : { scale: 1, opacity: 1, y: 0 }}
      transition={playing ? { y: { duration: 1.8, repeat: Infinity, ease: "easeInOut" }, default: { type: "spring", stiffness: 420, damping: 22 } } : { type: "spring", stiffness: 420, damping: 22 }}
      className="flex-none select-none"
    />
  );
}

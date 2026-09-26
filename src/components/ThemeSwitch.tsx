import { Sun } from "lucide-react";
import { setTheme, useTheme } from "../theme";

export default function ThemeSwitch() {
  const light = useTheme() === "light";
  return (
    <button
      type="button"
      aria-pressed={light}
      onClick={() => setTheme(light ? "dark" : "light")}
      className="flex h-10 w-full items-center gap-2.5 rounded-[9px] px-3 text-left text-[14px] font-medium text-nav-text hover:bg-nav-active-bg/60"
    >
      <Sun size={18} strokeWidth={2} aria-hidden />
      <span className="flex-1">Light theme</span>
      <span
        aria-hidden
        className={`relative h-5 w-[34px] shrink-0 rounded-full ${light ? "bg-accent" : "bg-switch-off"}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-switch-knob ${light ? "translate-x-[14px]" : ""}`}
        />
      </span>
    </button>
  );
}

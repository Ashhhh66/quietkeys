import type { ReactNode } from "react";

export const FIELD_LABEL = "text-[13px] font-medium text-text-soft";

export const FIELD_INPUT =
  "h-12 w-full rounded-[12px] border border-panel-border bg-field px-3.5 text-[15px] text-text select-none aria-invalid:border-error-fg";

export const PRIMARY_BUTTON =
  "flex h-12 w-full items-center justify-center gap-2 rounded-[12px] bg-accent-gradient text-[15px] font-semibold text-on-accent hover:opacity-95 disabled:bg-disabled-bg disabled:bg-none disabled:text-disabled-fg disabled:opacity-100";

export const ALERT = "flex items-start gap-2.5 rounded-[10px] border px-3.5 py-3 text-[13.5px]";

/** Full-window page background with a centred card, shared by Unlock and Setup. */
export default function AuthCard({
  width,
  children,
}: {
  width: "narrow" | "wide";
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center overflow-y-auto p-6 text-text">
      <div
        className={`flex flex-col gap-[22px] rounded-[20px] border border-panel-border bg-panel px-9 py-10 ${
          width === "narrow" ? "w-[420px]" : "w-[440px]"
        }`}
      >
        {children}
      </div>
    </main>
  );
}

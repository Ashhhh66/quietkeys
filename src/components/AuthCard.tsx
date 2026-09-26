import type { ReactNode } from "react";

export const FIELD_LABEL = "text-[13px] font-medium text-text-soft";

export const FIELD_INPUT =
  "h-[46px] w-full rounded-[10px] border border-input-border bg-input-bg-field px-3.5 text-[15px] text-text select-none aria-invalid:border-error-fg";

export const PRIMARY_BUTTON =
  "flex h-[46px] w-full items-center justify-center gap-2 rounded-[10px] bg-accent text-[15px] font-semibold text-on-accent hover:bg-accent-hover disabled:bg-disabled-bg disabled:text-disabled-fg";

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
    <main className="flex min-h-screen items-center justify-center overflow-y-auto bg-page p-6 text-text">
      <div
        className={`flex flex-col gap-[22px] rounded-[18px] border border-card-border bg-card px-9 py-10 ${
          width === "narrow" ? "w-[400px]" : "w-[440px]"
        }`}
      >
        {children}
      </div>
    </main>
  );
}

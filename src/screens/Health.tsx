import { useState } from "react";
import { friendlyMessage, type HealthIssue, type HealthLogin, type VaultHealth } from "../api";
import Avatar from "../components/Avatar";

export default function HealthScreen({
  health,
  onGenerate,
  onOpen,
}: {
  health: VaultHealth;
  onGenerate: (id: string) => void;
  onOpen: (id: string) => Promise<void>;
}) {
  const [openError, setOpenError] = useState<string | null>(null);

  async function openLogin(id: string) {
    setOpenError(null);
    try {
      await onOpen(id);
    } catch (err) {
      setOpenError(friendlyMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-6 px-10 py-8">
      <div>
        <h2 className="text-[28px] font-semibold tracking-[-0.02em]">Health</h2>
        <p className="mt-1 text-[14.5px] text-text-soft">
          Checked on this computer. Nothing is sent anywhere.
        </p>
      </div>

      <div className="grid max-w-[860px] gap-3 sm:grid-cols-3">
        <Stat label="Strong" value={health.strong} tone="ok" />
        <Stat label="Weak" value={health.weak} tone="warn" />
        <Stat label="Reused" value={health.reused} tone="warn" />
      </div>

      <section className="flex max-w-[860px] flex-col gap-3">
        <h3 className="text-[12px] font-semibold tracking-[0.06em] text-label uppercase">
          Fix these first
        </h3>
        {health.issues.length === 0 ? (
          <p className="text-[14.5px] text-muted">Nothing to fix.</p>
        ) : (
          health.issues.map((issue) => (
            <IssueCard
              key={issueKey(issue)}
              issue={issue}
              onGenerate={onGenerate}
              onOpen={(id) => void openLogin(id)}
            />
          ))
        )}
        {openError && (
          <p role="alert" className="text-[13.5px] text-error-fg">
            {openError}
          </p>
        )}
      </section>

      <p className="max-w-[860px] rounded-[12px] bg-ok-bg px-4 py-3 text-[14px] text-ok-fg">
        Change the password on the website first, then update it here so this copy matches.
      </p>
    </div>
  );
}

/** Whether this login is weak, reused, or both, from the same report as the Health screen. */
export function loginFlags(health: VaultHealth, id: string): { weak: boolean; reused: boolean } {
  let weak = false;
  let reused = false;
  for (const issue of health.issues) {
    for (const entry of issue.entries) {
      if (entry.id !== id) continue;
      if (issue.kind === "reused") reused = true;
      if (issue.kind === "weak" || entry.weak) weak = true;
    }
  }
  return { weak, reused };
}

function issueKey(issue: HealthIssue): string {
  return `${issue.kind}:${issue.entries.map((entry) => entry.id).join(",")}`;
}

function IssueCard({
  issue,
  onGenerate,
  onOpen,
}: {
  issue: HealthIssue;
  onGenerate: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const reused = issue.kind === "reused";
  const count = issue.entries.length;
  return (
    <article className="flex flex-col gap-4 rounded-[16px] border border-panel-border bg-inset px-[18px] py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="warn">{reused ? "Reused" : "Weak"}</Pill>
        <p className="text-[14.5px] text-text-soft">
          {reused
            ? `This password is used by ${count} logins. Change it on each website, then update it here.`
            : "This password is easy to guess. Generate a new one, change it on the website, then update it here."}
        </p>
      </div>
      <ul className="flex flex-col gap-3">
        {issue.entries.map((entry) => (
          <li key={entry.id} className="flex flex-wrap items-center gap-3">
            <Avatar title={entry.title} url={entry.domain} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-[14.5px] font-semibold text-text">
                  {entry.title}
                </span>
                {reused && entry.weak && <Pill tone="warn">Weak</Pill>}
              </div>
              {entry.domain && <p className="truncate text-[13px] text-muted">{entry.domain}</p>}
            </div>
            <LoginActions entry={entry} onGenerate={onGenerate} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </article>
  );
}

function LoginActions({
  entry,
  onGenerate,
  onOpen,
}: {
  entry: HealthLogin;
  onGenerate: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => onGenerate(entry.id)}
        className="flex h-10 items-center rounded-[12px] bg-accent-gradient px-3 text-[13px] font-semibold text-on-accent hover:opacity-95"
      >
        Generate a new password
      </button>
      {entry.domain && (
        <button
          type="button"
          onClick={() => onOpen(entry.id)}
          className="flex h-10 items-center rounded-[12px] border border-panel-border bg-panel px-3 text-[13px] font-medium text-text hover:bg-nav-active-bg"
        >
          Open {entry.domain}
        </button>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "ok" | "warn" }) {
  const toneClass =
    tone === "ok"
      ? "border-ok-fg bg-ok-bg text-ok-fg"
      : "border-warn-border bg-warn-bg text-warn-fg";
  return (
    <div
      role="group"
      aria-label={`${value} ${label}`}
      className={`rounded-[16px] border px-4 py-4 ${toneClass}`}
    >
      <p className="text-[46px] leading-none font-semibold">{value}</p>
      <p className="mt-2 text-[13px] font-medium">{label}</p>
    </div>
  );
}

function Pill({ tone, children }: { tone: "ok" | "warn"; children: string }) {
  const toneClass = tone === "ok" ? "bg-ok-bg text-ok-fg" : "bg-warn-bg text-warn-fg";
  return (
    <span className={`rounded-full px-2.5 py-1 text-[12.5px] font-medium ${toneClass}`}>
      {children}
    </span>
  );
}

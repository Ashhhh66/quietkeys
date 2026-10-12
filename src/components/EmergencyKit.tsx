interface Props {
  path: string;
  onClose?: () => void;
}

/** A sheet the user can print. The master password is a blank line, never a value. */
export default function EmergencyKit({ path, onClose }: Props) {
  return (
    <section
      className="emergency-kit flex w-full max-w-[560px] flex-col gap-4 rounded-[20px] border border-panel-border bg-panel px-8 py-8 text-text"
      aria-labelledby="emergency-kit-title"
    >
      <div>
        <h2 id="emergency-kit-title" className="text-[24px] font-semibold tracking-[-0.02em]">
          Emergency Kit
        </h2>
        <p className="mt-2 text-[14.5px] text-text-soft">
          Write the master password on paper. quietkeys does not store it, and this sheet does not
          include it.
        </p>
      </div>
      <dl className="flex flex-col gap-3 text-[14.5px]">
        <div>
          <dt className="text-[12px] font-semibold tracking-[0.06em] text-label uppercase">
            Vault file
          </dt>
          <dd className="mt-1 font-mono text-[13px] break-all">{path}</dd>
        </div>
        <div>
          <dt className="text-[12px] font-semibold tracking-[0.06em] text-label uppercase">
            Previous save
          </dt>
          <dd className="mt-1 font-mono text-[13px]">vault.quietkeys.bak</dd>
        </div>
        <div>
          <dt className="text-[12px] font-semibold tracking-[0.06em] text-label uppercase">
            1.0 copy, if this vault was upgraded
          </dt>
          <dd className="mt-1 font-mono text-[13px]">vault.quietkeys.v1-backup</dd>
        </div>
        <div>
          <dt className="text-[12px] font-semibold tracking-[0.06em] text-label uppercase">
            Master password
          </dt>
          <dd className="mt-2 border-b border-text-soft pb-6" aria-label="Blank line">
            Write it by hand
          </dd>
        </div>
        <div>
          <dt className="text-[12px] font-semibold tracking-[0.06em] text-label uppercase">
            Recovery code
          </dt>
          <dd className="mt-2 border-b border-text-soft pb-6" aria-label="Blank recovery line">
            Write it by hand
          </dd>
        </div>
      </dl>
      <p className="text-[14px] text-text-soft">
        If you forget the master password, the recovery code is the only other way to open this
        vault. This sheet never includes either one.
      </p>
      <div className="no-print flex gap-2">
        <button
          type="button"
          onClick={() => window.print()}
          className="h-10 rounded-[12px] bg-accent-gradient px-4 text-[14px] font-semibold text-on-accent"
        >
          Print
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-[12px] border border-panel-border px-4 text-[14px] font-medium"
          >
            Close
          </button>
        )}
      </div>
    </section>
  );
}

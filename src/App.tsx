import { useEffect, useState, type ReactNode } from "react";
import { isUnlocked, onLocked, vaultExists } from "./api";
import { useIdleLock } from "./hooks/useIdleLock";
import Setup from "./screens/Setup";
import Unlock from "./screens/Unlock";
import VaultList from "./screens/VaultList";

type Screen = "loading" | "setup" | "unlock" | "vault";

function Centered({ children }: { children: ReactNode }) {
  return (
    <main className="flex h-screen items-center justify-center bg-page text-[14px] text-muted">
      {children}
    </main>
  );
}

function App() {
  const [screen, setScreen] = useState<Screen>("loading");

  // Registered once: any command, from any screen, that comes back locked switches the
  // whole app to the Unlock screen, rather than each screen handling it separately.
  useEffect(() => {
    onLocked(() => setScreen("unlock"));
  }, []);

  useIdleLock(screen === "vault", () => setScreen("unlock"));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const exists = await vaultExists();
      if (cancelled) return;
      if (!exists) {
        setScreen("setup");
        return;
      }
      const unlocked = await isUnlocked();
      if (!cancelled) setScreen(unlocked ? "vault" : "unlock");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  switch (screen) {
    case "loading":
      return <Centered>Loading…</Centered>;
    case "setup":
      return <Setup onCreated={() => setScreen("vault")} />;
    case "unlock":
      return <Unlock onUnlocked={() => setScreen("vault")} />;
    case "vault":
      return <VaultList onLocked={() => setScreen("unlock")} />;
  }
}

export default App;

export {};

declare global {
  const chrome: {
    runtime: {
      lastError?: { message?: string };
      connectNative(name: string): ChromePort;
      onMessage: {
        addListener(
          callback: (
            message: unknown,
            sender: unknown,
            sendResponse: (response: unknown) => void,
          ) => boolean | void,
        ): void;
      };
      sendMessage(message: unknown): Promise<unknown>;
    };
    storage: {
      local: {
        get(key: string): Promise<Record<string, unknown>>;
        set(items: Record<string, unknown>): Promise<void>;
        remove(key: string): Promise<void>;
      };
    };
    tabs: {
      query(query: {
        active: boolean;
        currentWindow: boolean;
      }): Promise<Array<{ id?: number; url?: string }>>;
      sendMessage(tabId: number, message: unknown): Promise<unknown>;
    };
  };
}

interface ChromePort {
  onMessage: { addListener(callback: (message: unknown) => void): void };
  onDisconnect: { addListener(callback: () => void): void };
  postMessage(message: unknown): void;
  disconnect(): void;
}

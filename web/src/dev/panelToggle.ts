export interface DevPanelHandle {
  destroy(): void;
}

interface DevPanelModule {
  open(): DevPanelHandle;
}

/** Create a D-key toggle that ignores presses while its lazily loaded panel is opening. */
export function createPanelToggle(
  enabled: boolean,
  load: () => Promise<DevPanelModule>,
  onError: (error: unknown) => void = () => {},
): () => Promise<void> {
  let panel: DevPanelHandle | null = null;
  let opening = false;

  return async () => {
    if (panel) {
      panel.destroy();
      panel = null;
      return;
    }
    if (!enabled || opening) return;

    opening = true;
    try {
      const module = await load();
      panel = module.open();
    } catch (error) {
      try {
        onError(error);
      } catch {
        // Error reporting must not turn a failed lazy import into an unhandled rejection.
      }
    } finally {
      opening = false;
    }
  };
}

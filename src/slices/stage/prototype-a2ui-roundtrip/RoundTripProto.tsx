// PROTOTYPE (#693), throwaway. Draws whatever surface an agent hands to `quay_surface_proto`
// as crudely as possible and sends the operator's click back. None of this is the build.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type Component = {
  id: string;
  component: string;
  text?: unknown;
  child?: string;
  action?: { event?: { name: string; context?: Record<string, unknown> } };
};

type Shown = {
  id: string;
  terminal_id: string;
  terminal_name: string;
  messages: Array<Record<string, { surfaceId?: string; components?: Component[] }>>;
  wait_seconds: number;
  at: number;
  call: string;
  settled?: string;
};

function componentsOf(surface: Shown): Component[] {
  return surface.messages.flatMap((message) =>
    Object.values(message).flatMap((body) => (body && typeof body === "object" && body.components) || []),
  );
}

function surfaceIdOf(surface: Shown): string {
  for (const message of surface.messages) {
    for (const body of Object.values(message)) {
      if (body && typeof body === "object" && body.surfaceId) return body.surfaceId;
    }
  }
  return surface.id;
}

export function RoundTripProto() {
  const [surfaces, setSurfaces] = useState<Shown[]>([]);
  const [, tick] = useState(0);

  useEffect(() => {
    const shown = listen<Omit<Shown, "at" | "call">>("a2ui-proto-surface", (event) => {
      setSurfaces((all) => [...all, { ...event.payload, at: Date.now(), call: "open, waiting" }]);
    });
    const updated = listen<{ id: string; call: string }>("a2ui-proto-update", (event) => {
      setSurfaces((all) => all.map((s) => (s.id === event.payload.id ? { ...s, call: event.payload.call } : s)));
    });
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => {
      void shown.then((off) => off());
      void updated.then((off) => off());
      clearInterval(timer);
    };
  }, []);

  const answer = async (surface: Shown, action: unknown, label: string) => {
    const how = await invoke<string>("a2ui_proto_answer", { id: surface.id, action: JSON.stringify(action) }).catch(
      (error) => `failed: ${String(error)}`,
    );
    setSurfaces((all) => all.map((s) => (s.id === surface.id ? { ...s, settled: `${label} → ${how}` } : s)));
  };

  if (surfaces.length === 0) return null;
  return (
    <div
      data-testid="a2ui-proto"
      style={{
        position: "fixed",
        right: 12,
        bottom: 12,
        zIndex: 99999,
        width: 380,
        maxHeight: "80vh",
        overflow: "auto",
        font: "13px system-ui",
        color: "#111",
      }}
    >
      {surfaces.map((surface) => {
        const all = componentsOf(surface);
        const byId = new Map(all.map((c) => [c.id, c]));
        const buttons = all.filter((c) => c.component === "Button");
        const labels = new Set(buttons.map((b) => b.child));
        const texts = all.filter((c) => c.component === "Text" && !labels.has(c.id));
        return (
          <div
            key={surface.id}
            data-testid={`a2ui-proto-${surface.id}`}
            style={{ background: "#fffbe6", border: "2px solid #c90", borderRadius: 6, padding: 10, marginTop: 8 }}
          >
            <div style={{ fontSize: 11, color: "#765" }}>
              PROTOTYPE · {surface.id} · from {surface.terminal_name || surface.terminal_id} · call {surface.call} ·{" "}
              {Math.round((Date.now() - surface.at) / 1000)}s of {surface.wait_seconds}s
            </div>
            {texts.map((t) => (
              <p key={t.id} style={{ margin: "6px 0" }}>
                {String(t.text)}
              </p>
            ))}
            {surface.settled ? (
              <div data-testid={`a2ui-proto-settled-${surface.id}`} style={{ fontWeight: 600 }}>
                Settled: {surface.settled}
              </div>
            ) : (
              <div style={{ display: "flex", gap: 6 }}>
                {buttons.map((b) => {
                  const label = String(byId.get(b.child ?? "")?.text ?? b.id);
                  return (
                    <button
                      key={b.id}
                      data-testid={`a2ui-proto-${surface.id}-${b.id}`}
                      style={{ padding: "4px 10px", border: "1px solid #444", borderRadius: 4, background: "#fff" }}
                      onClick={() =>
                        void answer(
                          surface,
                          {
                            version: "1.0",
                            action: {
                              name: b.action?.event?.name ?? "click",
                              surfaceId: surfaceIdOf(surface),
                              sourceComponentId: b.id,
                              timestamp: new Date().toISOString(),
                              context: b.action?.event?.context ?? {},
                            },
                          },
                          label,
                        )
                      }
                    >
                      {label}
                    </button>
                  );
                })}
                <button
                  data-testid={`a2ui-proto-${surface.id}-dismiss`}
                  style={{ padding: "4px 10px", border: "1px solid #999", borderRadius: 4, background: "#eee" }}
                  onClick={() => void answer(surface, { dismissed: true }, "Dismissed")}
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

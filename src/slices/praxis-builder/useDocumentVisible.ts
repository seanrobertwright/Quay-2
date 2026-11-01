// Whether Quay's window is shown. A view that polls the Praxis host stops while it isn't (#362).
import { useEffect, useState } from "react";

/** True while the window is shown, not minimized or in a background tab. */
export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
}

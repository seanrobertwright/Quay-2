// The page `modalBlocking.test.ts` drives (#421): Topos's real modal scope and `ConfirmDialog`,
// with stand-ins for the graph and the diff view that count their clicks, inside a positioned
// panel as in `ToposOverlay`, styled by Quay's own stylesheet.

import { useState } from "react";
import ReactDOM from "react-dom/client";
import { ConfirmDialog, type ConfirmRequest } from "../../ConfirmDialog";
import { ToposModalScope, useToposModal } from "../../ToposModal";
import "./page.css";

export interface ModalPageState {
  clicks: { graph: number; back: number };
  confirmed: number;
}

const state: ModalPageState = { clicks: { graph: 0, back: 0 }, confirmed: 0 };
(window as unknown as { __modalPage: ModalPageState }).__modalPage = state;

function App() {
  const modal = useToposModal();
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  return (
    <div className="relative flex flex-col items-start gap-2 p-4 w-[800px] h-[600px] bg-[#0d1117]">
    <ToposModalScope modal={modal}>
      <button type="button" onClick={() => state.clicks.graph++}>
        Graph row
      </button>
      <button type="button" onClick={() => state.clicks.back++}>
        Back
      </button>
      <button
        type="button"
        onClick={() =>
          setRequest({
            title: "Discard changes to a.txt?",
            detail: "Its unstaged changes are thrown away.",
            confirmLabel: "Discard file",
            destructive: true,
            onConfirm: () => state.confirmed++,
          })
        }
      >
        Discard
      </button>
      <ConfirmDialog request={request} onCancel={() => setRequest(null)} />
    </ToposModalScope>
    </div>
  );
}

const root = document.getElementById("root");
if (root === null) throw new Error("the page has no #root");
ReactDOM.createRoot(root).render(<App />);

// PROTOTYPE (#226) — throwaway. Entry for praxis-builder.prototype.html: three variants
// of the builder canvas and inspector on one page, switched with ?variant=A|B|C.
// Run: pnpm proto:praxis-builder. State is in memory only; nothing is saved.
import { StrictMode, useCallback, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "../../../index.css";
import { sampleGraph, validate, type PGraph } from "./model";
import { Shell } from "./Shell";
import { Switcher } from "./Switcher";
import { VariantA } from "./VariantA";
import { VariantB } from "./VariantB";
import { VariantC } from "./VariantC";

const VARIANTS = [
  { key: "A", name: "Cards, branch handles, docked inspector", Component: VariantA },
  { key: "B", name: "Pills, branch picker, floating inspector", Component: VariantB },
  { key: "C", name: "Left to right, branch on the edge, bottom sheet", Component: VariantC },
];

function Root() {
  const [graph, setGraph] = useState<PGraph>(sampleGraph);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resets, setResets] = useState(0);
  const [variant, setVariant] = useState(() => {
    const v = new URLSearchParams(window.location.search).get("variant");
    return VARIANTS.some((x) => x.key === v) ? v! : "A";
  });
  const changeVariant = (key: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("variant", key);
    window.history.replaceState(null, "", url);
    setVariant(key);
  };
  const edit = useCallback((f: (g: PGraph) => PGraph) => setGraph((g) => f(g)), []);
  const issues = useMemo(() => validate(graph), [graph]);
  const dirty = useMemo(() => JSON.stringify(graph) !== JSON.stringify(sampleGraph()), [graph]);
  const V = VARIANTS.find((x) => x.key === variant)!.Component;

  return (
    <>
      <Shell
        graph={graph}
        dirty={dirty}
        onReset={() => {
          setGraph(sampleGraph());
          setSelectedId(null);
          setResets((r) => r + 1);
        }}
      >
        <ReactFlowProvider key={`${variant}-${resets}`}>
          <V graph={graph} issues={issues} selectedId={selectedId} select={setSelectedId} edit={edit} />
        </ReactFlowProvider>
      </Shell>
      <Switcher variants={VARIANTS} current={variant} onChange={changeVariant} />
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

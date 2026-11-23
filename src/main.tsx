import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installContextMenuPolicy } from "./slices/overlay/contextMenuPolicy";
import "./index.css";
// PROTOTYPE (#687) — throwaway mount for the surface placement variants.
import { PlacementPrototype } from "./slices/stage/prototype-a2ui-placement/PlacementPrototype";

const isPrototype = import.meta.env.DEV && new URLSearchParams(location.search).get("prototype") === "a2ui-placement";

// Once, before the first render: no right-click anywhere shows WebView2's own menu.
installContextMenuPolicy(document, { dev: import.meta.env.DEV });

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isPrototype ? <PlacementPrototype /> : <App />}
  </React.StrictMode>,
);

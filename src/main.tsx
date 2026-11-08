import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installContextMenuPolicy } from "./slices/overlay/contextMenuPolicy";
import "./index.css";

// Once, before the first render: no right-click anywhere shows WebView2's own menu.
installContextMenuPolicy(document, { dev: import.meta.env.DEV });

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

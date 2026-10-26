import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
// PROTOTYPE (#285) — throwaway mount for the Open Project dialog variants.
import { OpenProjectPrototype } from "./slices/workspace/prototype-open-project/OpenProjectPrototype";

const isPrototype = import.meta.env.DEV && new URLSearchParams(location.search).get("prototype") === "open-project";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isPrototype ? <OpenProjectPrototype /> : <App />}
  </React.StrictMode>,
);

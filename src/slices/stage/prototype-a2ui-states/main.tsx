// PROTOTYPE (#702), throwaway.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { StatesPrototype } from "./StatesPrototype.tsx";
import "./proto.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <StatesPrototype />
  </StrictMode>,
);

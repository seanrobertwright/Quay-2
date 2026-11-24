// PROTOTYPE (#696), throwaway.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LookPrototype } from "./LookPrototype.tsx";
import "./proto.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <LookPrototype />
  </StrictMode>,
);

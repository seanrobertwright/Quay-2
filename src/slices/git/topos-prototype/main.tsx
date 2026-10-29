// PROTOTYPE (#351). Entry for the throwaway page; run with `pnpm proto:topos`.
import ReactDOM from "react-dom/client";
import { ToposPrototype } from "./ToposPrototype";
import "./topos-prototype.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<ToposPrototype />);

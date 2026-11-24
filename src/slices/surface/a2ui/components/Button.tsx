import { useRef, useState, type ReactNode } from "react";
import { createComponentImplementation } from "@a2ui/react";
import { ButtonApi } from "@a2ui/web_core/catalogs/basic/v1";
import { Button as PlainButton } from "../../../parts/Button.tsx";

interface ActionButtonProps {
  primary: boolean;
  /** Whether the component's checks all hold. */
  valid: boolean;
  /** Runs the action. What it returns settles once the action has been answered. */
  action: () => unknown;
  children: ReactNode;
}

const ActionButton = ({ primary, valid, action, children }: ActionButtonProps) => {
  const [busy, setBusy] = useState(false);
  // A second click can come before the button is drawn again.
  const running = useRef(false);
  const click = async () => {
    // The engine dispatches an action whose checks fail, so it is refused here.
    if (!valid || running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await action();
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return (
    <PlainButton variant={primary ? "primary" : "secondary"} disabled={!valid || busy} onClick={() => void click()}>
      {children}
    </PlainButton>
  );
};

/** A button, held while a check of it fails and while its last click is being answered. */
export const Button = createComponentImplementation(ButtonApi, ({ props, buildChild }) => (
  <ActionButton primary={props.variant === "primary"} valid={props.isValid !== false} action={props.action}>
    {props.child && buildChild(props.child)}
  </ActionButton>
));

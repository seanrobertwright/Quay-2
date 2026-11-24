import { useContext, useRef, useState, type ReactNode, type Ref } from "react";
import { createComponentImplementation } from "@a2ui/react";
import { ButtonApi } from "@a2ui/web_core/catalogs/basic/v1";
import type { ComponentContext } from "@a2ui/web_core/v1_0";
import { Button as PlainButton } from "../../../parts/Button.tsx";
import { duringClick } from "../../clickOnly.ts";
import { LinksContext } from "../../links.ts";
import { webTarget } from "../../linkTarget.ts";
import { cause, effectCallOf, type EffectCall } from "../effects.ts";
import { AloneInButton, InsideButton } from "../insideButton.ts";
import { textOf } from "../textOf.ts";
import { useArguments } from "../useArguments.ts";
import { usePointed } from "../usePointed.ts";

const VARIANTS = { default: "secondary", primary: "primary", borderless: "borderless" } as const;

interface LookProps {
  variant: (typeof VARIANTS)[keyof typeof VARIANTS];
  /** Whether the component's checks all hold. */
  valid: boolean;
  buttonRef: Ref<HTMLButtonElement> | undefined;
  children: ReactNode;
}

interface ActionButtonProps extends LookProps {
  /** Runs the action. What it returns settles once the action has been answered. */
  action: () => unknown;
}

/** A button that sends its surface's agent something. */
const ActionButton = ({ variant, valid, action, buttonRef, children }: ActionButtonProps) => {
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
    <PlainButton ref={buttonRef} variant={variant} disabled={!valid || busy} onClick={() => void click()}>
      {children}
    </PlainButton>
  );
};

interface EffectButtonProps extends LookProps {
  call: EffectCall;
  context: ComponentContext;
}

/** A button that causes something in Quay, of the arguments it was drawn with: what it opens is what the frame's foot said. */
const EffectButton = ({ variant, valid, call: { effect, args: written }, context, buttonRef, children }: EffectButtonProps) => {
  const links = useContext(LinksContext);
  const args = useArguments(context.dataContext, written);
  const address = effect === "openUrl" ? (webTarget(textOf(args.url))?.address ?? null) : null;
  const pointed = usePointed(links, address);
  const click = () => {
    if (valid && links) duringClick(effect, () => cause(effect, args, links.effects));
  };
  return (
    <PlainButton ref={buttonRef} variant={variant} disabled={!valid} onClick={click} {...pointed}>
      {children}
    </PlainButton>
  );
};

/** What kind of component `id` is, as the surface has it. */
const typeOf = ({ surfaceComponents }: ComponentContext, id: unknown) => (typeof id === "string" ? surfaceComponents.get(id)?.type : undefined);

/** A button, held while a check of it fails and while its last click is being answered. */
export const Button = createComponentImplementation(ButtonApi, ({ props, buildChild, context, accessibilityRef }) => {
  const { action, child } = context.componentModel.properties;
  const call = effectCallOf(action);
  const look = { variant: VARIANTS[props.variant ?? "default"], valid: props.isValid !== false, buttonRef: accessibilityRef };
  const label = (
    <InsideButton.Provider value={true}>
      <AloneInButton.Provider value={typeOf(context, child) === "Icon"}>{props.child && buildChild(props.child)}</AloneInButton.Provider>
    </InsideButton.Provider>
  );
  return call ? (
    <EffectButton {...look} call={call} context={context}>
      {label}
    </EffectButton>
  ) : (
    <ActionButton {...look} action={props.action}>
      {label}
    </ActionButton>
  );
});

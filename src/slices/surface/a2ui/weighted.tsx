// The `weight` every kept component takes: how much of its Row's or Column's room is its own.
import type { ComponentProps } from "react";
import { useSignalValue, type ReactComponentImplementation } from "@a2ui/react";
import { Share } from "../../parts/Share.tsx";

type View = NonNullable<ReactComponentImplementation["view"]>;

/** `implementation`, drawn in the share of the room that its `weight` gives it. */
export function weighted(implementation: ReactComponentImplementation): ReactComponentImplementation {
  const { view: Own } = implementation;
  if (!Own) throw new Error(`The component ${implementation.name} has no view.`);
  const Weighted = (props: ComponentProps<View>) => {
    const { weight } = useSignalValue(props.node.props);
    if (typeof weight !== "number") return <Own {...props} />;
    return (
      <Share weight={weight}>
        <Own {...props} />
      </Share>
    );
  };
  return { ...implementation, view: Weighted };
}

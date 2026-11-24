import { Fold } from "./Fold.tsx";

/** An A2UI `action` message, as the store hands it back. */
interface Sent {
  action: { name: string; context: Record<string, unknown> };
}

const written = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));

/** An answered raw surface: the action the operator took, and what it sent. */
export const RawSettled = ({ answer }: { answer: unknown }) => {
  const { name, context } = (answer as Sent).action;
  return (
    <Fold>
      <p className="wrap-anywhere text-white">{name}</p>
      <dl className="flex min-w-0 flex-col gap-1 wrap-anywhere">
        {Object.entries(context).map(([key, value]) => (
          <div key={key}>
            <dt className="text-[11px] text-[#8b949e]">{key}</dt>
            <dd className="whitespace-pre-wrap text-white">{written(value)}</dd>
          </div>
        ))}
      </dl>
    </Fold>
  );
};

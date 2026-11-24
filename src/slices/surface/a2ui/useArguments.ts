import { useMemo, useSyncExternalStore } from "react";
import type { DataContext } from "@a2ui/web_core/v1_0";
import { isObject, type JsonObject } from "../json.ts";

const NONE: JsonObject = {};

/** What a call's written `args` are evaluated to in `dataContext`, outside any click, so that no effect written in one can run. */
export function useArguments(dataContext: DataContext, args: unknown): JsonObject {
  const store = useMemo(() => {
    let now = NONE;
    const subscribe = (changed: () => void) => {
      const bound = Object.entries(isObject(args) ? args : NONE).map(([name, value]) => {
        const subscription = dataContext.subscribeDynamicValue<unknown>(value as never, () => refresh());
        return { name, subscription };
      });
      const refresh = () => {
        now = Object.fromEntries(bound.map(({ name, subscription }) => [name, subscription.value]));
        changed();
      };
      refresh();
      return () => bound.forEach(({ subscription }) => subscription.unsubscribe());
    };
    return { subscribe, get: () => now };
  }, [dataContext, args]);
  return useSyncExternalStore(store.subscribe, store.get);
}

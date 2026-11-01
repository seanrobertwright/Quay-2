// The newest host condition known for the builder's project (#448). It comes two ways: a read of
// `praxis_host_condition`, answered later, and the `praxis-host-condition` event. Each read gets
// a request id, and its answer is kept only when nothing newer arrived after it was asked: no
// later read, no change event and no project switch.
import { normalizePath } from "../../utils/paths.ts";
import type { HostCondition, HostConditionChange } from "./praxisHost.ts";

export interface LatestCondition {
  /** Follows `projectPath`, starting from "not checked yet". */
  project(projectPath: string | null): void;
  /** Starts a read, returning its request id. */
  beginRead(): number;
  /** Keeps read `id`'s answer when it is still the newest; true when kept. */
  readDone(id: number, condition: HostCondition): boolean;
  /** Keeps a change event's condition when it is for this project; true when kept. */
  changed(change: HostConditionChange): boolean;
  current(): HostCondition;
}

const NOT_CHECKED: HostCondition = { state: "notCheckedYet" };

export function createLatestCondition(): LatestCondition {
  let key = "";
  let condition = NOT_CHECKED;
  // Bumped by every read, event and switch, so a read's answer knows whether it is the newest.
  let newest = 0;
  return {
    project(projectPath) {
      key = normalizePath(projectPath);
      condition = NOT_CHECKED;
      newest += 1;
    },
    beginRead() {
      newest += 1;
      return newest;
    },
    readDone(id, next) {
      if (id !== newest || key === "") return false;
      condition = next;
      return true;
    },
    changed(change) {
      if (key === "" || normalizePath(change.projectPath) !== key) return false;
      newest += 1;
      condition = change.condition;
      return true;
    },
    current: () => condition,
  };
}

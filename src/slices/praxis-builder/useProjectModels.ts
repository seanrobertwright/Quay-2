// One model per project for the builder's session, as the host catalog (#449), the graph host
// model (#461) and the trigger host model (#475) each keep: made on first ask, kept in memory while the builder is mounted, and
// disposed, with its calls and timers, on unmount.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizePath } from "../../utils/paths.ts";

export interface ProjectModels<M> {
  /** `projectPath`'s model; null without a project, and before the first mount. */
  model: M | null;
  /** The model already made for `path`, if any; it never makes one. */
  existing(path: string): M | undefined;
}

/**
 * `projectPath`'s model, made by `create`. `create` must be the same function on every render,
 * such as one defined at module level.
 */
export function useProjectModels<M extends { dispose(): void }>(
  projectPath: string | null,
  create: (projectPath: string) => M,
): ProjectModels<M> {
  const models = useRef(new Map<string, M>());

  // Counts mounts, so a remount (as StrictMode does) makes fresh models after the cleanup
  // disposed the old ones. No model exists before the first mount.
  const [mounts, setMounts] = useState(0);
  useEffect(() => {
    setMounts((n) => n + 1);
    const all = models.current;
    return () => {
      for (const m of all.values()) m.dispose();
      all.clear();
    };
  }, []);

  const model = useMemo(() => {
    if (mounts === 0 || !projectPath) return null;
    const key = normalizePath(projectPath);
    let made = models.current.get(key);
    if (!made) {
      made = create(projectPath);
      models.current.set(key, made);
    }
    return made;
  }, [mounts, projectPath, create]);

  const existing = useCallback((path: string) => models.current.get(normalizePath(path)), []);

  return { model, existing };
}

// Each project's host catalog (#449) for the builder's session: one `HostCatalog` per project,
// kept in memory while the builder is mounted and disposed, with its calls and timer, on unmount.
// It feeds the catalog the project's listed templates and host condition, and tells it when the
// Workflow templates group is shown. The views that draw host states read them from here.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizePath } from "../../utils/paths.ts";
import { createHostCatalog, type HostCatalog, type LocalTemplate } from "./hostCatalog.ts";
import type { HostCondition } from "./praxisHost.ts";
import type { DefinitionEntry } from "./types.ts";

export interface HostCatalogState {
  /** The shown project's catalog; null without a project. */
  catalog: HostCatalog | null;
  /** Bumped on every change to the shown catalog, so views that read it draw again. */
  version: number;
  /** Tells `projectPath`'s catalog that template `name` was saved with `digest`. */
  saved(projectPath: string, name: string, digest: string | null): void;
}

/**
 * `projectPath`'s host catalog. `templates` is the project's listed workflow templates, or
 * undefined until they are listed; `groupShown` says the Workflow templates group is on screen.
 */
export function useHostCatalog(
  projectPath: string | null,
  templates: readonly DefinitionEntry[] | undefined,
  condition: HostCondition,
  groupShown: boolean,
): HostCatalogState {
  const catalogs = useRef(new Map<string, HostCatalog>());
  const [version, setVersion] = useState(0);

  const catalogFor = useCallback((path: string) => {
    const key = normalizePath(path);
    let catalog = catalogs.current.get(key);
    if (!catalog) {
      catalog = createHostCatalog({ projectPath: path });
      catalogs.current.set(key, catalog);
    }
    return catalog;
  }, []);

  // Counts mounts, so a remount (as StrictMode does) makes fresh catalogs after the cleanup
  // disposed the old ones. No catalog exists before the first mount.
  const [mounts, setMounts] = useState(0);
  useEffect(() => {
    setMounts((n) => n + 1);
    const all = catalogs.current;
    return () => {
      for (const c of all.values()) c.dispose();
      all.clear();
    };
  }, []);

  const catalog = useMemo(
    () => (mounts > 0 && projectPath ? catalogFor(projectPath) : null),
    [mounts, projectPath, catalogFor],
  );

  useEffect(() => catalog?.subscribe(() => setVersion((v) => v + 1)), [catalog]);

  useEffect(() => {
    if (!catalog || !templates) return;
    const local: LocalTemplate[] = templates.map((t) => ({
      name: t.id,
      digest: t.templateDigest ?? null,
      nameProblem: t.nameProblem ?? null,
    }));
    catalog.setLocal(local);
  }, [catalog, templates]);

  useEffect(() => {
    catalog?.setCondition(condition);
  }, [catalog, condition]);

  // The first read waits for the listing, so the shows cover the project's own templates.
  const listed = templates !== undefined;
  useEffect(() => {
    if (catalog && groupShown && listed) void catalog.groupShown();
  }, [catalog, groupShown, listed]);

  const saved = useCallback(
    // A project with no catalog yet has no reading for the save to invalidate.
    (path: string, name: string, digest: string | null) => void catalogs.current.get(normalizePath(path))?.saved(name, digest),
    [],
  );

  return { catalog, version, saved };
}

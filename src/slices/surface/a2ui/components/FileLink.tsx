import { useContext, type Ref } from "react";
import { z } from "zod";
import { createComponentImplementation } from "@a2ui/react";
import { DynamicStringSchema, type ComponentContext } from "@a2ui/web_core/v1_0";
import { duringClick } from "../../clickOnly.ts";
import { LinksContext } from "../../links.ts";
import { InsideButton } from "../insideButton.ts";
import { FILE_FIELDS, namedFile } from "../namedFile.ts";
import { textOf } from "../textOf.ts";
import { useUntyped } from "../untyped.ts";
import { FileLabel, PointedLink } from "./PointedLink.tsx";

/** Quay's own component: a link to a file. */
const FileLinkApi = {
  name: "FileLink",
  schema: z
    .object({
      ...FILE_FIELDS,
      label: DynamicStringSchema.describe("REF:#/$defs/DynamicString|What the link reads. The path when left out.").optional(),
    })
    .strict(),
};

interface FileLinkViewProps {
  path: string;
  line: number | undefined;
  label: string | undefined;
  linkRef: Ref<HTMLButtonElement> | undefined;
  context: ComponentContext;
}

const FileLinkView = ({ path, line, label, linkRef, context }: FileLinkViewProps) => {
  const links = useContext(LinksContext);
  const insideButton = useContext(InsideButton);
  const untyped = useUntyped(context);
  const address = line === undefined ? path : `${path}:${line}`;
  if (!links || insideButton || path === "") return label ?? address;
  const untypedPath = () => {
    const its = untyped({ path: context.componentModel.properties.path });
    return its && namedFile(its).path;
  };
  return (
    <PointedLink ref={linkRef} links={links} address={address} onClick={() => duringClick("showFile", () => links.effects.showFile(path, line), untypedPath)}>
      <FileLabel>{label ?? address}</FileLabel>
    </PointedLink>
  );
};

/** A link that shows a file at the operator's click. The path is judged then. */
export const FileLink = createComponentImplementation(FileLinkApi, ({ props, context, accessibilityRef }) => (
  <FileLinkView {...namedFile(props)} label={textOf(props.label) || undefined} linkRef={accessibilityRef} context={context} />
));

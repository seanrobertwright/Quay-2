import { useContext, useEffect, useState, type Ref } from "react";
import { shownAddress, type ImageTarget } from "../../imageTarget.ts";
import { ImagesContext, READING, type ImageReading } from "../../surfaceImages.ts";

interface RefusedImageProps {
  name: string;
  why: string;
  address: string;
}

/** What stands for an image that is not shown: what it is called, why, and where it would be. */
const RefusedImage = ({ name, why, address }: RefusedImageProps) => (
  <span data-image-refused className="inline-flex max-w-full min-w-0 flex-col rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-[11px] wrap-anywhere text-[#8b949e]">
    {name !== "" && <bdi className="text-[#c9d1d9]">{name}</bdi>}
    <span>{why}</span>
    {address !== "" && (
      <bdi dir="ltr" className="font-mono">
        {shownAddress(address)}
      </bdi>
    )}
  </span>
);

/** How the reading of `path` stands. */
function useReading(path: string): ImageReading {
  const images = useContext(ImagesContext);
  const [told, setTold] = useState<{ path: string; reading: ImageReading } | null>(null);
  useEffect(() => images.open(path, (reading) => setTold({ path, reading })), [images, path]);
  return told?.path === path ? told.reading : READING;
}

interface LocalImageProps {
  target: ImageTarget;
  /** Where the image is, as its agent wrote it. */
  address: string;
  /** What it is called; empty for an image that only decorates. */
  name: string;
  className: string;
  ref?: Ref<HTMLImageElement>;
}

const ReadImage = ({ path, address, name, className, ref }: Omit<LocalImageProps, "target"> & { path: string }) => {
  const reading = useReading(path);
  // The URL whose bytes the webview could not draw
  const [bad, setBad] = useState<string | null>(null);
  if (reading.state === "reading") return <span className="text-[11px] text-[#8b949e]">Reading the image{name === "" ? "" : `: ${name}`}</span>;
  if (reading.state === "refused") return <RefusedImage name={name} why={reading.why} address={address} />;
  if (reading.url === bad) return <RefusedImage name={name} why="It could not be drawn." address={address} />;
  return <img ref={ref} src={reading.url} alt={name} draggable={false} onError={() => setBad(reading.url)} className={className} />;
};

/** An image file on this computer, or a box that says why there is none. */
export const LocalImage = ({ target, ...image }: LocalImageProps) =>
  "path" in target ? <ReadImage path={target.path} {...image} /> : <RefusedImage why={target.why} name={image.name} address={image.address} />;

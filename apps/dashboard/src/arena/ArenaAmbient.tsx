import { useEffect, useState } from "react";

/** A locally rendered HyperFrames light layer. The interface stays native React. */
export function ArenaAmbient() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce), (max-width: 620px)");
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    const update = () => setEnabled(!media.matches && !connection?.saveData);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return enabled ? <video className="arena-ambient" src="/assets/arena-light-loop.mp4" aria-hidden="true" tabIndex={-1} muted autoPlay loop playsInline disablePictureInPicture preload="metadata" /> : null;
}

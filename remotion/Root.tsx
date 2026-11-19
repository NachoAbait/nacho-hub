import { Composition } from "remotion";
import { ReelComposition, type ReelCompositionProps } from "./ReelComposition";

export const REEL_FPS = 30;
export const REEL_WIDTH = 1080;
export const REEL_HEIGHT = 1920;
export const REEL_COMPOSITION_ID = "Reel";

const DEFAULT_PROPS: ReelCompositionProps = {
  videoSrc: "",
  videoDurationInSeconds: 15,
  overlayImageUrl: null,
  overlayLabel: null,
  overlayDurationInSeconds: 6,
  captions: [], // TODO(whisper): fase 2
};

/**
 * Único composition root del pipeline de Video Editor. `calculateMetadata` es lo que le permite a
 * una composición durar lo mismo que el clip real de Nacho en vez de un número fijo: render.ts mide
 * la duración del video descargado (getVideoMetadata) y la pasa como `videoDurationInSeconds` en
 * inputProps; acá se la convierte a frames.
 */
export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id={REEL_COMPOSITION_ID}
      component={ReelComposition}
      width={REEL_WIDTH}
      height={REEL_HEIGHT}
      fps={REEL_FPS}
      durationInFrames={REEL_FPS * DEFAULT_PROPS.videoDurationInSeconds}
      defaultProps={DEFAULT_PROPS}
      calculateMetadata={async ({ props }) => ({
        durationInFrames: Math.max(1, Math.round(props.videoDurationInSeconds * REEL_FPS)),
      })}
    />
  );
};

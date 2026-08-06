import { Game } from "./game";
import { Track } from "./track";
import { TRACKS } from "./tracks";

function boot(): void {
  const canvas = document.getElementById("game") as HTMLCanvasElement | null;
  if (!canvas) throw new Error("canvas #game missing");
  // Layout must settle before the renderer measures the canvas.
  requestAnimationFrame(() => {
    const game = new Game(canvas);
    (window as unknown as Record<string, unknown>).__drawrace = game;
    (window as unknown as Record<string, unknown>).__TRACKS = TRACKS;
    (window as unknown as Record<string, unknown>).__Track = Track;
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

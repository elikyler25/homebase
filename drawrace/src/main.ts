import { Game } from "./game";

function boot(): void {
  const canvas = document.getElementById("game") as HTMLCanvasElement | null;
  if (!canvas) throw new Error("canvas #game missing");
  // Layout must settle before the renderer measures the canvas.
  requestAnimationFrame(() => {
    const game = new Game(canvas);
    (window as unknown as Record<string, unknown>).__drawrace = game;
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

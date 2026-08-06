import { SlotGame } from "./slotgame";

const canvas = document.getElementById("stage") as HTMLCanvasElement | null;
if (canvas) {
  const game = new SlotGame(canvas);
  // Harnesses reach in here rather than driving the DOM for state they cannot
  // see, the same way the drawn-line build exposes its own internals.
  (window as unknown as Record<string, unknown>).__slot = game;
}

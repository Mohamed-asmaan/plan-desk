import { useEffect, useRef } from "react";
import { plantStage } from "./model.js";

/* The pixel plant in the sidebar. It grows with overall progress, hops when
   a focus session is saved, and throws a few pixels when it changes. */
const POT = [
  [3, 13, 10, 2, "#e4c4a4"],
  [4, 12, 8, 1, "#c48962"],
  [4, 11, 8, 1, "#8d6844"]
];
const PLANT_PIXELS = [
  POT.concat([[7, 10, 2, 1, "#6d8f72"]]),
  POT.concat([[7, 7, 2, 4, "#5e8a68"], [6, 8, 1, 1, "#8fb89a"], [9, 8, 1, 1, "#7aa88a"]]),
  POT.concat([[7, 5, 2, 6, "#5e8a68"], [4, 6, 3, 2, "#8fb89a"], [9, 6, 3, 2, "#7aa88a"]]),
  POT.concat([[7, 3, 2, 8, "#5e8a68"], [3, 5, 4, 2, "#8fb89a"], [9, 5, 4, 2, "#7aa88a"], [4, 8, 3, 1, "#a3c9ae"], [9, 8, 3, 1, "#8fb89a"]]),
  POT.concat([[7, 4, 2, 7, "#5e8a68"], [3, 6, 4, 2, "#8fb89a"], [9, 6, 4, 2, "#7aa88a"], [5, 2, 2, 2, "#f0c2be"], [9, 2, 2, 2, "#e7b4b0"], [7, 3, 2, 1, "#f3dd8a"]]),
  POT.concat([[7, 5, 2, 6, "#5e8a68"], [3, 7, 4, 2, "#8fb89a"], [9, 7, 4, 2, "#7aa88a"], [4, 9, 3, 1, "#a3c9ae"], [9, 9, 3, 1, "#8fb89a"], [4, 2, 2, 2, "#f0c2be"], [6, 1, 4, 2, "#f6d0cb"], [10, 2, 2, 2, "#e7b4b0"], [7, 2, 2, 1, "#f3dd8a"]])
];

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function sparkleAt(node) {
  if (!node || reducedMotion()) return;
  const rect = node.getBoundingClientRect();
  const colors = ["#6e8b78", "#e7b4b0", "#e7d7a1", "#8fb9a8", "#c4963a"];
  for (let i = 0; i < 5; i++) {
    const bit = document.createElement("i");
    bit.className = "px";
    bit.style.left = rect.left + rect.width / 2 + "px";
    bit.style.top = rect.top + rect.height / 2 + "px";
    bit.style.background = colors[i];
    const ang = -Math.PI / 2 + (i - 2) * 0.55;
    const dist = 12 + (i % 3) * 4;
    bit.style.setProperty("--dx", Math.cos(ang) * dist + "px");
    bit.style.setProperty("--dy", Math.sin(ang) * dist - 4 + "px");
    document.body.append(bit);
    bit.addEventListener("animationend", () => bit.remove());
  }
}

function replay(node, cls) {
  if (!node || reducedMotion()) return;
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
  sparkleAt(node);
}

export default function Plant({ state }) {
  const ref = useRef(null);
  const stage = plantStage(state);
  const shown = useRef(stage);

  useEffect(() => {
    if (stage > shown.current) replay(ref.current, "grew");
    shown.current = stage;
  }, [stage]);

  useEffect(() => {
    const hop = () => replay(ref.current, "hop");
    window.addEventListener("focus-saved", hop);
    return () => window.removeEventListener("focus-saved", hop);
  }, []);

  return (
    <div className="plant" aria-hidden="true" ref={ref}>
      <svg viewBox="0 0 16 16" shapeRendering="crispEdges">
        {(PLANT_PIXELS[stage] || PLANT_PIXELS[0]).map(([x, y, w, h, fill], i) => (
          <rect key={i} x={x} y={y} width={w} height={h} fill={fill} />
        ))}
      </svg>
    </div>
  );
}

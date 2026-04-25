import { useMemo } from "react";
import { motion } from "framer-motion";

interface Node {
  label: string;
  children: Node[];
}

/* Parse the AI mind-map text:
   ● Topic
     ○ Branch
       - point
       - point
*/
const parseMindMap = (text: string): Node => {
  const lines = text.split("\n").filter((l) => l.trim());
  const root: Node = { label: "موضوع", children: [] };
  let currentBranch: Node | null = null;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (/^[●•]/.test(line.trim())) {
      root.label = line.replace(/^[●•]\s*/, "").trim();
    } else if (/^[○◦]/.test(line.trim()) || /^\s+[○◦]/.test(line)) {
      currentBranch = { label: line.replace(/^[\s○◦]+/, "").trim(), children: [] };
      root.children.push(currentBranch);
    } else if (/^[-–—*]/.test(line.trim()) || /^\s+[-–—*]/.test(line)) {
      const leaf = { label: line.replace(/^[\s\-–—*]+/, "").trim(), children: [] };
      if (currentBranch) currentBranch.children.push(leaf);
      else root.children.push(leaf);
    }
  }
  // Fallback: split lines into branches
  if (root.children.length === 0) {
    root.children = lines.slice(1, 6).map((l) => ({
      label: l.replace(/^[\s\-–—*●○◦]+/, "").trim(),
      children: [],
    }));
  }
  return root;
};

interface Props {
  text: string;
}

export const MindMap = ({ text }: Props) => {
  const tree = useMemo(() => parseMindMap(text), [text]);

  const branches = tree.children;
  const W = 720;
  const H = Math.max(360, branches.length * 110 + 60);
  const cx = W / 2;
  const cy = H / 2;

  // Position branches in a circle
  const positions = branches.map((_, i) => {
    const angle = (i / branches.length) * Math.PI * 2 - Math.PI / 2;
    const r = Math.min(W, H) * 0.32;
    return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r, angle };
  });

  return (
    <div className="my-2 -mx-1">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto rounded-2xl bg-gradient-to-br from-accent/5 via-transparent to-primary/5 border border-glass-border"
        style={{ maxHeight: "60vh" }}
      >
        <defs>
          <radialGradient id="mm-root" cx="50%" cy="50%">
            <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity="1" />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.85" />
          </radialGradient>
          <linearGradient id="mm-branch" x1="0" x2="1">
            <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity="0.85" />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.7" />
          </linearGradient>
        </defs>

        {/* Connections root → branch */}
        {positions.map((p, i) => (
          <motion.path
            key={`l-${i}`}
            d={`M ${cx} ${cy} Q ${(cx + p.x) / 2} ${(cy + p.y) / 2 + 20}, ${p.x} ${p.y}`}
            stroke="url(#mm-branch)"
            strokeWidth={2.5}
            fill="none"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 0.7 }}
            transition={{ duration: 0.7, delay: 0.15 + i * 0.08 }}
          />
        ))}

        {/* Leaf connections */}
        {branches.map((b, i) =>
          b.children.slice(0, 4).map((leaf, j) => {
            const p = positions[i];
            const leafCount = Math.min(b.children.length, 4);
            const spread = (j - (leafCount - 1) / 2) * 38;
            const lx = p.x + Math.cos(p.angle) * 95;
            const ly = p.y + Math.sin(p.angle) * 65 + spread;
            return (
              <g key={`leaf-${i}-${j}`}>
                <motion.line
                  x1={p.x}
                  y1={p.y}
                  x2={lx}
                  y2={ly}
                  stroke="hsl(var(--accent))"
                  strokeOpacity={0.4}
                  strokeWidth={1.5}
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.5, delay: 0.6 + i * 0.1 + j * 0.05 }}
                />
                <motion.g
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.4, delay: 0.7 + i * 0.1 + j * 0.05 }}
                >
                  <rect
                    x={lx - 60}
                    y={ly - 13}
                    width={120}
                    height={26}
                    rx={13}
                    fill="hsl(var(--background))"
                    stroke="hsl(var(--accent) / 0.4)"
                    strokeWidth={1}
                  />
                  <text
                    x={lx}
                    y={ly + 4}
                    textAnchor="middle"
                    className="fill-foreground"
                    style={{ fontSize: 11 }}
                  >
                    {leaf.label.length > 22 ? leaf.label.slice(0, 21) + "…" : leaf.label}
                  </text>
                </motion.g>
              </g>
            );
          }),
        )}

        {/* Branch nodes */}
        {branches.map((b, i) => {
          const p = positions[i];
          return (
            <motion.g
              key={`b-${i}`}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.3 + i * 0.1, ease: [0.22, 1, 0.36, 1] }}
            >
              <rect
                x={p.x - 75}
                y={p.y - 18}
                width={150}
                height={36}
                rx={18}
                fill="url(#mm-branch)"
                style={{ filter: "drop-shadow(0 4px 12px hsl(var(--accent) / 0.25))" }}
              />
              <text
                x={p.x}
                y={p.y + 5}
                textAnchor="middle"
                className="fill-primary-foreground font-semibold"
                style={{ fontSize: 13 }}
              >
                {b.label.length > 24 ? b.label.slice(0, 23) + "…" : b.label}
              </text>
            </motion.g>
          );
        })}

        {/* Root */}
        <motion.g
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <circle
            cx={cx}
            cy={cy}
            r={56}
            fill="url(#mm-root)"
            style={{ filter: "drop-shadow(0 6px 24px hsl(var(--primary) / 0.4))" }}
          />
          <foreignObject x={cx - 50} y={cy - 26} width={100} height={52}>
            <div
              style={{
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "hsl(var(--primary-foreground))",
                fontSize: 12,
                fontWeight: 700,
                textAlign: "center",
                lineHeight: 1.2,
                padding: "0 4px",
              }}
            >
              {tree.label.length > 36 ? tree.label.slice(0, 35) + "…" : tree.label}
            </div>
          </foreignObject>
        </motion.g>
      </svg>
    </div>
  );
};

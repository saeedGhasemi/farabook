import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BookmarkPlus, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";

interface MNode {
  label: string;
  children: MNode[];
}

const parseMindMap = (text: string): MNode => {
  const lines = text.split("\n").filter((l) => l.trim());
  const root: MNode = { label: "موضوع", children: [] };
  let currentBranch: MNode | null = null;

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
  onSaveNode?: (label: string, note: string) => void;
}

interface Selected {
  label: string;
  context: string; // children, sibling description
}

export const MindMap = ({ text, onSaveNode }: Props) => {
  const { lang } = useI18n();
  const tree = useMemo(() => parseMindMap(text), [text]);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [draft, setDraft] = useState("");

  const branches = tree.children;
  const W = 720;
  const H = Math.max(360, branches.length * 110 + 60);
  const cx = W / 2;
  const cy = H / 2;

  const positions = branches.map((_, i) => {
    const angle = (i / branches.length) * Math.PI * 2 - Math.PI / 2;
    const r = Math.min(W, H) * 0.32;
    return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r, angle };
  });

  const pickNode = (label: string, context: string, defaultNote = "") => {
    setSelected({ label, context });
    setDraft(defaultNote || `${label}\n${context}`.trim());
  };

  return (
    <div className="my-2 -mx-1 space-y-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto rounded-2xl bg-gradient-to-br from-accent/5 via-transparent to-primary/5 border border-glass-border"
        style={{ maxHeight: "55vh" }}
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

        {branches.map((b, i) =>
          b.children.slice(0, 4).map((leaf, j) => {
            const p = positions[i];
            const leafCount = Math.min(b.children.length, 4);
            const spread = (j - (leafCount - 1) / 2) * 38;
            const lx = p.x + Math.cos(p.angle) * 95;
            const ly = p.y + Math.sin(p.angle) * 65 + spread;
            const isSel = selected?.label === leaf.label;
            return (
              <g key={`leaf-${i}-${j}`}>
                <motion.line
                  x1={p.x} y1={p.y} x2={lx} y2={ly}
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
                  onClick={() => pickNode(leaf.label, `↳ ${b.label}`)}
                  style={{ cursor: "pointer" }}
                >
                  <rect
                    x={lx - 60} y={ly - 13} width={120} height={26} rx={13}
                    fill={isSel ? "hsl(var(--accent) / 0.25)" : "hsl(var(--background))"}
                    stroke={isSel ? "hsl(var(--accent))" : "hsl(var(--accent) / 0.4)"}
                    strokeWidth={isSel ? 2 : 1}
                  />
                  <text x={lx} y={ly + 4} textAnchor="middle" className="fill-foreground" style={{ fontSize: 11, pointerEvents: "none" }}>
                    {leaf.label.length > 22 ? leaf.label.slice(0, 21) + "…" : leaf.label}
                  </text>
                </motion.g>
              </g>
            );
          }),
        )}

        {branches.map((b, i) => {
          const p = positions[i];
          const isSel = selected?.label === b.label;
          const ctx = b.children.map((c) => `• ${c.label}`).join("\n");
          return (
            <motion.g
              key={`b-${i}`}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.3 + i * 0.1, ease: [0.22, 1, 0.36, 1] }}
              onClick={() => pickNode(b.label, ctx)}
              style={{ cursor: "pointer" }}
            >
              <rect
                x={p.x - 75} y={p.y - 18} width={150} height={36} rx={18}
                fill="url(#mm-branch)"
                stroke={isSel ? "hsl(var(--primary-foreground))" : "transparent"}
                strokeWidth={isSel ? 2 : 0}
                style={{ filter: "drop-shadow(0 4px 12px hsl(var(--accent) / 0.25))" }}
              />
              <text x={p.x} y={p.y + 5} textAnchor="middle" className="fill-primary-foreground font-semibold" style={{ fontSize: 13, pointerEvents: "none" }}>
                {b.label.length > 24 ? b.label.slice(0, 23) + "…" : b.label}
              </text>
            </motion.g>
          );
        })}

        <motion.g
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          onClick={() => pickNode(tree.label, branches.map((b) => `• ${b.label}`).join("\n"))}
          style={{ cursor: "pointer" }}
        >
          <circle cx={cx} cy={cy} r={56} fill="url(#mm-root)" style={{ filter: "drop-shadow(0 6px 24px hsl(var(--primary) / 0.4))" }} />
          <foreignObject x={cx - 50} y={cy - 26} width={100} height={52}>
            <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "hsl(var(--primary-foreground))", fontSize: 12, fontWeight: 700, textAlign: "center", lineHeight: 1.2, padding: "0 4px", pointerEvents: "none" }}>
              {tree.label.length > 36 ? tree.label.slice(0, 35) + "…" : tree.label}
            </div>
          </foreignObject>
        </motion.g>
      </svg>

      <p className="text-[11px] text-muted-foreground text-center">
        {lang === "fa" ? "روی هر گره کلیک کنید تا یادداشت بگذارید" : "Click any node to add a note"}
      </p>

      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="rounded-2xl border border-accent/30 bg-background/60 p-3 space-y-2"
          >
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-accent truncate">{selected.label}</h4>
              <button
                onClick={() => setSelected(null)}
                className="w-7 h-7 rounded-full hover:bg-foreground/10 flex items-center justify-center text-muted-foreground"
                aria-label="close"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={4}
              className="w-full text-sm p-2.5 rounded-xl bg-background/70 border border-border/60 focus:outline-none focus:border-accent/60 resize-none leading-relaxed"
              placeholder={lang === "fa" ? "یادداشت برای این گره..." : "Note for this node..."}
            />
            <button
              onClick={() => {
                if (!draft.trim() || !onSaveNode) return;
                onSaveNode(selected.label, draft.trim());
                setSelected(null);
              }}
              disabled={!draft.trim() || !onSaveNode}
              className="w-full py-2 rounded-xl bg-gradient-warm text-primary-foreground text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <BookmarkPlus className="w-4 h-4" />
              {lang === "fa" ? "ذخیره به نشان‌ها" : "Save to notes"}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

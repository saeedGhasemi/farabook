// Full-screen cover page rendered inside the Reader.
// Shows the front or back cover with a 3D page-flip animation when the
// reader transitions between cover and content.
import { motion } from "framer-motion";
import { CoverImage, type CoverCrop } from "./CoverImage";
import { useI18n } from "@/lib/i18n";

interface Props {
  side: "front" | "back";
  title: string;
  author?: string;
  coverUrl?: string | null;
  backCoverUrl?: string | null;
  spreadUrl?: string | null;
  crop?: CoverCrop;
  focus?: { x?: number; y?: number } | null;
  backFocus?: { x?: number; y?: number } | null;
}

export function CoverPage(props: Props) {
  const { side, title, author } = props;
  const { lang } = useI18n();
  const fa = lang === "fa";
  const isFront = side === "front";

  return (
    <div className="relative mx-auto" style={{ perspective: "1800px" }}>
      <motion.div
        key={side}
        initial={{
          rotateY: isFront ? -85 : 85,
          opacity: 0,
          scale: 0.92,
        }}
        animate={{ rotateY: 0, opacity: 1, scale: 1 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        style={{
          transformStyle: "preserve-3d",
          transformOrigin: isFront ? "left center" : "right center",
        }}
        className="relative mx-auto rounded-3xl overflow-hidden book-shadow border border-foreground/10 bg-card"
      >
        {/* Cover image area — fixed book-like aspect 2:3 */}
        <div className="relative w-[min(86vw,460px)] aspect-[2/3]">
          <CoverImage {...props} width={920} />

          {/* Gold spine accent (front: left edge, back: right edge in LTR; mirrored in RTL via translate) */}
          <div
            className={`absolute top-0 bottom-0 w-2 ${isFront ? "left-0" : "right-0"} bg-gradient-to-b from-accent/40 via-accent/15 to-accent/40 pointer-events-none`}
          />

          {/* Subtle inner shadow to give depth */}
          <div className="absolute inset-0 pointer-events-none shadow-[inset_0_0_60px_rgba(0,0,0,0.25)]" />

          {/* Optional label overlay for back cover */}
          {!isFront && (
            <div className="absolute inset-x-0 bottom-0 p-5 bg-gradient-to-t from-black/70 via-black/30 to-transparent text-white">
              <div className="text-[11px] uppercase tracking-[0.25em] opacity-80 mb-1">
                {fa ? "پایان کتاب" : "The End"}
              </div>
              <div className="font-display text-lg truncate" title={title}>
                {title}
              </div>
              {author && (
                <div className="text-xs opacity-80 truncate">{author}</div>
              )}
            </div>
          )}
        </div>
      </motion.div>

      {/* Hint text under the cover */}
      <div className="text-center text-xs text-muted-foreground mt-6 select-none">
        {isFront
          ? (fa ? "برای ورود به کتاب، کلید بعدی را بزنید →" : "Press next to open the book →")
          : (fa ? "کتاب به پایان رسید — کلید قبلی برای بازگشت" : "End of book — press previous to go back")}
      </div>
    </div>
  );
}

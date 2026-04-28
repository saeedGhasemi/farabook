import { motion } from "framer-motion";

interface Props {
  /** "grid" = vertical card (Store), "row" = horizontal card (Library) */
  variant?: "grid" | "row";
  index?: number;
}

/**
 * Glass / shimmer placeholder for book cards.
 * Matches the paper-card silhouette used in Store + Library so the
 * page feels stable while data is loading in.
 */
export const BookCardSkeleton = ({ variant = "grid", index = 0 }: Props) => {
  const delay = Math.min(index * 0.04, 0.3);

  if (variant === "row") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay, duration: 0.4 }}
        className="paper-card rounded-2xl overflow-hidden flex relative"
        aria-hidden="true"
      >
        <div className="w-32 flex-shrink-0 aspect-[3/4] shimmer-block" />
        <div className="p-4 flex-1 flex flex-col gap-3 justify-between">
          <div className="space-y-2">
            <div className="h-4 w-3/4 rounded shimmer-block" />
            <div className="h-3 w-1/2 rounded shimmer-block" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-5 w-16 rounded-full shimmer-block" />
            <div className="h-3 w-12 rounded shimmer-block ms-auto" />
          </div>
          <div className="h-1.5 w-full rounded-full shimmer-block" />
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.45 }}
      className="paper-card rounded-2xl overflow-hidden flex flex-col relative"
      aria-hidden="true"
    >
      <div className="aspect-[3/4] shimmer-block" />
      <div className="p-5 flex flex-col gap-3">
        <div className="h-5 w-4/5 rounded shimmer-block" />
        <div className="h-3 w-1/3 rounded shimmer-block" />
        <div className="space-y-2 pt-1">
          <div className="h-3 w-full rounded shimmer-block" />
          <div className="h-3 w-5/6 rounded shimmer-block" />
        </div>
        <div className="flex items-center justify-between pt-3">
          <div className="h-4 w-20 rounded shimmer-block" />
          <div className="h-9 w-24 rounded-lg shimmer-block" />
        </div>
      </div>
    </motion.div>
  );
};

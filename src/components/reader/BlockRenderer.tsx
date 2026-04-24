import { motion } from "framer-motion";
import { Info, Sparkles, Quote as QuoteIcon } from "lucide-react";
import tehranImg from "@/assets/scene-tehran.jpg";
import princeImg from "@/assets/scene-prince.jpg";
import desertImg from "@/assets/scene-desert.jpg";
import farmImg from "@/assets/scene-farm.jpg";
import heroImg from "@/assets/hero-book.jpg";

const imageMap: Record<string, string> = {
  tehran: tehranImg,
  prince: princeImg,
  desert: desertImg,
  farm: farmImg,
  hero: heroImg,
};

const resolveImg = (src: string) => imageMap[src] || src;

export type Block =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "quote"; text: string; author?: string }
  | { type: "highlight"; text: string }
  | { type: "image"; src: string; caption?: string }
  | { type: "gallery"; images: string[]; caption?: string }
  | { type: "video"; src: string; poster?: string; caption?: string }
  | { type: "callout"; icon?: "info" | "sparkle"; text: string };

interface Props {
  block: Block;
  fontSize: number;
  index: number;
}

export const BlockRenderer = ({ block, fontSize, index }: Props) => {
  const delay = Math.min(index * 0.05, 0.3);
  const fade = {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] as const },
  };

  switch (block.type) {
    case "heading":
      return (
        <motion.h3 {...fade} className="text-2xl md:text-3xl font-display font-bold gold-text mt-2 mb-4">
          {block.text}
        </motion.h3>
      );

    case "paragraph":
      return (
        <motion.p
          {...fade}
          className="text-foreground/90 leading-loose whitespace-pre-line text-balance"
          style={{ fontSize: `${fontSize}px`, lineHeight: 1.95 }}
        >
          {block.text}
        </motion.p>
      );

    case "quote":
      return (
        <motion.figure {...fade} className="my-6 relative pl-6 rtl:pl-0 rtl:pr-6">
          <div className="absolute top-0 start-0 w-1 h-full bg-gradient-warm rounded-full" />
          <QuoteIcon className="w-6 h-6 text-accent mb-2 opacity-70" />
          <blockquote
            className="font-display italic text-foreground/95 leading-relaxed text-balance"
            style={{ fontSize: `${fontSize + 2}px` }}
          >
            "{block.text}"
          </blockquote>
          {block.author && (
            <figcaption className="mt-2 text-sm text-muted-foreground">— {block.author}</figcaption>
          )}
        </motion.figure>
      );

    case "highlight":
      return (
        <motion.div {...fade} className="my-5 p-4 rounded-xl bg-gradient-to-r from-accent/20 via-accent/10 to-transparent border-s-4 border-accent">
          <p className="font-display font-semibold text-foreground" style={{ fontSize: `${fontSize + 1}px` }}>
            ✨ {block.text}
          </p>
        </motion.div>
      );

    case "image":
      return (
        <motion.figure {...fade} className="my-6 group">
          <div className="relative overflow-hidden rounded-2xl book-shadow">
            <img
              src={resolveImg(block.src)}
              alt={block.caption || ""}
              loading="lazy"
              width={1280}
              height={768}
              className="w-full h-auto transition-transform duration-700 group-hover:scale-[1.03]"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-foreground/30 via-transparent to-transparent pointer-events-none" />
          </div>
          {block.caption && (
            <figcaption className="mt-2 text-sm text-muted-foreground italic text-center">
              {block.caption}
            </figcaption>
          )}
        </motion.figure>
      );

    case "gallery":
      return (
        <motion.figure {...fade} className="my-6">
          <div className="grid grid-cols-2 gap-3">
            {block.images.map((img, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4, delay: delay + i * 0.1 }}
                whileHover={{ scale: 1.02, y: -2 }}
                className="overflow-hidden rounded-xl book-shadow"
              >
                <img
                  src={resolveImg(img)}
                  alt=""
                  loading="lazy"
                  width={640}
                  height={384}
                  className="w-full h-48 object-cover"
                />
              </motion.div>
            ))}
          </div>
          {block.caption && (
            <figcaption className="mt-2 text-sm text-muted-foreground italic text-center">
              {block.caption}
            </figcaption>
          )}
        </motion.figure>
      );

    case "video":
      return (
        <motion.figure {...fade} className="my-6">
          <div className="relative overflow-hidden rounded-2xl book-shadow bg-foreground/5">
            <video
              src={block.src}
              poster={block.poster ? resolveImg(block.poster) : undefined}
              controls
              preload="metadata"
              className="w-full h-auto"
            />
          </div>
          {block.caption && (
            <figcaption className="mt-2 text-sm text-muted-foreground italic text-center">
              {block.caption}
            </figcaption>
          )}
        </motion.figure>
      );

    case "callout": {
      const Icon = block.icon === "sparkle" ? Sparkles : Info;
      return (
        <motion.aside
          {...fade}
          className="my-6 flex gap-3 p-4 rounded-xl glass border border-accent/30"
        >
          <Icon className="w-5 h-5 text-accent shrink-0 mt-0.5" />
          <p className="text-sm text-foreground/85 leading-relaxed">{block.text}</p>
        </motion.aside>
      );
    }

    default:
      return null;
  }
};

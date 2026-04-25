import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, X, RotateCw, Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";

interface Parsed {
  question: string;
  options: string[];
  correct: number; // 0-indexed
  explanation: string;
}

const toIntDigit = (s: string): number | null => {
  const map: Record<string, number> = { "۱": 1, "۲": 2, "۳": 3, "۴": 4 };
  const ch = s.trim()[0];
  if (map[ch]) return map[ch] - 1;
  const n = parseInt(ch, 10);
  if (!isNaN(n) && n >= 1 && n <= 4) return n - 1;
  return null;
};

const parseQuiz = (raw: string): Parsed | null => {
  if (!raw) return null;
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  let question = "";
  const options: string[] = [];
  let correct = 0;
  let explanation = "";
  for (const line of lines) {
    if (/^(سوال|پرسش|question)[\s::]/i.test(line)) {
      question = line.replace(/^[^::]+[::]/, "").trim();
    } else if (/^[۱۲۳۴1-4][)\.\-\s]/.test(line)) {
      options.push(line.replace(/^[۱۲۳۴1-4][)\.\-\s]+/, "").trim());
    } else if (/^(پاسخ|correct)/i.test(line)) {
      const m = line.match(/[۱۲۳۴1-4]/);
      if (m) {
        const idx = toIntDigit(m[0]);
        if (idx !== null) correct = idx;
      }
    } else if (/^(توضیح|explanation)/i.test(line)) {
      explanation = line.replace(/^[^::]+[::]/, "").trim();
    } else if (explanation) {
      explanation += " " + line;
    } else if (!question) {
      question = line;
    }
  }
  if (!question || options.length < 2) return null;
  return { question, options, correct, explanation };
};

interface Props {
  content: string;
  loading: boolean;
  onNext: () => void;
}

export const QuizCard = ({ content, loading, onNext }: Props) => {
  const { lang } = useI18n();
  const parsed = useMemo(() => parseQuiz(content), [content]);
  const [selected, setSelected] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);

  // Reset when content changes
  useMemo(() => { setSelected(null); setRevealed(false); }, [content]);

  if (loading) {
    return (
      <div className="py-12 flex flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="w-7 h-7 animate-spin text-accent" />
        <p className="text-sm">{lang === "fa" ? "در حال ساخت سوال..." : "Generating question..."}</p>
      </div>
    );
  }

  if (!parsed) {
    return (
      <p className="text-sm text-muted-foreground py-6 whitespace-pre-line">
        {content || (lang === "fa" ? "سوالی ساخته نشد." : "No question generated.")}
      </p>
    );
  }

  const choose = (i: number) => {
    if (revealed) return;
    setSelected(i);
    setRevealed(true);
  };

  const isCorrect = selected === parsed.correct;

  return (
    <div className="space-y-4">
      <p className="text-foreground font-medium leading-relaxed text-[15px]">
        {parsed.question}
      </p>

      <div className="space-y-2">
        {parsed.options.map((opt, i) => {
          const isSel = selected === i;
          const isRight = revealed && i === parsed.correct;
          const isWrongPick = revealed && isSel && !isCorrect;
          return (
            <motion.button
              key={i}
              whileTap={{ scale: 0.98 }}
              onClick={() => choose(i)}
              disabled={revealed}
              className={`w-full text-start p-3 rounded-xl border transition-all flex items-center gap-3 ${
                isRight
                  ? "bg-emerald-500/15 border-emerald-500/50 text-foreground"
                  : isWrongPick
                  ? "bg-destructive/15 border-destructive/50 text-foreground"
                  : isSel
                  ? "bg-accent/15 border-accent/50"
                  : "bg-background/40 border-border/40 hover:border-accent/40 hover:bg-accent/5"
              }`}
            >
              <span
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                  isRight
                    ? "bg-emerald-500 text-white"
                    : isWrongPick
                    ? "bg-destructive text-destructive-foreground"
                    : "bg-foreground/10"
                }`}
              >
                {isRight ? <Check className="w-3.5 h-3.5" /> : isWrongPick ? <X className="w-3.5 h-3.5" /> : i + 1}
              </span>
              <span className="text-sm leading-relaxed">{opt}</span>
            </motion.button>
          );
        })}
      </div>

      <AnimatePresence>
        {revealed && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={`p-3 rounded-xl text-sm leading-relaxed ${
              isCorrect
                ? "bg-emerald-500/10 border border-emerald-500/30"
                : "bg-destructive/10 border border-destructive/30"
            }`}
          >
            <p className="font-semibold mb-1">
              {isCorrect
                ? lang === "fa" ? "✓ آفرین! درست بود." : "✓ Correct!"
                : lang === "fa" ? "پاسخ درست:" : "Correct answer:"}
              {!isCorrect && (
                <span className="ms-1 font-normal">
                  {parsed.options[parsed.correct]}
                </span>
              )}
            </p>
            {parsed.explanation && (
              <p className="text-foreground/80">{parsed.explanation}</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {revealed && (
        <button
          onClick={onNext}
          className="w-full py-2.5 rounded-xl bg-gradient-warm text-primary-foreground text-sm font-semibold flex items-center justify-center gap-2 hover:shadow-glow transition-shadow"
        >
          <RotateCw className="w-4 h-4" />
          {lang === "fa" ? "سوال بعدی" : "Next question"}
        </button>
      )}
    </div>
  );
};

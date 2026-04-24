import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Highlighter, Trash2, X, BookmarkCheck, StickyNote, Check } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export interface HighlightItem {
  id: string;
  text: string;
  page_index: number;
  color?: string;
  created_at?: string;
  note?: string | null;
}

interface Props {
  open: boolean;
  highlights: HighlightItem[];
  onClose: () => void;
  onJump: (pageIndex: number) => void;
  onDelete: (id: string) => void;
  onUpdateNote?: (id: string, note: string) => void;
}

export const HighlightsPanel = ({
  open, highlights, onClose, onJump, onDelete, onUpdateNote,
}: Props) => {
  const { lang, dir } = useI18n();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const startEdit = (h: HighlightItem) => {
    setEditingId(h.id);
    setDraft(h.note ?? "");
  };
  const submitEdit = () => {
    if (editingId && onUpdateNote) onUpdateNote(editingId, draft.trim());
    setEditingId(null);
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-foreground/30 backdrop-blur-md z-40"
          />
          <motion.aside
            initial={{ x: dir === "rtl" ? -440 : 440, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: dir === "rtl" ? -440 : 440, opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className={`fixed top-0 bottom-0 ${
              dir === "rtl" ? "left-0" : "right-0"
            } z-50 w-full sm:w-[440px] glass-strong shadow-book border-s border-glass-border flex flex-col`}
          >
            <header className="flex items-center justify-between p-5 border-b border-border/40">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-warm flex items-center justify-center text-primary-foreground shadow-glow">
                  <Highlighter className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-display font-bold">
                    {lang === "fa" ? "هایلایت‌ها و یادداشت‌ها" : "Highlights & Notes"}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {highlights.length} {lang === "fa" ? "مورد ذخیره شده" : "saved"}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-9 h-9 rounded-full hover:bg-foreground/10 flex items-center justify-center"
                aria-label="close"
              >
                <X className="w-4 h-4" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3">
              {highlights.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground py-16 gap-3">
                  <BookmarkCheck className="w-10 h-10 opacity-40" />
                  <p className="text-sm max-w-[260px]">
                    {lang === "fa"
                      ? "هنوز هایلایتی ذخیره نکرده‌اید. متن دلخواه را در صفحه انتخاب کنید تا اینجا ظاهر شود."
                      : "No highlights yet. Select text on a page to save it here."}
                  </p>
                </div>
              ) : (
                highlights.map((h) => (
                  <motion.article
                    key={h.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="group p-4 rounded-2xl glass border border-glass-border hover:border-accent/50 hover:shadow-paper transition-all"
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className="mt-1.5 w-1 self-stretch rounded-full"
                        style={{ background: `hsl(var(--hl-${h.color || "yellow"}))` }}
                      />
                      <div className="flex-1 min-w-0">
                        <button
                          onClick={() => {
                            onJump(h.page_index);
                            onClose();
                          }}
                          className="text-start w-full"
                        >
                          <p
                            className="text-sm leading-relaxed text-foreground/90 line-clamp-4 px-1 py-0.5 rounded inline"
                            style={{
                              background: `hsl(var(--hl-${h.color || "yellow"}) / 0.45)`,
                              boxDecorationBreak: "clone",
                              WebkitBoxDecorationBreak: "clone",
                            }}
                          >
                            {h.text}
                          </p>
                          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                            <span>
                              {lang === "fa" ? "صفحهٔ" : "Page"} {h.page_index + 1}
                            </span>
                            {h.created_at && (
                              <>
                                <span>·</span>
                                <span>
                                  {new Date(h.created_at).toLocaleDateString(
                                    lang === "fa" ? "fa-IR" : "en-US",
                                    { month: "short", day: "numeric" }
                                  )}
                                </span>
                              </>
                            )}
                          </div>
                        </button>

                        {/* Note section */}
                        {editingId === h.id ? (
                          <div className="mt-3">
                            <textarea
                              autoFocus
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              rows={3}
                              placeholder={lang === "fa" ? "یادداشت خود را بنویسید…" : "Write a note…"}
                              className="w-full text-sm p-2.5 rounded-xl bg-background/60 border border-border/60 focus:outline-none focus:border-accent/60 resize-none"
                            />
                            <div className="flex justify-end gap-2 mt-2">
                              <button
                                onClick={() => setEditingId(null)}
                                className="text-xs px-3 py-1.5 rounded-lg hover:bg-foreground/10"
                              >
                                {lang === "fa" ? "انصراف" : "Cancel"}
                              </button>
                              <button
                                onClick={submitEdit}
                                className="text-xs px-3 py-1.5 rounded-lg bg-gradient-warm text-primary-foreground flex items-center gap-1.5"
                              >
                                <Check className="w-3 h-3" />
                                {lang === "fa" ? "ذخیره" : "Save"}
                              </button>
                            </div>
                          </div>
                        ) : h.note ? (
                          <button
                            onClick={() => startEdit(h)}
                            className="mt-3 w-full text-start text-xs p-2.5 rounded-xl bg-accent/10 border border-accent/20 text-foreground/85 hover:bg-accent/15 transition-colors flex gap-2"
                          >
                            <StickyNote className="w-3.5 h-3.5 mt-0.5 text-accent shrink-0" />
                            <span className="leading-relaxed whitespace-pre-line">{h.note}</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => startEdit(h)}
                            className="mt-3 text-xs px-2.5 py-1.5 rounded-lg text-accent hover:bg-accent/10 flex items-center gap-1.5"
                          >
                            <StickyNote className="w-3 h-3" />
                            {lang === "fa" ? "افزودن یادداشت" : "Add note"}
                          </button>
                        )}
                      </div>
                      <button
                        onClick={() => onDelete(h.id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity w-8 h-8 rounded-lg hover:bg-destructive/10 hover:text-destructive flex items-center justify-center text-muted-foreground"
                        aria-label="delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </motion.article>
                ))
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
};

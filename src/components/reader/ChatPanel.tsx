import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, MessageSquare, Send, Loader2, Sparkles, BookOpen } from "lucide-react";
import { useI18n } from "@/lib/i18n";

interface Msg { role: "user" | "assistant"; content: string }

interface Props {
  open: boolean;
  bookId: string;
  bookTitle?: string;
  onClose: () => void;
}

const STORAGE_KEY = (id: string) => `book-chat:${id}`;

export const ChatPanel = ({ open, bookId, bookTitle, onClose }: Props) => {
  const { lang } = useI18n();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Hydrate per-book messages
  useEffect(() => {
    if (!bookId) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY(bookId));
      if (raw) setMessages(JSON.parse(raw));
    } catch { /* ignore */ }
  }, [bookId]);

  useEffect(() => {
    if (!bookId) return;
    try { localStorage.setItem(STORAGE_KEY(bookId), JSON.stringify(messages.slice(-30))); } catch { /* ignore */ }
  }, [messages, bookId]);

  // Auto-scroll
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 200);
  }, [open]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const userMsg: Msg = { role: "user", content: text };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let assistantSoFar = "";
    const upsert = (chunk: string) => {
      assistantSoFar += chunk;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: assistantSoFar } : m));
        }
        return [...prev, { role: "assistant", content: assistantSoFar }];
      });
    };

    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/book-chat`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ bookId, messages: next, lang }),
        signal: controller.signal,
      });

      if (resp.status === 429) {
        upsert(lang === "fa" ? "⚠️ محدودیت درخواست. لطفاً کمی بعد دوباره تلاش کنید." : "⚠️ Rate limit. Please wait and try again.");
        return;
      }
      if (resp.status === 402) {
        upsert(lang === "fa" ? "⚠️ اعتبار هوش مصنوعی تمام شده است." : "⚠️ AI credits exhausted.");
        return;
      }
      if (!resp.ok || !resp.body) {
        upsert(lang === "fa" ? "خطا در ارتباط با هوش مصنوعی." : "AI request failed.");
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";
      let streamDone = false;

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });

        let nl: number;
        while ((nl = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, nl);
          textBuffer = textBuffer.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") { streamDone = true; break; }
          try {
            const parsed = JSON.parse(json);
            const delta = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (delta) upsert(delta);
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        upsert(lang === "fa" ? "خطا در ارتباط." : "Connection error.");
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const stop = () => { abortRef.current?.abort(); setLoading(false); };

  const clear = () => {
    setMessages([]);
    try { localStorage.removeItem(STORAGE_KEY(bookId)); } catch { /* ignore */ }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const examples = lang === "fa"
    ? ["خلاصهٔ کلی این کتاب چیست؟", "مهم‌ترین نکات کتاب را فهرست کن", "این کتاب در صفحهٔ ۲ دربارهٔ چیست؟"]
    : ["What is this book about?", "List the key points", "Summarize page 2"];

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 backdrop-blur-md z-40"
          />
          <motion.aside
            initial={{ x: 440, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 440, opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="fixed top-0 bottom-0 right-0 z-50 w-full sm:w-[440px] max-w-full glass-strong shadow-book border-l border-glass-border flex flex-col"
          >
            <header className="flex items-center justify-between p-5 border-b border-border/40">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-gradient-warm flex items-center justify-center text-primary-foreground shadow-glow shrink-0">
                  <MessageSquare className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-display font-bold truncate">
                    {lang === "fa" ? "گفتگو با کتاب" : "Chat with book"}
                  </h3>
                  {bookTitle && (
                    <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                      <BookOpen className="w-3 h-3" />
                      {bookTitle}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                {messages.length > 0 && (
                  <button
                    onClick={clear}
                    className="text-xs px-2 py-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
                    title={lang === "fa" ? "پاک کردن گفتگو" : "Clear"}
                  >
                    {lang === "fa" ? "پاک کن" : "Clear"}
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="w-9 h-9 rounded-full hover:bg-foreground/10 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </header>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3">
              {messages.length === 0 && !loading && (
                <div className="text-center py-8 space-y-4">
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-warm/20 text-accent">
                    <Sparkles className="w-6 h-6" />
                  </div>
                  <p className="text-sm text-muted-foreground max-w-[280px] mx-auto">
                    {lang === "fa"
                      ? "هر سؤالی دربارهٔ این کتاب بپرسید — فقط بر اساس متن خود کتاب پاسخ می‌دهم."
                      : "Ask anything about this book — I answer only from its text."}
                  </p>
                  <div className="flex flex-col gap-2 max-w-[300px] mx-auto">
                    {examples.map((q) => (
                      <button
                        key={q}
                        onClick={() => setInput(q)}
                        className="text-start text-xs px-3 py-2 rounded-xl glass border border-glass-border hover:border-accent/50 transition-colors"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                      m.role === "user"
                        ? "bg-gradient-warm text-primary-foreground rounded-br-md"
                        : "glass border border-glass-border text-foreground/90 rounded-bl-md"
                    }`}
                  >
                    {m.content || (loading && i === messages.length - 1 ? "…" : "")}
                  </div>
                </motion.div>
              ))}

              {loading && messages[messages.length - 1]?.role === "user" && (
                <div className="flex justify-start">
                  <div className="glass border border-glass-border rounded-2xl rounded-bl-md px-3.5 py-2.5 flex items-center gap-2 text-muted-foreground text-sm">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    {lang === "fa" ? "در حال خواندن کتاب…" : "Reading the book…"}
                  </div>
                </div>
              )}
            </div>

            {/* Composer */}
            <footer className="p-3 border-t border-border/40 bg-background/30">
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKey}
                  placeholder={lang === "fa" ? "سؤال خود را بنویسید…" : "Type your question…"}
                  rows={1}
                  className="flex-1 resize-none rounded-2xl glass border border-glass-border px-3 py-2.5 text-sm focus:outline-none focus:border-accent/60 min-h-[42px] max-h-[120px]"
                />
                {loading ? (
                  <button
                    onClick={stop}
                    className="shrink-0 w-11 h-11 rounded-2xl bg-foreground/10 hover:bg-foreground/15 flex items-center justify-center"
                    aria-label="stop"
                  >
                    <X className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={send}
                    disabled={!input.trim()}
                    className="shrink-0 w-11 h-11 rounded-2xl bg-gradient-warm text-primary-foreground flex items-center justify-center disabled:opacity-40 hover:shadow-glow transition-shadow"
                    aria-label="send"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                )}
              </div>
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
};

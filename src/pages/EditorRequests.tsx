import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Mail, Send, Loader2, Check, X, Inbox, Outbox } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRoles } from "@/hooks/useRoles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

const StatusBadge = ({ s }: { s: string }) => {
  const map: any = {
    pending: { v: "secondary", t: "در انتظار" },
    accepted: { v: "default", t: "پذیرفته شد" },
    rejected: { v: "destructive", t: "رد شد" },
    cancelled: { v: "outline", t: "لغو شد" },
  };
  const m = map[s] || { v: "outline", t: s };
  return <Badge variant={m.v}>{m.t}</Badge>;
};

const EditorRequests = () => {
  const { user, loading: authLoading } = useAuth();
  const { isPublisher, isAdmin, loading: rolesLoading } = useRoles();
  const nav = useNavigate();

  const [outgoing, setOutgoing] = useState<any[]>([]);
  const [incoming, setIncoming] = useState<any[]>([]);
  const [books, setBooks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  // form
  const [bookId, setBookId] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [canPublish, setCanPublish] = useState(false);

  const load = async () => {
    if (!user) return;
    setLoading(true);

    const { data: userRow } = await supabase.auth.getUser();
    const myEmail = userRow.user?.email?.toLowerCase() || "";

    const [{ data: out }, { data: inc }, { data: bks }] = await Promise.all([
      supabase
        .from("editor_access_requests")
        .select("*, books(title)")
        .eq("publisher_id", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("editor_access_requests")
        .select("*, books(title)")
        .or(`editor_user_id.eq.${user.id},editor_email.ilike.${myEmail}`)
        .order("created_at", { ascending: false }),
      isPublisher || isAdmin
        ? supabase
            .from("books")
            .select("id, title")
            .eq("publisher_id", user.id)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] as any[] }),
    ]);

    setOutgoing((out as any[]) || []);
    setIncoming((inc as any[]) || []);
    setBooks((bks as any[]) || []);
    if (((bks as any[]) || []).length && !bookId) setBookId((bks as any[])[0].id);
    setLoading(false);
  };

  useEffect(() => {
    if (authLoading || rolesLoading) return;
    if (!user) {
      nav("/auth");
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading, rolesLoading]);

  const sendRequest = async () => {
    if (!user) return;
    if (!bookId || !email.trim()) return toast.error("کتاب و ایمیل ادیتور را وارد کنید");
    setSending(true);

    // try to resolve email -> user_id (best effort; allowed for publishers/admins)
    const { data: editorUid } = await supabase.rpc("find_user_by_email", { _email: email.trim() });

    const { error } = await supabase.from("editor_access_requests").insert({
      book_id: bookId,
      publisher_id: user.id,
      editor_email: email.trim().toLowerCase(),
      editor_user_id: (editorUid as string) || null,
      message: message.trim() || null,
      can_publish: canPublish,
    });
    setSending(false);
    if (error) return toast.error(error.message);
    toast.success("درخواست ارسال شد");
    setEmail("");
    setMessage("");
    setCanPublish(false);
    load();
  };

  const acceptIncoming = async (id: string) => {
    const { error } = await supabase.rpc("accept_editor_request", { _request_id: id });
    if (error) return toast.error(error.message);
    toast.success("دسترسی اعطا شد");
    load();
  };

  const rejectIncoming = async (id: string) => {
    const { error } = await supabase
      .from("editor_access_requests")
      .update({ status: "rejected", reviewed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("درخواست رد شد");
    load();
  };

  const cancelOutgoing = async (id: string) => {
    const { error } = await supabase
      .from("editor_access_requests")
      .update({ status: "cancelled", reviewed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("درخواست لغو شد");
    load();
  };

  if (loading) {
    return (
      <div className="container py-20 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const canSend = isPublisher || isAdmin;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="container py-8 max-w-4xl space-y-6"
    >
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-gradient-warm flex items-center justify-center shadow-glow">
          <Mail className="w-6 h-6 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-3xl font-display font-bold gold-text">دسترسی ادیتورها</h1>
          <p className="text-sm text-muted-foreground">دعوت ادیتور با ایمیل، مدیریت و پاسخ به درخواست‌ها</p>
        </div>
      </div>

      <Tabs defaultValue="incoming" dir="rtl">
        <TabsList className="glass">
          <TabsTrigger value="incoming" className="gap-2">
            <Inbox className="w-4 h-4" /> دریافتی ({incoming.filter((r) => r.status === "pending").length})
          </TabsTrigger>
          {canSend && (
            <TabsTrigger value="outgoing" className="gap-2">
              <Send className="w-4 h-4" /> ارسالی ({outgoing.length})
            </TabsTrigger>
          )}
          {canSend && (
            <TabsTrigger value="new" className="gap-2">
              <Mail className="w-4 h-4" /> دعوت جدید
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="incoming" className="mt-4">
          <Card className="glass">
            <CardHeader>
              <CardTitle>درخواست‌هایی که برای شما فرستاده شده</CardTitle>
            </CardHeader>
            <CardContent>
              {incoming.length === 0 ? (
                <p className="text-sm text-muted-foreground">درخواستی برای شما ثبت نشده.</p>
              ) : (
                <div className="space-y-2">
                  {incoming.map((r) => (
                    <div key={r.id} className="p-3 rounded-lg border bg-card">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div>
                          <div className="font-medium">{r.books?.title || "—"}</div>
                          <div className="text-xs text-muted-foreground">
                            از: {r.publisher_id.slice(0, 8)}… • {r.can_publish ? "با اجازه انتشار" : "فقط ویرایش"}
                          </div>
                        </div>
                        <StatusBadge s={r.status} />
                      </div>
                      {r.message && <div className="text-sm mt-2 text-muted-foreground">{r.message}</div>}
                      {r.status === "pending" && (
                        <div className="flex gap-2 mt-3">
                          <Button size="sm" onClick={() => acceptIncoming(r.id)} className="gap-1">
                            <Check className="w-3.5 h-3.5" /> پذیرش
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => rejectIncoming(r.id)} className="gap-1">
                            <X className="w-3.5 h-3.5" /> رد
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {canSend && (
          <TabsContent value="outgoing" className="mt-4">
            <Card className="glass">
              <CardHeader>
                <CardTitle>درخواست‌هایی که شما ارسال کرده‌اید</CardTitle>
              </CardHeader>
              <CardContent>
                {outgoing.length === 0 ? (
                  <p className="text-sm text-muted-foreground">درخواستی ارسال نکرده‌اید.</p>
                ) : (
                  <div className="space-y-2">
                    {outgoing.map((r) => (
                      <div key={r.id} className="p-3 rounded-lg border bg-card">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div>
                            <div className="font-medium">{r.books?.title || "—"}</div>
                            <div className="text-xs text-muted-foreground">
                              ادیتور: {r.editor_email} • {r.can_publish ? "با اجازه انتشار" : "فقط ویرایش"}
                            </div>
                          </div>
                          <StatusBadge s={r.status} />
                        </div>
                        {r.status === "pending" && (
                          <Button size="sm" variant="ghost" className="mt-2 text-destructive" onClick={() => cancelOutgoing(r.id)}>
                            لغو درخواست
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {canSend && (
          <TabsContent value="new" className="mt-4">
            <Card className="glass">
              <CardHeader>
                <CardTitle>دعوت ادیتور جدید</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm">انتخاب کتاب</label>
                  <Select value={bookId} onValueChange={setBookId}>
                    <SelectTrigger>
                      <SelectValue placeholder="یک کتاب انتخاب کنید" />
                    </SelectTrigger>
                    <SelectContent>
                      {books.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm">ایمیل ادیتور</label>
                  <Input
                    type="email"
                    placeholder="editor@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm">پیام (اختیاری)</label>
                  <Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={canPublish} onCheckedChange={setCanPublish} />
                  <span className="text-sm">اجازه انتشار نهایی هم داشته باشد</span>
                </div>
                <Button onClick={sendRequest} disabled={sending || !books.length} className="bg-gradient-warm gap-2">
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  ارسال دعوت
                </Button>
                {!books.length && (
                  <p className="text-xs text-muted-foreground">برای دعوت ادیتور ابتدا باید کتابی منتشر کنید.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </motion.div>
  );
};

export default EditorRequests;

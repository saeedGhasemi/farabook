import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Settings, Save, UserPlus, Trash2, Loader2, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRoles } from "@/hooks/useRoles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

const THEMES = ["paper", "silver", "sky"];

const PublisherSettings = () => {
  const { user, loading: authLoading } = useAuth();
  const { isPublisher, isAdmin, loading: rolesLoading } = useRoles();
  const nav = useNavigate();

  const [profile, setProfile] = useState<any>({
    display_name: "",
    slug: "",
    bio: "",
    banner_url: "",
    logo_url: "",
    theme: "paper",
    website: "",
    is_active: true,
  });
  const [hasProfile, setHasProfile] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Editor management state
  const [books, setBooks] = useState<any[]>([]);
  const [editorEmail, setEditorEmail] = useState("");
  const [selectedBookId, setSelectedBookId] = useState("");
  const [bookEditors, setBookEditors] = useState<any[]>([]);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const [{ data: pp }, { data: bks }] = await Promise.all([
      supabase.from("publisher_profiles").select("*").eq("user_id", user.id).maybeSingle(),
      supabase
        .from("books")
        .select("id, title, publisher_id")
        .eq("publisher_id", user.id)
        .order("created_at", { ascending: false }),
    ]);
    if (pp) {
      setProfile(pp);
      setHasProfile(true);
    } else {
      // initial slug suggestion
      setProfile((p: any) => ({
        ...p,
        slug: (user.email || "publisher").split("@")[0],
        display_name: user.email?.split("@")[0] || "ناشر",
      }));
    }
    setBooks((bks as any[]) || []);
    if (((bks as any[]) || []).length > 0 && !selectedBookId) {
      setSelectedBookId((bks as any[])[0].id);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (authLoading || rolesLoading) return;
    if (!user) {
      nav("/auth");
      return;
    }
    if (!isPublisher && !isAdmin) {
      toast.error("نیاز به دسترسی ناشر دارید");
      nav("/credits");
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isPublisher, isAdmin, authLoading, rolesLoading]);

  const loadBookEditors = async (bookId: string) => {
    const { data } = await supabase
      .from("book_editors")
      .select("*, profiles:editor_id(display_name)")
      .eq("book_id", bookId);
    setBookEditors((data as any[]) || []);
  };

  useEffect(() => {
    if (selectedBookId) loadBookEditors(selectedBookId);
  }, [selectedBookId]);

  const save = async () => {
    if (!user) return;
    if (!profile.display_name?.trim() || !profile.slug?.trim()) {
      return toast.error("نام و نشانی (slug) لازم است");
    }
    setSaving(true);
    const payload = { ...profile, user_id: user.id };
    const { error } = await supabase
      .from("publisher_profiles")
      .upsert(payload, { onConflict: "user_id" });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("تنظیمات ذخیره شد");
    setHasProfile(true);
  };

  const inviteEditor = async () => {
    if (!editorEmail.trim() || !selectedBookId) return;
    // Lookup user by email via profiles (display_name fallback). We need to find user_id by email,
    // but profiles doesn't store email; rely on a public function in future. For now, accept user_id directly
    // by allowing email format OR uuid.
    let editorId = editorEmail.trim();
    if (!/^[0-9a-f-]{36}$/.test(editorId)) {
      toast.error("لطفاً user id (UUID) ادیتور را وارد کنید. ادیتور می‌تواند از پروفایل خود این شناسه را بردارد.");
      return;
    }
    // Promote them to editor role + grant book access
    await supabase.from("user_roles").insert({ user_id: editorId, role: "editor" as any }).then(() => null, () => null);
    const { error } = await supabase.from("book_editors").insert({
      book_id: selectedBookId,
      editor_id: editorId,
      granted_by: user!.id,
    });
    if (error) return toast.error(error.message);
    toast.success("ادیتور اضافه شد");
    setEditorEmail("");
    loadBookEditors(selectedBookId);
  };

  const removeEditor = async (id: string, editorId: string) => {
    await supabase.from("book_editors").delete().eq("id", id);
    // Check if editor still has any books; if not, optionally remove role (we keep it - super_admin decides)
    toast.success("دسترسی ادیتور حذف شد");
    loadBookEditors(selectedBookId);
  };

  if (loading) {
    return (
      <div className="container py-20 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="container py-8 max-w-4xl space-y-6"
    >
      <div className="flex items-center gap-3">
        <Link to="/publisher/me">
          <Button variant="ghost" size="icon">
            <ArrowRight className="w-4 h-4" />
          </Button>
        </Link>
        <div className="w-12 h-12 rounded-2xl bg-gradient-warm flex items-center justify-center shadow-glow">
          <Settings className="w-6 h-6 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-3xl font-display font-bold gold-text">تنظیمات انتشارات</h1>
          <p className="text-sm text-muted-foreground">ویترین، ادیتورها و ترجیحات نمایش</p>
        </div>
      </div>

      <Tabs defaultValue="storefront" dir="rtl">
        <TabsList className="glass">
          <TabsTrigger value="storefront">ویترین</TabsTrigger>
          <TabsTrigger value="editors">ادیتورها</TabsTrigger>
        </TabsList>

        <TabsContent value="storefront" className="mt-4">
          <Card className="glass">
            <CardHeader>
              <CardTitle>تنظیمات ویترین اختصاصی</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm">نام انتشارات</label>
                  <Input
                    value={profile.display_name || ""}
                    onChange={(e) => setProfile({ ...profile, display_name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-sm">نشانی ویترین (slug)</label>
                  <Input
                    value={profile.slug || ""}
                    onChange={(e) => setProfile({ ...profile, slug: e.target.value.toLowerCase().replace(/\s+/g, "-") })}
                  />
                </div>
              </div>
              <div>
                <label className="text-sm">معرفی</label>
                <Textarea
                  rows={3}
                  value={profile.bio || ""}
                  onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
                />
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm">آدرس بنر</label>
                  <Input value={profile.banner_url || ""} onChange={(e) => setProfile({ ...profile, banner_url: e.target.value })} />
                </div>
                <div>
                  <label className="text-sm">آدرس لوگو</label>
                  <Input value={profile.logo_url || ""} onChange={(e) => setProfile({ ...profile, logo_url: e.target.value })} />
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm">تم ویترین</label>
                  <Select value={profile.theme || "paper"} onValueChange={(v) => setProfile({ ...profile, theme: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {THEMES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm">وب‌سایت</label>
                  <Input value={profile.website || ""} onChange={(e) => setProfile({ ...profile, website: e.target.value })} />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={!!profile.is_active}
                  onCheckedChange={(v) => setProfile({ ...profile, is_active: v })}
                />
                <span className="text-sm">ویترین فعال (در فروشگاه عمومی نمایش داده شود)</span>
              </div>
              {profile.is_trusted && (
                <Badge className="bg-gradient-warm text-primary-foreground">ناشر تأییدشده — انتشار مستقیم</Badge>
              )}
              <Button onClick={save} disabled={saving} className="bg-gradient-warm gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                ذخیره
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="editors" className="mt-4">
          <Card className="glass">
            <CardHeader>
              <CardTitle>مدیریت ادیتورهای کتاب</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm">انتخاب کتاب</label>
                <Select value={selectedBookId} onValueChange={setSelectedBookId}>
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

              {selectedBookId && (
                <>
                  <div className="flex gap-2">
                    <Input
                      placeholder="شناسه کاربری ادیتور (UUID)"
                      value={editorEmail}
                      onChange={(e) => setEditorEmail(e.target.value)}
                    />
                    <Button onClick={inviteEditor} className="gap-2 bg-gradient-warm shrink-0">
                      <UserPlus className="w-4 h-4" /> افزودن
                    </Button>
                  </div>

                  <div className="space-y-2">
                    {bookEditors.length === 0 ? (
                      <p className="text-sm text-muted-foreground">ادیتوری برای این کتاب تعریف نشده.</p>
                    ) : (
                      bookEditors.map((be: any) => (
                        <div key={be.id} className="flex items-center justify-between p-3 rounded-lg border">
                          <div>
                            <div className="font-medium">{be.profiles?.display_name || be.editor_id.slice(0, 8) + "…"}</div>
                            <div className="text-xs text-muted-foreground font-mono">{be.editor_id}</div>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            onClick={() => removeEditor(be.id, be.editor_id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    شناسه کاربری ادیتور را از پروفایل خودش دریافت کنید. در هر زمان می‌توانید دسترسی را پس بگیرید.
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </motion.div>
  );
};

export default PublisherSettings;

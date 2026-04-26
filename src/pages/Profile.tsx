import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { z } from "zod";
import { User as UserIcon, Save, Loader2, Copy, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRoles } from "@/hooks/useRoles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserEarnings } from "@/components/profile/UserEarnings";
import { toast } from "sonner";

const ROLE_LABEL: Record<string, string> = {
  super_admin: "سوپر ادمین",
  admin: "ادمین",
  moderator: "ناظر محتوا",
  reviewer: "منتقد",
  publisher: "ناشر",
  editor: "ادیتور",
  user: "کاربر",
};

// Iranian national ID checksum
const isValidIranNationalId = (raw: string): boolean => {
  const s = (raw || "").replace(/\D/g, "");
  if (s.length !== 10) return false;
  if (/^(\d)\1{9}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(s[i], 10) * (10 - i);
  const c = parseInt(s[9], 10);
  const r = sum % 11;
  return r < 2 ? c === r : c === 11 - r;
};

const profileSchema = z.object({
  display_name: z.string().trim().min(1, "نام نمایشی لازم است").max(80),
  username: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.\-]{3,32}$/, "نام کاربری: ۳ تا ۳۲ کاراکتر، فقط حروف لاتین/عدد/._-")
    .optional()
    .or(z.literal("")),
  national_id: z
    .string()
    .trim()
    .refine((v) => v === "" || isValidIranNationalId(v), "کد ملی نامعتبر است")
    .optional()
    .or(z.literal("")),
  bio: z.string().trim().max(500).optional().or(z.literal("")),
  avatar_url: z.string().trim().url("آدرس نامعتبر").max(500).optional().or(z.literal("")),
  contact_email: z.string().trim().email("ایمیل نامعتبر").max(255).optional().or(z.literal("")),
  contact_phone: z.string().trim().max(40).optional().or(z.literal("")),
  website: z.string().trim().url("آدرس نامعتبر").max(255).optional().or(z.literal("")),
});

const Profile = () => {
  const { user, loading: authLoading } = useAuth();
  const { roles } = useRoles();
  const nav = useNavigate();

  const [form, setForm] = useState({
    display_name: "",
    username: "",
    national_id: "",
    bio: "",
    avatar_url: "",
    contact_email: "",
    contact_phone: "",
    website: "",
  });
  const [credits, setCredits] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      nav("/auth");
      return;
    }
    (async () => {
      setLoading(true);
      const [{ data: p }, { data: tx }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
        supabase.from("credit_transactions").select("amount").eq("user_id", user.id),
      ]);
      if (p) {
        setForm({
          display_name: p.display_name || "",
          username: (p as any).username || "",
          national_id: (p as any).national_id || "",
          bio: (p as any).bio || "",
          avatar_url: p.avatar_url || "",
          contact_email: (p as any).contact_email || "",
          contact_phone: (p as any).contact_phone || "",
          website: (p as any).website || "",
        });
      }
      setCredits(((tx as any[]) || []).reduce((s, r) => s + Number(r.amount || 0), 0));
      setLoading(false);
    })();
  }, [user, authLoading, nav]);

  const save = async () => {
    if (!user) return;
    const parsed = profileSchema.safeParse(form);
    if (!parsed.success) {
      const first = Object.values(parsed.error.flatten().fieldErrors).flat()[0];
      return toast.error(first || "ورودی نامعتبر");
    }
    setSaving(true);
    const payload = {
      id: user.id,
      display_name: parsed.data.display_name,
      username: parsed.data.username || null,
      national_id: parsed.data.national_id || null,
      bio: parsed.data.bio || null,
      avatar_url: parsed.data.avatar_url || null,
      contact_email: parsed.data.contact_email || null,
      contact_phone: parsed.data.contact_phone || null,
      website: parsed.data.website || null,
    };
    const { error } = await supabase.from("profiles").upsert(payload, { onConflict: "id" });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("پروفایل ذخیره شد");
  };

  const copyId = async () => {
    if (!user) return;
    await navigator.clipboard.writeText(user.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
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
      className="container py-8 max-w-3xl space-y-6"
    >
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-gradient-warm flex items-center justify-center shadow-glow overflow-hidden">
          {form.avatar_url ? (
            <img src={form.avatar_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <UserIcon className="w-6 h-6 text-primary-foreground" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-3xl font-display font-bold gold-text truncate">
            {form.display_name || user?.email}
          </h1>
          <p className="text-sm text-muted-foreground truncate">{user?.email}</p>
        </div>
      </div>

      <Tabs defaultValue="info" dir="rtl">
        <TabsList className="glass">
          <TabsTrigger value="info">اطلاعات من</TabsTrigger>
          <TabsTrigger value="earnings">درآمد و هزینه</TabsTrigger>
        </TabsList>
        <TabsContent value="earnings" className="mt-4">
          {user && <UserEarnings userId={user.id} />}
        </TabsContent>
        <TabsContent value="info" className="mt-4">
      <Card className="glass">
        <CardHeader>
          <CardTitle>اطلاعات من</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {roles.length === 0 && <Badge variant="outline">کاربر عادی</Badge>}
            {roles.map((r) => (
              <Badge key={r} variant={r === "super_admin" ? "default" : "secondary"}>
                {ROLE_LABEL[r] || r}
              </Badge>
            ))}
            <Badge variant="outline">{credits.toLocaleString("fa-IR")} اعتبار</Badge>
            <Button size="sm" variant="ghost" onClick={copyId} className="gap-1 ms-auto text-xs font-mono">
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {user?.id.slice(0, 8)}…
            </Button>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm">نام نمایشی *</label>
              <Input
                value={form.display_name}
                maxLength={80}
                onChange={(e) => setForm({ ...form, display_name: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm">آدرس آواتار</label>
              <Input
                value={form.avatar_url}
                placeholder="https://…"
                onChange={(e) => setForm({ ...form, avatar_url: e.target.value })}
              />
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm">نام کاربری (یکتا)</label>
              <Input
                value={form.username}
                placeholder="مثلاً ali_ahmadi"
                maxLength={32}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm">کد ملی (۱۰ رقمی)</label>
              <Input
                value={form.national_id}
                placeholder="۰۰۱۲۳۴۵۶۷۸"
                inputMode="numeric"
                maxLength={10}
                onChange={(e) => setForm({ ...form, national_id: e.target.value.replace(/\D/g, "") })}
              />
            </div>
          </div>

          <div>
            <label className="text-sm">دربارهٔ من</label>
            <Textarea
              rows={4}
              maxLength={500}
              value={form.bio}
              placeholder="چند خط دربارهٔ خودتان…"
              onChange={(e) => setForm({ ...form, bio: e.target.value })}
            />
            <p className="text-xs text-muted-foreground mt-1">{form.bio.length}/500</p>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm">ایمیل تماس</label>
              <Input
                type="email"
                value={form.contact_email}
                onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm">شماره تماس</label>
              <Input
                type="email"
                value={form.contact_email}
                onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm">شماره تماس</label>
              <Input
                value={form.contact_phone}
                onChange={(e) => setForm({ ...form, contact_phone: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="text-sm">وب‌سایت</label>
            <Input
              value={form.website}
              placeholder="https://…"
              onChange={(e) => setForm({ ...form, website: e.target.value })}
            />
          </div>

          <Button onClick={save} disabled={saving} className="bg-gradient-warm gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            ذخیره
          </Button>

          <p className="text-xs text-muted-foreground">
            شناسه کاربری شما برای دعوت به عنوان ادیتور استفاده می‌شود؛ می‌توانید از دکمهٔ بالا کپی کنید.
          </p>
        </CardContent>
      </Card>
    </motion.div>
  );
};

export default Profile;

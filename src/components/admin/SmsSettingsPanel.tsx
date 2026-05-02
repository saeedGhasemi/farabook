// Admin panel for SMS provider configuration & event templates.
// Stored in public.sms_settings — admin can swap providers (Kavenegar /
// Melipayamak / Twilio / custom HTTP) and edit per-event templates without
// touching project secrets. A "send test" button calls the sms-send edge
// function to verify credentials end-to-end.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Save, Send, MessageSquare, KeyRound, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

interface SmsCfg {
  enabled: boolean;
  provider: string;
  sender: string | null;
  api_key: string | null;
  api_username: string | null;
  api_password: string | null;
  custom_endpoint: string | null;
  custom_payload_template: string | null;
  tpl_purchase: string;
  tpl_credit: string;
  tpl_revenue: string;
  tpl_approval: string;
}

const DEFAULTS: SmsCfg = {
  enabled: false,
  provider: "kavenegar",
  sender: "",
  api_key: "",
  api_username: "",
  api_password: "",
  custom_endpoint: "",
  custom_payload_template: '{"to":"{to}","message":"{message}"}',
  tpl_purchase: "",
  tpl_credit: "",
  tpl_revenue: "",
  tpl_approval: "",
};

export const SmsSettingsPanel = () => {
  const [cfg, setCfg] = useState<SmsCfg>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showSecrets, setShowSecrets] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [testMsg, setTestMsg] = useState("این یک پیامک تست از فرابوک است.");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await (supabase.from as any)("sms_settings")
        .select("*").eq("id", 1).maybeSingle();
      if (!error && data) setCfg({ ...DEFAULTS, ...data });
      setLoading(false);
    })();
  }, []);

  const set = <K extends keyof SmsCfg>(k: K, v: SmsCfg[K]) =>
    setCfg((c) => ({ ...c, [k]: v }));

  const save = async () => {
    setSaving(true);
    const { error } = await (supabase.from as any)("sms_settings")
      .update({
        enabled: cfg.enabled,
        provider: cfg.provider,
        sender: cfg.sender || null,
        api_key: cfg.api_key || null,
        api_username: cfg.api_username || null,
        api_password: cfg.api_password || null,
        custom_endpoint: cfg.custom_endpoint || null,
        custom_payload_template: cfg.custom_payload_template || null,
        tpl_purchase: cfg.tpl_purchase,
        tpl_credit: cfg.tpl_credit,
        tpl_revenue: cfg.tpl_revenue,
        tpl_approval: cfg.tpl_approval,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("تنظیمات پیامک ذخیره شد");
  };

  const sendTest = async () => {
    if (!testPhone.trim()) { toast.error("شماره موبایل را وارد کنید"); return; }
    setSending(true);
    const { data, error } = await supabase.functions.invoke("sms-send", {
      body: { to: testPhone.trim(), message: testMsg, event: "test" },
    });
    setSending(false);
    if (error || (data as any)?.error) {
      toast.error(((data as any)?.error) || error?.message || "ارسال ناموفق بود");
    } else {
      toast.success("پیامک تست ارسال شد ✓");
    }
  };

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  }

  const providerNeedsKey = cfg.provider === "kavenegar" || cfg.provider === "custom";
  const providerNeedsUserPass = cfg.provider === "melipayamak" || cfg.provider === "twilio";
  const providerIsCustom = cfg.provider === "custom";

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="glass">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-accent" />
            پیکربندی سرویس پیامک
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center justify-between gap-2 rounded-lg border p-3">
            <div>
              <div className="text-sm font-medium">فعال‌سازی ارسال پیامک</div>
              <div className="text-xs text-muted-foreground">
                در صورت غیرفعال بودن هیچ پیامکی برای رویدادها ارسال نمی‌شود.
              </div>
            </div>
            <Switch checked={cfg.enabled} onCheckedChange={(v) => set("enabled", v)} />
          </label>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1 block">ارائه‌دهنده</Label>
              <Select value={cfg.provider} onValueChange={(v) => set("provider", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="kavenegar">کاوه‌نگار</SelectItem>
                  <SelectItem value="melipayamak">ملی پیامک</SelectItem>
                  <SelectItem value="twilio">Twilio</SelectItem>
                  <SelectItem value="custom">سفارشی (HTTP POST)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1 block">
                {cfg.provider === "twilio" ? "شماره فرستنده (E.164 مثل +12025550100)" : "خط فرستنده (اختیاری)"}
              </Label>
              <Input value={cfg.sender || ""} onChange={(e) => set("sender", e.target.value)} placeholder="مثلاً 10008663" />
            </div>
          </div>

          <div className="rounded-lg border p-3 space-y-3 bg-muted/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <KeyRound className="w-4 h-4" />
                اطلاعات احراز ارائه‌دهنده
              </div>
              <Button size="sm" variant="ghost" onClick={() => setShowSecrets((v) => !v)} className="h-7 gap-1 text-xs">
                {showSecrets ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                {showSecrets ? "مخفی کردن" : "نمایش"}
              </Button>
            </div>

            {providerNeedsKey && (
              <div>
                <Label className="text-xs mb-1 block">
                  {providerIsCustom ? "API Key (به‌صورت Bearer ارسال می‌شود)" : "API Key کاوه‌نگار"}
                </Label>
                <Input
                  type={showSecrets ? "text" : "password"}
                  value={cfg.api_key || ""}
                  onChange={(e) => set("api_key", e.target.value)}
                  placeholder="••••••••"
                />
              </div>
            )}

            {providerNeedsUserPass && (
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs mb-1 block">
                    {cfg.provider === "twilio" ? "Account SID" : "نام کاربری"}
                  </Label>
                  <Input
                    type={showSecrets ? "text" : "password"}
                    value={cfg.api_username || ""}
                    onChange={(e) => set("api_username", e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-xs mb-1 block">
                    {cfg.provider === "twilio" ? "Auth Token" : "رمز عبور"}
                  </Label>
                  <Input
                    type={showSecrets ? "text" : "password"}
                    value={cfg.api_password || ""}
                    onChange={(e) => set("api_password", e.target.value)}
                  />
                </div>
              </div>
            )}

            {providerIsCustom && (
              <>
                <div>
                  <Label className="text-xs mb-1 block">آدرس Endpoint</Label>
                  <Input
                    value={cfg.custom_endpoint || ""}
                    onChange={(e) => set("custom_endpoint", e.target.value)}
                    placeholder="https://api.example.com/sms/send"
                  />
                </div>
                <div>
                  <Label className="text-xs mb-1 block">
                    قالب JSON بدنه (متغیرها: <code dir="ltr">{"{to} {message} {sender} {api_key}"}</code>)
                  </Label>
                  <Textarea
                    rows={3}
                    className="font-mono text-xs"
                    dir="ltr"
                    value={cfg.custom_payload_template || ""}
                    onChange={(e) => set("custom_payload_template", e.target.value)}
                  />
                </div>
              </>
            )}
          </div>

          <div className="flex justify-end">
            <Button onClick={save} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              ذخیره
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="glass">
        <CardHeader>
          <CardTitle className="text-base">قالب پیامک‌های رویدادها</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            متغیرها بسته به رویداد: <code dir="ltr">{"{title} {cost} {balance} {amount} {role} {body}"}</code>
          </p>
          {([
            ["tpl_purchase", "خرید کتاب"],
            ["tpl_credit",   "خرید/شارژ اعتبار"],
            ["tpl_revenue",  "درآمد ناشر/نویسنده"],
            ["tpl_approval", "تأیید درخواست‌ها"],
          ] as const).map(([k, label]) => (
            <div key={k}>
              <Label className="text-xs mb-1 block">{label}</Label>
              <Textarea rows={2} value={(cfg as any)[k] || ""}
                onChange={(e) => set(k, e.target.value as any)} />
            </div>
          ))}
          <div className="flex justify-end">
            <Button onClick={save} disabled={saving} variant="outline" className="gap-2">
              <Save className="w-4 h-4" /> ذخیره قالب‌ها
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="glass">
        <CardHeader>
          <CardTitle className="text-base">ارسال پیامک تست</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1 block">شماره موبایل</Label>
              <Input dir="ltr" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="09xxxxxxxxx" />
            </div>
          </div>
          <div>
            <Label className="text-xs mb-1 block">متن</Label>
            <Textarea rows={2} value={testMsg} onChange={(e) => setTestMsg(e.target.value)} />
          </div>
          <div className="flex justify-end">
            <Button onClick={sendTest} disabled={sending || !cfg.enabled} className="gap-2 bg-gradient-warm hover:opacity-90">
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              ارسال تست
            </Button>
          </div>
          {!cfg.enabled && (
            <p className="text-xs text-amber-600">ابتدا «فعال‌سازی ارسال پیامک» را روشن و ذخیره کنید.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

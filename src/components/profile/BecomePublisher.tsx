import { useEffect, useState } from "react";
import { Briefcase, Loader2, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfirmTransactionDialog } from "@/components/ConfirmTransactionDialog";
import { useCredits } from "@/hooks/useCredits";
import { pulseCredits, requestCreditsRefresh } from "@/lib/credits-bus";
import { showInsufficientCreditsToast } from "@/lib/credit-guard";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

interface Props {
  lang: "fa" | "en";
  alreadyPublisher: boolean;
}

export const BecomePublisher = ({ lang, alreadyPublisher }: Props) => {
  const fa = lang === "fa";
  const nav = useNavigate();
  const { credits } = useCredits();
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [website, setWebsite] = useState("");
  const [signupCost, setSignupCost] = useState(200);
  const [pending, setPending] = useState<{ status: string; created_at: string } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: fee }, { data: req }] = await Promise.all([
        supabase.from("platform_fee_settings").select("publisher_signup_value").eq("id", 1).maybeSingle(),
        supabase.from("publisher_upgrade_requests").select("status, created_at").eq("status", "pending").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (fee) setSignupCost(Number((fee as any).publisher_signup_value) || 200);
      if (req) setPending(req as any);
    })();
  }, []);

  if (alreadyPublisher) {
    return (
      <Card className="glass">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Briefcase className="w-5 h-5 text-accent" />
            {fa ? "وضعیت ناشر" : "Publisher status"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Badge className="bg-emerald-500 text-white">{fa ? "شما ناشر هستید ✓" : "You are a publisher ✓"}</Badge>
        </CardContent>
      </Card>
    );
  }

  if (pending) {
    return (
      <Card className="glass">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Briefcase className="w-5 h-5 text-amber-500" />
            {fa ? "درخواست در انتظار بررسی" : "Request pending review"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {fa
              ? "درخواست ناشر شدن شما ثبت شده و در انتظار تأیید مدیر است."
              : "Your publisher request was submitted and is awaiting admin approval."}
          </p>
        </CardContent>
      </Card>
    );
  }

  const submit = async () => {
    if (!displayName.trim()) {
      toast.error(fa ? "نام انتشارات لازم است" : "Display name required");
      return;
    }
    if (credits < signupCost) {
      showInsufficientCreditsToast(lang, signupCost, (to) => nav(to));
      return;
    }
    setConfirmOpen(true);
  };

  const onConfirm = async () => {
    setConfirmOpen(false);
    setBusy(true);
    try {
      const { data, error } = await (supabase.rpc as any)("request_publisher_upgrade_paid", {
        _display_name: displayName,
        _bio: bio || null,
        _website: website || null,
      });
      if (error) {
        if (String(error.message).includes("insufficient_credits")) {
          showInsufficientCreditsToast(lang, signupCost, (to) => nav(to));
        } else {
          toast.error(error.message);
        }
        return;
      }
      const newBal = Number((data as any)?.new_balance || 0);
      pulseCredits({ delta: -signupCost, newBalance: newBal });
      requestCreditsRefresh();
      toast.success(
        fa ? "درخواست ناشر شدن ثبت شد ✨" : "Publisher request submitted ✨",
        { description: fa ? "پس از تأیید مدیر، می‌توانید کتاب منتشر کنید." : "Awaiting admin approval." },
      );
      setPending({ status: "pending", created_at: new Date().toISOString() });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="glass">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-accent" />
          {fa ? "تبدیل به ناشر" : "Become a publisher"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {fa
            ? `با پرداخت ${signupCost.toLocaleString("fa-IR")} اعتبار، می‌توانید کتاب بسازید، منتشر کنید و درآمد فروش کسب کنید.`
            : `Pay ${signupCost.toLocaleString()} credits to build, publish, and earn from your books.`}
        </p>
        <div>
          <Label>{fa ? "نام انتشارات *" : "Publisher name *"}</Label>
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="mt-1" />
        </div>
        <div>
          <Label>{fa ? "دربارهٔ ما" : "About"}</Label>
          <Textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} className="mt-1" />
        </div>
        <div>
          <Label>{fa ? "وب‌سایت" : "Website"}</Label>
          <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" className="mt-1" />
        </div>
        <Button onClick={submit} disabled={busy} className="bg-gradient-warm gap-2">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Briefcase className="w-4 h-4" />}
          {fa ? "ارسال درخواست" : "Submit request"}
        </Button>

        <ConfirmTransactionDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={fa ? "تأیید درخواست ناشر شدن" : "Confirm publisher signup"}
          description={fa
            ? "با تأیید، اعتبار از حساب شما کسر و درخواست برای تأیید مدیر ارسال می‌شود."
            : "Credits will be charged and your request sent for admin approval."}
          currentBalance={credits}
          cost={signupCost}
          lang={lang}
          confirmLabel={fa ? "تأیید و ارسال" : "Confirm & submit"}
          onConfirm={onConfirm}
        />
      </CardContent>
    </Card>
  );
};

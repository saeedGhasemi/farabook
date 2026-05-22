import { useEffect, useState } from "react";
import { Smartphone, Trash2, Loader2, Pencil, Check, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { getDeviceId, getDeviceLabel, getDevicePlatform } from "@/lib/offline/deviceId";

interface Device {
  id: string;
  device_id: string;
  device_label: string | null;
  platform: string | null;
  last_seen_at: string;
  created_at: string;
}

const MAX = 2;

export function OfflineDevicesPanel() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const fa = lang === "fa";
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [myDevice, setMyDevice] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  useEffect(() => {
    void getDeviceId().then(setMyDevice);
  }, []);

  const load = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("user_offline_devices")
      .select("*")
      .eq("user_id", user.id)
      .order("last_seen_at", { ascending: false });
    if (error) toast.error(error.message);
    setDevices((data as Device[]) ?? []);
    setLoading(false);
  };

  // Make sure the current browser/device shows up in the list even before any
  // book is downloaded — register it (or refresh last_seen) on mount.
  useEffect(() => {
    void (async () => {
      if (!user) return;
      const did = await getDeviceId();
      await supabase.from("user_offline_devices").upsert({
        user_id: user.id,
        device_id: did,
        device_label: getDeviceLabel(),
        platform: getDevicePlatform(),
        last_seen_at: new Date().toISOString(),
      }, { onConflict: "user_id,device_id" });
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const release = async (d: Device) => {
    if (!confirm(fa
      ? `حذف دستگاه «${d.device_label || "بدون نام"}»؟ نسخه‌های آفلاین آن باطل می‌شود.`
      : `Remove "${d.device_label || "Unnamed"}"? Its offline copies will be invalidated.`)) return;
    setBusy(d.id);
    const { error } = await supabase.from("user_offline_devices").delete().eq("id", d.id);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(fa ? "دستگاه آزاد شد" : "Device released");
    await load();
  };

  const startEdit = (d: Device) => {
    setEditingId(d.id);
    setEditValue(d.device_label ?? "");
  };

  const cancelEdit = () => { setEditingId(null); setEditValue(""); };

  const saveEdit = async (d: Device) => {
    const label = editValue.trim().slice(0, 60);
    if (!label) { toast.error(fa ? "نام نمی‌تواند خالی باشد" : "Name can't be empty"); return; }
    setBusy(d.id);
    const { error } = await supabase
      .from("user_offline_devices")
      .update({ device_label: label })
      .eq("id", d.id);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(fa ? "نام دستگاه ذخیره شد" : "Device name saved");
    setEditingId(null);
    await load();
  };

  const fmt = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return fa ? "همین الان" : "just now";
    if (m < 60) return fa ? `${m} دقیقه پیش` : `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return fa ? `${h} ساعت پیش` : `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 30) return fa ? `${d} روز پیش` : `${d}d ago`;
    return new Date(iso).toLocaleDateString(fa ? "fa-IR" : "en-US");
  };

  return (
    <div className="paper-card rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-lg font-display font-semibold flex items-center gap-2">
            <Smartphone className="w-5 h-5" />
            {fa ? "دستگاه‌های آفلاین" : "Offline devices"}
          </h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl">
            {fa
              ? `حداکثر ${MAX} دستگاه می‌توانند نسخه آفلاین داشته باشند. می‌توانید برای هر دستگاه یک نام دلخواه (مثل «لپ‌تاپ کار» یا «گوشی همراه») بگذارید تا تشخیص آن آسان باشد.`
              : `Up to ${MAX} devices may keep an offline copy. Give each device a friendly name (e.g. "Work laptop", "My phone") so you can tell them apart.`}
          </p>
        </div>
        <Badge variant="outline" className="text-sm">
          {devices.length}/{MAX}
        </Badge>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : devices.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          {fa ? "هنوز هیچ دستگاهی نسخه آفلاین ندارد." : "No offline devices yet."}
        </p>
      ) : (
        <ul className="divide-y">
          {devices.map((d) => {
            const isMe = d.device_id === myDevice;
            const isEditing = editingId === d.id;
            return (
              <li key={d.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <div className="flex items-center gap-2">
                      <Input
                        autoFocus
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void saveEdit(d);
                          if (e.key === "Escape") cancelEdit();
                        }}
                        placeholder={fa ? "مثلاً: لپ‌تاپ کار" : "e.g. Work laptop"}
                        className="h-8 max-w-xs"
                        maxLength={60}
                      />
                      <Button size="sm" variant="ghost" onClick={() => saveEdit(d)} disabled={busy === d.id}>
                        {busy === d.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4 text-primary" />}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={cancelEdit}>
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="font-medium flex items-center gap-2 flex-wrap">
                        <span className="truncate">{d.device_label || (fa ? "بدون نام" : "Unnamed device")}</span>
                        {isMe && (
                          <Badge className="bg-primary/15 text-primary border-0 text-[10px]">
                            {fa ? "این دستگاه" : "this device"}
                          </Badge>
                        )}
                        <button
                          type="button"
                          onClick={() => startEdit(d)}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={fa ? "تغییر نام" : "Rename"}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {d.platform && <span>{d.platform === "native" ? (fa ? "اپ نصب‌شده" : "Installed app") : (fa ? "مرورگر" : "Browser")} · </span>}
                        {fa ? "آخرین فعالیت: " : "Last seen: "}{fmt(d.last_seen_at)}
                      </div>
                    </>
                  )}
                </div>
                {!isEditing && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => release(d)}
                    disabled={busy === d.id}
                    className="text-destructive hover:bg-destructive/10 shrink-0"
                  >
                    {busy === d.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    <span className="ms-1 hidden sm:inline">{fa ? "حذف" : "Remove"}</span>
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

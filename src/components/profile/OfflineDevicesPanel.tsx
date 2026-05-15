import { useEffect, useState } from "react";
import { Smartphone, Trash2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { getDeviceId } from "@/lib/offline/deviceId";

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

  useEffect(() => { void load(); }, [user]);

  const release = async (d: Device) => {
    setBusy(d.id);
    const { error } = await supabase.from("user_offline_devices").delete().eq("id", d.id);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(fa ? "دستگاه آزاد شد" : "Device released");
    await load();
  };

  const fmt = (iso: string) => new Date(iso).toLocaleString(fa ? "fa-IR" : "en-US");

  return (
    <div className="paper-card rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-lg font-display font-semibold flex items-center gap-2">
            <Smartphone className="w-5 h-5" />
            {fa ? "دستگاه‌های آفلاین" : "Offline devices"}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            {fa
              ? `حداکثر ${MAX} دستگاه می‌توانند نسخه آفلاین داشته باشند. در سایر دستگاه‌ها می‌توانید آنلاین مطالعه کنید.`
              : `Up to ${MAX} devices may keep an offline copy. Other devices can still read online.`}
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
            return (
              <li key={d.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="font-medium flex items-center gap-2">
                    {d.device_label || (fa ? "دستگاه" : "Device")}
                    {isMe && (
                      <Badge className="bg-primary/15 text-primary border-0 text-[10px]">
                        {fa ? "این دستگاه" : "this device"}
                      </Badge>
                    )}
                    {d.platform && <span className="text-xs text-muted-foreground">· {d.platform}</span>}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {fa ? "آخرین فعالیت: " : "Last seen: "}{fmt(d.last_seen_at)}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => release(d)}
                  disabled={busy === d.id}
                  className="text-destructive hover:bg-destructive/10"
                >
                  {busy === d.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  <span className="ms-1">{fa ? "آزاد کردن" : "Release"}</span>
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

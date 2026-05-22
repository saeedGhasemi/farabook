import { useEffect, useState } from "react";
import { Smartphone, Trash2, Loader2, Pencil, Check, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  book_id: string | null;
}

const MAX = 2;

/** Per-book device management: shows only devices that have downloaded
 *  the offline copy of this specific book. */
export function BookDevicesPanel({ bookId, currentDeviceLabel }: { bookId: string; currentDeviceLabel?: string }) {
  const { user } = useAuth();
  const { lang } = useI18n();
  const fa = lang === "fa";
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [myDevice, setMyDevice] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  useEffect(() => { void getDeviceId().then(setMyDevice); }, []);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("user_offline_devices")
      .select("*")
      .eq("user_id", user.id)
      .eq("book_id", bookId)
      .order("last_seen_at", { ascending: false });
    if (error) toast.error(error.message);
    setDevices((data as Device[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [user, bookId]);

  const release = async (d: Device) => {
    if (!confirm(fa
      ? `حذف دسترسی آفلاین این کتاب از «${d.device_label || "بدون نام"}»؟`
      : `Remove offline copy of this book from "${d.device_label || "Unnamed"}"?`)) return;
    setBusy(d.id);
    const { error } = await supabase.from("user_offline_devices").delete().eq("id", d.id);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(fa ? "دستگاه آزاد شد" : "Device released");
    await load();
  };

  const startEdit = (d: Device) => { setEditingId(d.id); setEditValue(d.device_label ?? ""); };
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
    <div className="paper-card rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-base font-display font-semibold flex items-center gap-2">
            <Smartphone className="w-4 h-4" />
            {fa ? "دستگاه‌های آفلاین این کتاب" : "Offline devices for this book"}
          </h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-xl">
            {fa
              ? `هر کتاب حداکثر روی ${MAX} دستگاه می‌تواند نسخه آفلاین داشته باشد. برای آزاد کردن جا، یکی از دستگاه‌ها را حذف کنید.`
              : `Each book can be kept offline on up to ${MAX} devices. Remove one to free a slot.`}
          </p>
        </div>
        <Badge variant="outline" className="text-sm">{devices.length}/{MAX}</Badge>
      </div>

      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : devices.length === 0 ? (
        currentDeviceLabel ? (
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">
            <div className="font-medium flex items-center gap-2">
              <Smartphone className="w-4 h-4" />
              {currentDeviceLabel}
              <Badge className="bg-primary/15 text-primary border-0 text-[10px]">
                {fa ? "این دستگاه" : "this device"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {fa
                ? "نسخه آفلاین محلی آماده است؛ ثبت وضعیت دستگاه در حال همگام‌سازی است."
                : "The local offline copy is ready; device status is syncing."}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-4 text-center">
            {fa ? "هنوز این کتاب روی هیچ دستگاهی آفلاین نشده است." : "This book is not offline on any device yet."}
          </p>
        )
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
                      <Button size="sm" variant="ghost" onClick={cancelEdit}><X className="w-4 h-4" /></Button>
                    </div>
                  ) : (
                    <>
                      <div className="font-medium flex items-center gap-2 flex-wrap text-sm">
                        <span className="truncate">{d.device_label || (fa ? "بدون نام" : "Unnamed device")}</span>
                        {isMe && (
                          <Badge className="bg-primary/15 text-primary border-0 text-[10px]">
                            {fa ? "این دستگاه" : "this device"}
                          </Badge>
                        )}
                        <button type="button" onClick={() => startEdit(d)}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={fa ? "تغییر نام" : "Rename"}>
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
                  <Button variant="ghost" size="sm" onClick={() => release(d)}
                    disabled={busy === d.id}
                    className="text-destructive hover:bg-destructive/10 shrink-0">
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

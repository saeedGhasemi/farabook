import { useEffect, useRef, useState } from "react";
import { Music2, Upload, Trash2, Play, Pause, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB
const MAX_TRACKS = 20;

interface TrackRow {
  name: string;
  path: string;
  url: string;
  size: number;
}

interface Props {
  userId: string;
}

/**
 * Personal ambient/background audio playlist.
 * Files are stored in the public `user-ambient` bucket under `{userId}/{name}`
 * and become available in the reader's ambient picker.
 */
export const AmbientPlaylist = ({ userId }: Props) => {
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [playingPath, setPlayingPath] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const refresh = async () => {
    setLoading(true);
    const { data, error } = await supabase.storage
      .from("user-ambient")
      .list(userId, { limit: 50, sortBy: { column: "created_at", order: "desc" } });
    setLoading(false);
    if (error) { toast.error("بارگذاری لیست با خطا روبه‌رو شد"); return; }
    const rows: TrackRow[] = (data ?? [])
      .filter((f) => f.name && !f.name.endsWith("/"))
      .map((f) => {
        const path = `${userId}/${f.name}`;
        const { data: pub } = supabase.storage.from("user-ambient").getPublicUrl(path);
        return {
          name: f.name,
          path,
          url: pub.publicUrl,
          size: (f.metadata as { size?: number } | null)?.size ?? 0,
        };
      });
    setTracks(rows);
  };

  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [userId]);
  useEffect(() => () => { audioRef.current?.pause(); audioRef.current = null; }, []);

  const onPick = () => inputRef.current?.click();

  const onUpload = async (file: File) => {
    if (file.size > MAX_BYTES) {
      toast.error(`حداکثر حجم فایل ۲۰ مگابایت است (${(file.size / 1024 / 1024).toFixed(1)}MB)`);
      return;
    }
    if (tracks.length >= MAX_TRACKS) {
      toast.error(`حداکثر ${MAX_TRACKS} ترک قابل آپلود است`);
      return;
    }
    const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(0, 80);
    const path = `${userId}/${Date.now()}-${safe}`;
    setUploading(true);
    const { error } = await supabase.storage
      .from("user-ambient")
      .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || "audio/mpeg" });
    setUploading(false);
    if (error) { toast.error(error.message || "آپلود ناموفق"); return; }
    toast.success("ترک اضافه شد");
    await refresh();
  };

  const onDelete = async (path: string) => {
    if (!confirm("این ترک حذف شود؟")) return;
    const { error } = await supabase.storage.from("user-ambient").remove([path]);
    if (error) { toast.error(error.message); return; }
    if (playingPath === path) { audioRef.current?.pause(); setPlayingPath(null); }
    toast.success("حذف شد");
    setTracks((t) => t.filter((x) => x.path !== path));
  };

  const togglePlay = (t: TrackRow) => {
    if (playingPath === t.path) {
      audioRef.current?.pause();
      setPlayingPath(null);
      return;
    }
    audioRef.current?.pause();
    const a = new Audio(t.url);
    a.volume = 0.5;
    audioRef.current = a;
    a.addEventListener("ended", () => setPlayingPath(null));
    a.play().then(() => setPlayingPath(t.path)).catch(() => toast.error("پخش ممکن نشد"));
  };

  return (
    <Card className="glass">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Music2 className="w-5 h-5 text-accent" />
          پلی‌لیست صدای محیطی من
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          فایل‌های صوتی خود (طبیعت، موسیقی بی‌کلام، …) را اضافه کنید تا هنگام مطالعه در پس‌زمینه پخش شود.
          هر فایل تا سقف <strong>۲۰ مگابایت</strong> و حداکثر <strong>{MAX_TRACKS} ترک</strong>.
        </p>

        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onUpload(f);
              e.target.value = "";
            }}
          />
          <Button onClick={onPick} disabled={uploading || tracks.length >= MAX_TRACKS} className="gap-2">
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            افزودن ترک
          </Button>
          <span className="text-xs text-muted-foreground">
            {tracks.length} / {MAX_TRACKS}
          </span>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> در حال بارگذاری…
          </div>
        ) : tracks.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center border border-dashed border-border/60 rounded-xl">
            هنوز ترکی اضافه نکرده‌اید.
          </div>
        ) : (
          <ul className="divide-y divide-border/60 rounded-xl border border-border/60 overflow-hidden">
            {tracks.map((t) => (
              <li key={t.path} className="flex items-center gap-3 p-3 hover:bg-accent/5 transition-colors">
                <button
                  onClick={() => togglePlay(t)}
                  className="w-9 h-9 rounded-full bg-accent/10 hover:bg-accent/20 text-accent flex items-center justify-center shrink-0"
                  aria-label={playingPath === t.path ? "Pause" : "Play"}
                >
                  {playingPath === t.path ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ms-0.5" />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm font-medium">{t.name.replace(/^\d+-/, "")}</div>
                  <div className="text-xs text-muted-foreground">
                    {t.size ? `${(t.size / 1024 / 1024).toFixed(2)} MB` : "—"}
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => onDelete(t.path)} aria-label="حذف">
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
};

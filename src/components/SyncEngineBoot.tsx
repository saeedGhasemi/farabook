// Boots the offline SyncEngine once a user session is available.
// Mounted near the app root; renders nothing.

import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { startSyncEngine, stopSyncEngine } from "@/lib/offline/SyncEngine";

export function SyncEngineBoot() {
  const { user } = useAuth();
  useEffect(() => {
    if (!user) { stopSyncEngine(); return; }
    startSyncEngine(user.id);
    return () => stopSyncEngine();
  }, [user]);
  return null;
}

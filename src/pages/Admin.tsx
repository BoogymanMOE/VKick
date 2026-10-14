import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { TopBar } from "../components/TopBar";
import { useToast } from "../components/toastContext";
import { useAuth } from "../hooks/authContext";
import { api } from "../lib/api";
import { Button, Card, Num, SectionHeading } from "../components/ui";
import { haptic } from "../lib/telegram";

interface AdminStats {
  totalUsers: number;
  totalMatches: number;
  totalPredictions: number;
  totalFavorites: number;
}

export default function Admin() {
  const { user } = useAuth();
  const { push } = useToast();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [broadcasting, setBroadcasting] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!user?.isAdmin) return;
    void api
      .getAdminStats()
      .then((res) => setStats(res.stats))
      .catch(() => {});
  }, [user?.isAdmin]);

  if (!user?.isAdmin) return <Navigate to="/matches" replace />;

  const handleSync = async () => {
    haptic("light");
    setSyncing(true);
    try {
      await api.adminSync();
      push({ text: "ESPN sync complete", tone: "volt", icon: "✓" });
    } catch {
      push({ text: "Sync failed", tone: "danger", icon: "✕" });
    } finally {
      setSyncing(false);
    }
  };

  const handleBroadcast = async () => {
    if (!message.trim() || broadcasting) return;
    haptic("medium");
    setBroadcasting(true);
    try {
      const res = await api.adminBroadcast(message.trim());
      push({ text: `Broadcast sent to ${res.sent} users`, tone: "volt", icon: "✓" });
      setMessage("");
    } catch {
      push({ text: "Broadcast failed", tone: "danger", icon: "✕" });
    } finally {
      setBroadcasting(false);
    }
  };

  return (
    <>
      <TopBar title="Admin Dashboard" />
      <div className="mt-4 space-y-4">
        <section>
          <SectionHeading title="Stats" />
          <div className="grid grid-cols-2 gap-2">
            <StatCard label="Total Users" value={stats?.totalUsers} />
            <StatCard label="Total Matches" value={stats?.totalMatches} />
            <StatCard label="Total Predictions" value={stats?.totalPredictions} />
            <StatCard label="Total Favorites" value={stats?.totalFavorites} />
          </div>
        </section>

        <section>
          <SectionHeading title="ESPN Sync" />
          <Card className="space-y-3 p-3">
            <p className="text-xs text-ink-2">Trigger a full scoreboard + standings sync immediately.</p>
            <Button onClick={() => void handleSync()} disabled={syncing} className="w-full">
              {syncing ? "Syncing…" : "Force ESPN Sync"}
            </Button>
          </Card>
        </section>

        <section>
          <SectionHeading title="Broadcast" />
          <Card className="space-y-3 p-3">
            <p className="text-xs text-ink-2">Send a message to all Telegram users.</p>
            <input
              className="min-h-11 w-full rounded-card border border-line bg-surface px-3.5 text-sm text-ink placeholder:text-ink-3 focus:border-volt focus:outline-none"
              placeholder="Message to broadcast…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={4096}
            />
            <Button
              onClick={() => void handleBroadcast()}
              disabled={broadcasting || !message.trim()}
              className="w-full"
            >
              {broadcasting ? "Sending…" : "Broadcast to All Users"}
            </Button>
          </Card>
        </section>
      </div>
    </>
  );
}

function StatCard({ label, value }: { label: string; value?: number }) {
  return (
    <Card className="p-3">
      <p className="text-[11px] text-ink-3">{label}</p>
      <Num className="mt-0.5 text-2xl text-ink">{value !== undefined ? value.toLocaleString() : "—"}</Num>
    </Card>
  );
}

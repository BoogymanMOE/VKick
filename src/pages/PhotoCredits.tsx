import { useEffect, useState } from "react";
import { TopBar } from "../components/TopBar";
import { useI18n } from "../i18n/context";

interface Credit {
  player_id: string;
  player_name?: string | null;
  source_url: string | null;
  author: string | null;
  license: string | null;
}

export default function PhotoCredits() {
  const { dir, t } = useI18n();
  const [credits, setCredits] = useState<Credit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/faces/credits.json")
      .then((r) => r.json())
      .then((d) => setCredits(Array.isArray(d) ? d : []))
      .catch(() => setCredits([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <TopBar title={t("profile.photoCredits")} back />
      <div className="mt-md" dir={dir}>
        {loading ? <p className="text-ink-3">Loading…</p> : null}
        {!loading && credits.length === 0 ? <p className="text-ink-3">No credits available.</p> : null}
        <ul className="space-y-2">
          {credits.map((c) => (
            <li key={c.player_id} className="rounded-card border border-line bg-surface p-2.5 text-xs">
              <div className="font-bold text-ink">{c.player_name ?? c.player_id}</div>
              <div className="text-ink-3">
                {c.author ? `© ${c.author}` : "Author unknown"} · {c.license ?? "license unknown"}
              </div>
              {c.source_url ? (
                <a
                  href={c.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-volt underline"
                >
                  source
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

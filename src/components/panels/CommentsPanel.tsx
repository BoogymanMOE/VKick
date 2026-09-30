import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, serverErrorKey, type ApiComment } from "../../lib/api";
import { useI18n } from "../../i18n/I18nProvider";
import type { StringKey } from "../../i18n/strings";
import { haptic, notifyHaptic } from "../../lib/telegram";
import { useToast } from "../Toast";
import { Button, Chip, EmptyState, Num, cx } from "../ui";
import type { Comment } from "../../types";

/** Server → view adapter: flags your own cards so they render amber. */
export function adaptComments(rows: ApiComment[], myUserId: number | undefined): Comment[] {
  return rows.map((c) => ({
    id: String(c.id),
    eventId: c.event_id !== null && c.event_id !== undefined ? String(c.event_id) : null,
    matchId: c.match_id,
    minuteDisplay: c.minute_display,
    minuteSeconds: c.minute_seconds,
    author: c.author,
    authorId: c.user_id,
    text: c.text,
    mediaLink: c.media_link,
    isMine: myUserId !== undefined && c.user_id === myUserId,
  }));
}

function ClipSheet({ url, onClose }: { url: string; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("comments.attachOpen")}
        className="w-full max-w-[420px] rounded-card border border-line bg-elevated p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-bold text-ink">{t("comments.attachOpen")}</p>
        <p className="mt-2 break-all text-xs text-ink-2" dir="ltr">
          {url}
        </p>
        <div className="mt-4 flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button
            className="flex-1"
            onClick={() => {
              window.open(url, "_blank", "noopener,noreferrer");
              onClose();
            }}
          >
            {t("comments.attachOpen")} ↗
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The crowd thread under the match timeline: pinned minute-comments with the
 * optional clip link (https-only, enforced server-side). The composer pins to
 * a timeline event when one is selected, else to a typed minute.
 */
export function CommentsSection({
  matchId,
  events,
  myUserId,
  onOpenClip,
}: {
  matchId: string;
  /** Timeline events, for the event picker and the minute defaults. */
  events: Array<{ id: string; minuteDisplay: string; label: string }>;
  myUserId?: number;
  onOpenClip?: (comment: Comment) => void;
}) {
  const { t, localize } = useI18n();
  const { push } = useToast();
  const queryClient = useQueryClient();

  const [text, setText] = useState("");
  const [mediaLink, setMediaLink] = useState("");
  const [eventId, setEventId] = useState<string>("");
  const [minuteDraft, setMinuteDraft] = useState("");
  const [clipUrl, setClipUrl] = useState<string | null>(null);

  const commentsQuery = useQuery({
    queryKey: ["comments", matchId],
    queryFn: () => api.getComments(matchId),
  });
  const comments = adaptComments(commentsQuery.data?.comments ?? [], myUserId);

  type CommentsData = Awaited<ReturnType<typeof api.getComments>>;

  const post = useMutation({
    mutationFn: (input: { text: string; eventId?: number; minuteDisplay?: string; mediaLink?: string }) =>
      api.addComment(matchId, input),
    // Optimistic: the comment appears the instant the user taps post — the
    // invalidation replaces it with the canonical row (real id) right after.
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["comments", matchId] });
      const prev = queryClient.getQueryData<CommentsData>(["comments", matchId]);
      const optimistic: ApiComment = {
        id: -Date.now(),
        event_id: input.eventId ?? null,
        match_id: matchId,
        minute_display: input.eventId
          ? (events.find((e) => String(e.id) === String(input.eventId))?.minuteDisplay ?? null)
          : (input.minuteDisplay ?? null),
        minute_seconds: null,
        user_id: myUserId ?? -1,
        text: input.text,
        media_link: input.mediaLink ?? null,
        created_at: new Date().toISOString(),
        author: "",
        author_pending: true,
      } as ApiComment;
      if (prev) {
        queryClient.setQueryData<CommentsData>(["comments", matchId], {
          comments: [...prev.comments, optimistic],
        });
      }
      return { prev };
    },
    onSuccess: () => {
      notifyHaptic("success");
      setText("");
      setMediaLink("");
      setEventId("");
      setMinuteDraft("");
      void queryClient.invalidateQueries({ queryKey: ["comments", matchId] });
      void queryClient.invalidateQueries({ queryKey: ["timeline", matchId] });
    },
    onError: (err, _input, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["comments", matchId], ctx.prev);
      notifyHaptic("error");
      push({ text: t(serverErrorKey(err) as StringKey), tone: "danger", icon: "✕" });
    },
  });

  const canPost = text.trim().length > 0 && (Boolean(eventId) || /^\d+/.test(minuteDraft.trim()));

  return (
    <div className="space-y-3">
      {/* The thread itself, minute-ordered (the server sorts). */}
      {commentsQuery.isLoading ? (
        <div className="shimmer h-16 rounded-card border border-line" />
      ) : comments.length === 0 ? (
        <EmptyState title={t("comments.empty")} hint={t("comments.emptyHint")} />
      ) : (
        <ul className="space-y-2">
          {comments.map((comment) => (
            <li key={comment.id} className="rounded-card border border-line bg-surface p-3">
              <div className="flex items-center gap-2">
                <Num className="grid h-6 min-w-[38px] place-items-center rounded-md border border-line bg-elevated px-1 text-[11px] text-ink-2">
                  {comment.minuteDisplay ?? "?"}
                </Num>
                <span
                  className={cx(
                    "min-w-0 flex-1 truncate text-[11px] font-bold",
                    comment.isMine ? "text-gold" : "text-ink-2",
                  )}
                >
                  {comment.isMine ? t("comments.you") : localize(comment.author)}
                </span>
                {comment.mediaLink ? (
                  <button
                    type="button"
                    onClick={() => (onOpenClip ? onOpenClip(comment) : setClipUrl(comment.mediaLink ?? ""))}
                    className="flex-none text-[11px] font-bold text-volt underline-offset-2 hover:underline"
                  >
                    {t("comments.attachOpen")} ↗
                  </button>
                ) : null}
              </div>
              <p className="mt-1.5 text-sm text-ink">{localize(comment.text)}</p>
            </li>
          ))}
        </ul>
      )}

      {/* Composer: pin to an event, or to any minute. */}
      <div className="rounded-card border border-line bg-surface p-3">
        <p className="mb-2 label text-ink-3">{t("comments.add")}</p>

        <label className="block">
          <span className="mb-1 block label text-ink-3">{t("comments.jumpToEvent")}</span>
          <select
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            className="min-h-11 w-full rounded-card border border-line bg-elevated px-3 text-sm font-bold text-ink"
          >
            <option value="">{t("comments.minute")}…</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.minuteDisplay}' — {e.label}
              </option>
            ))}
          </select>
        </label>

        {!eventId ? (
          <label className="mt-2 block">
            <span className="mb-1 block label text-ink-3">{t("comments.minute")}</span>
            <input
              value={minuteDraft}
              onChange={(e) => setMinuteDraft(e.target.value)}
              inputMode="numeric"
              placeholder="57"
              className="min-h-11 w-full rounded-card border border-line bg-elevated px-3 text-sm font-bold text-ink placeholder:text-ink-3"
            />
          </label>
        ) : null}

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder={t("comments.placeholder")}
          className="mt-2 w-full resize-none rounded-card border border-line bg-elevated p-3 text-sm text-ink placeholder:text-ink-3 focus-visible:outline-2 focus-visible:outline-volt"
        />
        <div className="mt-1 flex items-center justify-between">
          <span className="text-[10px] text-ink-3">
            {t("comments.media")}: {t("comments.mediaHint")}
          </span>
          <Num className="text-[10px] text-ink-3">{text.length}/500</Num>
        </div>
        <input
          value={mediaLink}
          onChange={(e) => setMediaLink(e.target.value)}
          type="url"
          dir="ltr"
          placeholder="https://…"
          className="mt-1 min-h-11 w-full rounded-card border border-line bg-elevated px-3 text-sm text-ink placeholder:text-ink-3 focus-visible:outline-2 focus-visible:outline-volt"
        />

        <Button
          className="mt-3 w-full"
          disabled={!canPost || post.isPending}
          onClick={() => {
            haptic("medium");
            post.mutate({
              text: text.trim(),
              eventId: eventId ? Number(eventId) : undefined,
              minuteDisplay: eventId ? undefined : minuteDraft.trim() || undefined,
              mediaLink: mediaLink.trim() || undefined,
            });
          }}
        >
          {post.isPending ? t("common.loading") : t("comments.post")}
        </Button>
      </div>

      {clipUrl ? <ClipSheet url={clipUrl} onClose={() => setClipUrl(null)} /> : null}
    </div>
  );
}

/** Small count chip for headers/cards: the crowd-thread size at a glance. */
export function CommentCountChip({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <Chip tone="gold">
      💬 <Num>{count}</Num>
    </Chip>
  );
}

# Vkick — full visual + UX audit (production build)

**Date:** 2026-10-26 · heuristic evaluation by a senior product designer + senior frontend engineer
**Build audited:** `39d645d` — "Profile polish: club slots, grouped settings, invite card, FA release notes"
**Target:** the production build (`npm run build` → `dist/` served by the Express server, the same path Render uses), not the dev server.
**No source code was changed.** Everything below is a finding, not a fix.

---

## 0. Pre-flight

### 0.1 The commit you named is not origin/main

The brief says "origin/main HEAD (fbb9c91)" and asks the pre-flight to print a hash "must be fbb9c91". That is not what this repository contains:

```
$ git log -1 --format='%H %s' origin/main
39d645d76077513c3ca20d1af340ff9c0273a311 Profile polish: club slots, grouped settings, invite card, FA release notes

$ git log -1 --format='%H %s' fbb9c91
fbb9c914bed44d33049a19b719299a92cae664c0 fix(layout): full-bleed header band, drop the weird live-group hairline

$ git branch -a -v
  fix/fullbleed-header-and-group-hairline fbb9c91 [behind 6]
* ui-polish-pass                          df699b4 [ahead 5]
  remotes/origin/main                     39d645d
```

`fbb9c91` is an **ancestor** of origin/main, six commits back, sitting on the branch `fix/fullbleed-header-and-group-hairline`. Auditing it would audit code that is not deployed. The working branch `ui-polish-pass` is five commits *ahead* of origin/main and is also not deployed.

**Decision taken:** I audited **origin/main = `39d645d`**, because the request was "the PRODUCTION BUILD … at origin/main HEAD" and `autoDeploy: true` in `render.yaml` means origin/main is what Render ships. I did this in a separate `git worktree` (`d/audit-main`) so your working tree was untouched. If you specifically wanted `fbb9c91`, this report does not describe it — re-run the same harness against that hash.

`git status` at the end of this session is unchanged from the start (plus this file).

### 0.2 Build

```
$ npm run build
✓ built in 2.58s
EXIT=0
```

### 0.3 Served through the real production path

`node dist-server/server/index.js` (the `startCommand` in `render.yaml`), `NODE_ENV` unset locally, `PORT=8791`.

```
$ curl -i http://127.0.0.1:8791/health
HTTP/1.1 200 OK
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Content-Type: application/json; charset=utf-8
Content-Length: 22

{"ok":true,"uptime":9}

$ curl -i http://127.0.0.1:8791/
HTTP/1.1 200 OK
Cache-Control: no-cache
Content-Type: text/html; charset=utf-8
Content-Length: 7619

<title>Vkick</title>
```

**No build stamp.** `index.html` carries no commit/hash meta tag, and `vite.config.ts` / `index.html` / `server/index.ts` contain no `GIT_COMMIT`/`BUILD_STAMP` reference at this commit:

```
$ grep -rn "GIT_COMMIT|BUILD_STAMP|buildStamp" vite.config.ts index.html server/index.ts
(no matches)
```

So the build-stamp feature from the earlier task **did not land** at origin/main. You cannot tell from a running deploy which commit it is. (There is a `test/matchcardcenter-wiring` branch with a test named "edge rule, build stamp and gutter switch" — the test exists, the feature does not.)

### 0.4 Deploy config

`render.yaml` (project root): one web service `vkick`, `runtime: node`, `rootDir: .`, `buildCommand: npm install && npm run build`, `startCommand: node dist-server/server/index.js`, `healthCheckPath: /health`, `autoDeploy: true`, `numInstances: 1`, a 1 GB disk at `/var/data` with `SQLITE_PATH=/var/data/matchday.db`, `NODE_ENV=production`, `NODE_VERSION=22.20.0`, `RETENTION_DAYS=120`, nightly in-process backup to `/var/data/backups`.

Confirmed: Render builds `dist/` (client) **and** `dist-server/` (server) in the same `npm run build`, then starts the compiled server which mounts `dist/`. There is no separate static host.

### 0.5 What could not be run

| Check | Status |
|---|---|
| Real Telegram Mini App (Android webview, safe-area insets, `initData`, swipe-to-close) | **not run** — no Telegram client in this environment. Safe-area values are `0` in headless Chrome, so every `pad-safe-*` measurement below is the *fallback* value, not the on-device value. |
| Playwright | **not installed** (`ls node_modules/.bin | grep playwright` → empty). Not a blocker: I drove the installed Chrome 155 through the DevTools Protocol directly (`node:.../harness.mjs`, dependency-free). All measurements below are real CDP measurements, not Playwright output. |
| Lighthouse cold-cache perf | **partially run** — Lighthouse 12 attached to a pre-seeded Chrome (`--port=9222`). Because the page was already warm, `network-requests = 1` and `total-byte-weight = 12 KiB`; the **performance score is warm-cache** and is therefore optimistic. Cold numbers come from the CDP navigation timeline in §D. |
| Vite dev-server comparison | **not run** — irrelevant; the brief asked for prod. |

---

## A. Visual surface audit

Twelve captures, all from the production bundle, all with the mocked feed described below. Files are in `.ui-shots/audit/` (gitignored).

| File | Viewport | Language |
|---|---|---|
| `394x853@1.5-fa-feed-top.png` | 394×853 @1.5× | FA |
| `394x853@1.5-fa-feed-bottom.png` | 394×853 @1.5× | FA (scrolled) |
| `394x853@1.5-en-feed-top.png` | 394×853 @1.5× | EN |
| `394x853@1.5-en-feed-bottom.png` | 394×853 @1.5× | EN (scrolled) |
| `360x640@1-fa-feed-top.png` | 360×640 @1× | FA |
| `360x640@1-fa-feed-bottom.png` | 360×640 @1× | FA (scrolled) |
| `360x640@1-en-feed-top.png` | 360×640 @1× | EN |
| `360x640@1-en-feed-bottom.png` | 360×640 @1× | EN (scrolled) |
| `390x844@3-fa-feed-top.png` | 390×844 @3× | FA |
| `390x844@3-fa-feed-bottom.png` | 390×844 @3× | FA (scrolled) |
| `390x844@3-en-feed-top.png` | 390×844 @3× | EN |
| `390x844@3-en-feed-bottom.png` | 390×844 @3× | EN (scrolled) |

**Mock payload** (`/api/matches` intercepted over CDP `Fetch`, real API shape, all fixtures on 2026-10-26 Tehran): 1 live (Arsenal 2-1 Chelsea, `63'`), 1 half-time (Brighton & Hove Albion 1-1 Hull City), 1 finished (Man City 3-0 Everton), 4 upcoming (Newcastle–Tottenham, Gladbach–Inter, Bayern–Freiburg, Real–Napoli), 2 groups carrying 2 matches, one competition with a long label, two favourited clubs (Arsenal, Inter).

### A.0 The feed's structure does not match the brief's model — read this first

Three of the brief's assumptions are not true of this build, and reporting around them would be fiction:

1. **There are no Live / Half-time / Upcoming group headers.** The day's matches group **by competition** (`LeagueGroup` per `match.league`, sorted by your follow order then earliest kickoff — `src/pages/Matches.tsx:229-259`). The headers are `Premier League · 4 matches`, `Bundesliga · 2 matches`, `UEFA Champions League · 2 matches`.
2. **There is no per-match state-edge accent, and no per-match border at all.** `LeagueGroup.tsx` renders each match as a borderless `<li>` inside one rounded container; the file's own comment says so: *"the rows themselves carry no per-match border, shadow or edge accent"* (`LeagueGroup.tsx:12-17`). Measured: all four row borders are `0px`, `box-shadow: none`.
3. **There is no "My Teams" section on the feed.** `/my-teams` is a redirect to `/onboarding` (`App.tsx:51`), and the code comment says *"My Teams is gone"*. Favourites surface only as (a) a volt star beside a followed team's name and (b) a `My clubs` filter chip.
4. **The inline ad is not between My Teams and the live group.** It renders after the **first competition group**, and only when there are 2+ groups (`Matches.tsx:676`).

The one state that *is* colour-coded per row is the left/right time column: coral minute for live, muted "FT" for finished, ink clock for upcoming. Half-time is supposed to be gold — see **A.5, finding 1**: it never renders.

### A.1 Header band (394 CSS px, FA)

| Property | Measured |
|---|---|
| Band left/right edge | `x=0` … `right=394` — **full-bleed**, no inset |
| Band height | `83.22px` |
| Hairline | `border-bottom: 1px` `rgb(42,77,68)` at `y=83.22`, spans the full 394 |
| Horizontal padding | `16px` left and right on the inner row (`--space-page-x`) |
| Vertical padding | inner row `padding-top: 8px`, `padding-bottom: 16px` |
| Sticky | `position: sticky`, `top: 0`, `z-index: 20`, bg 95 % opaque |
| Title (FA) | `x=68 → 378`, `22px` / 700, right-anchored |
| Title (EN) | `x=16 → 326`, left-anchored |
| Action button | 40×40 calendar circle at `x=16 → 56` (FA, i.e. the visual **left**), `x=338 → 378` (EN) |

The band is genuinely full-bleed at every width ≤ 480 — this is the fix from `fbb9c91` working. The title/subtitle block is `min-w-0 flex-1 truncate`, so the subtitle `دوشنبه ۲۶ اکتبر · ۸ مسابقه · ساعتها به وقت تهران` truncates rather than wrapping. At 360 the subtitle still fits on one line; at a large user font scale it will ellipsis (not tested here).

**Gutter asymmetry (visible, low severity):** the calendar button's visual circle is 40 px but its parent sits flush at the 16 px gutter, so the *ink* gap on that side is 16 px while the title's ink sits 16 px from the opposite edge — the button reads slightly tighter to the edge than the title does, because the 40 px circle is inset 0. At 394 it is 3-4 px of optical difference; it is not a defect, just not optically centred.

**Ghosting under the sticky band (medium, clearly visible):** the header's background is `bg-base/95` — 5 % transparent (`TopBar.tsx:41`), intentionally, to avoid a backdrop filter. Scrolled content therefore shows *through* the band: in `394x853@1.5-en-feed-bottom.png` the words `Man City` are legible behind the `Matches` title, and the FA equivalent shows `منچستر سیتی` behind `مسابقات`. The tab bar has the same `bg-base/95` (`TabBar.tsx:30`) and shows the next row through it. It reads as a rendering glitch, not as depth.

### A.2 Date strip

| Property | 394 | 360 |
|---|---|---|
| Chips | 7 | 7 |
| Chip width | `48.28px` | `43.42 – 43.44px` |
| Chip height | `56px` | `56px` |
| Gap | `4px` (`gap-1`) | `4px` |
| Total row | `362px` = content width | `328px` = content width |
| Top margin | `12px` under the header hairline (`mt-3`) | same |

- **Selected chip contrast:** background `#1fbfa0`, text `#081613` → **7.95:1**. Passes AA comfortably and the dark-on-volt inversion is consistent with every other volt surface.
- **Unselected chip:** text `#7b958c` on base `#0a0f0d` → **6.00:1**; border `#2a4d44` → 1.72:1 against the base (decorative, see A.6).
- **Dots: two different meanings share one 4×4 slot.** `DateStrip.tsx:158-176` renders, in priority order: `isToday` → a dot (filled `on-volt` when selected), else `hasFavorites && !isSelected` → a dot. So the "a followed club plays" dot is unreachable **on the selected day**, and the app always opens with today selected. In the mock, Arsenal *is* favourited and *is* playing today, and no favourites dot is visible anywhere on the strip — the today marker consumed the slot. On an unselected day the dot only appears if a favourited club plays (not just any fixture). Two meanings, one token, no legend, and the more useful one is invisible on first load.
- **Order:** strip reads right→left in FA (۲۵, ۲۶, ۲۷ … ۳۱), left→right in EN. Correct RTL mirroring.
- **At 360 the chips are 43.4 px wide**, under the 44 px floor. The `after:-inset-x-1` band reaches into the 4 px gap, but the band of the *neighbour* is measured first by `elementFromPoint` at 4 px out, so the effective extra width is 0 — the 44 px floor is not actually recovered at 360 (see C.2).

### A.3 Filter row and league row

- Filter chips (`همه` / `۲ زنده` / `تیمهای من`): `36px` tall visually, with `after:-inset-y-1` giving a 44 px hit band. Widths 47 / 67 / 87 px (EN: `All` / `Live 2` / `My clubs`).
- Selected chip = volt border + `volt/15` fill + volt text; unselected = `--line` border + `ink-3`.
- **The "live" chip appears only when the day has live football** and "mine" only with favourites — good, no dead filter.
- `+ Pick your leagues` sits on its own row below, 36 px tall, volt border, and is the only element in that row. In FA it is right-anchored, in EN left-anchored — correct, but it leaves a **fully empty 362 px row** whose only content is one pill, which reads as a layout bug at 394 (it looks centred-left in the screenshot because of the anchoring).

### A.4 Group header

| Property | Measured |
|---|---|
| Band height | `32px` (`py-[7px]` + 12 px text) |
| Square dot | `8×8px`, `rgb(31,191,160)`, `rounded-sm`, at the **start** edge (`x=355→363` in RTL) |
| Label | 12 px / 700, `ink-2`, `truncate`, flexes |
| Count | 11 px, `ink-3`, at the **far** edge (`بار ۴` / `4 matches`) |
| Rule below header | **none** |
| Rule between rows | `1px` `#1d2b26` (`divide-y divide-[#1d2b26]`) |
| Container | `border: 1px` all four sides, `rgb(42,77,68)`, `border-radius: 16px` |

Vertical rhythm at 394: strip bottom `151` → filter row `163` (12) → leagues row `219` (20) → first group top `276.22` (21). Inside the group: header `32` → row `69` → row `69`. The gaps are `12 / 20 / 21`, i.e. three different values for three consecutive "small gap" steps — see E.2.

The long-label case: `UEFA Champions League` fits on one line at both 394 and 360 (`لیگ قهرمانان اروپا` under FA) — no ellipsis, because the label is `flex-1 truncate` and the count is `flex-none`. **The gameweek/round is never rendered on the feed**: my mock carried `round: "Group Stage - Matchday 6"` on those two matches and it appears nowhere in the header or the row — `round` is only consumed by MatchDetail. So the brief's "very long league+gameweek meta" cannot be exercised on this screen; the worst real case is a ~22-character competition name, which fits.

### A.5 Match rows

| Property | Measured (394) |
|---|---|
| Row box | `360 × 69px` |
| Border, all four sides | `0px` — none |
| State-edge accent | **none exists** |
| Box shadow | `none` |
| Padding | `px-3.5` (14px), `py-[9px]` |
| Time column | `44px` (played rows) / `46px` (upcoming, longer clock); right-anchored in RTL |
| Team column | `flex-1`, right-anchored in RTL / left in EN |
| Score column | `9.41px` wide (one digit), anchored to the *opposite* edge from the time |
| Team names + crests | crest `22×22`, name start `x=118` on every line — **aligned** (verified against real API data, not just the mock) |
| Time block centre | `dx = +144px` from the row centre (RTL) / `−144` (EN); `dy = 0` (vertically centred) |

The time/score block is therefore **not dead-centre** — it is edge-anchored, which is the conventional match-row layout, but it directly contradicts the brief's "time/score block dead-centre" expectation. If the intent was a centred spine, this is a design change, not a bug.

**Finding 1 (high) — half-time renders as live.** The mock's half-time row (Brighton 1-1 Hull) shows a **coral live dot and no text at all** in the time column, with the accessible name `برایتن 1-1, هال 1, زنده` ("Brighton 1-1, Hull 1, live"). The gold `نیمهوقت` / `Half-time` branch exists but is unreachable:

```tsx
const isHalftime = match.isHalftime === true;   // :88
const isLive = match.status === "live";         // :89
…
{isLive ? (                                      // :136  ← wins
   …
 ) : isHalftime ? (                              // :146  ← dead
   <span className="… text-gold">{t("matches.groupHalftime")}</span>
```

`matchFromApi` folds `halftime` into `status: "live"` *and* sets `isHalftime: true` (`useApi.ts:37,67`), so `isLive` is always true for a half-time match and the gold label never paints. A user cannot tell a team is in the dressing room from a team that is playing. This is the single most user-visible defect in the feed.

**Finding 2 (high) — the row's accessible name is malformed.** `LeagueGroup.tsx:110`:

```
`${home} ${homeScore}-${awayScore}, ${away} ${awayScore}, ${status}`
```
→ `Arsenal 2-1, Chelsea 1, live 63`. The home score is spoken as a range, the away score twice, the words are English ("live") while the visible UI is Persian, the digits are Latin while the visible score is Persian, and a half-time match is announced as "live". Lighthouse flags exactly this class of problem (see C.4).

**Finding 3 (medium) — row dividers are effectively invisible.** `divide-[#1d2b26]` against the card surface `#0e2520` is **1.09:1**. On a phone at 1× the 1 px line is not perceivable; the four rows read as one bubble. It is also a hard-coded colour that matches no token.

### A.6 Containers, borders, hairlines

- Card border `#2a4d44` on surface `#0e2520` = **1.72:1**. As decoration this is legal, but the card edge is the only thing separating the group from the page, so the grouping reads as a faint tint rather than a card. At 394 it is legible; at 360 on a dim screen it is close to invisible.
- The header hairline (`#2a4d44`, 1.72:1 against base) is the most visible rule on the screen, which is inverted from normal hierarchy (structure should be quieter than content).

### A.7 Inline ad

| Property | Measured |
|---|---|
| Slot | `362 × 60px` at `y=600` (after group 1) |
| Slot surface | `--elevated`, `rounded-card`, `overflow-hidden`, `max-height: 60px` |
| Label | `تبلیغ` / `Ad`, `min-w-[30px]`, 10 px, `ink-3` on a `--surface` pill |
| Iframe | `312 × 48px` |
| Rendered creative | a **white** panel with blue text — the only bright white surface in the entire app |

The ad is the loudest element on the feed: a 362×48 white block on a near-black page, immediately above the second competition group. The `colorScheme: "dark"` hint on the iframe does not stop the network's creative from painting white. It is also the heaviest network object on the page (see D.3).

### A.8 Tab bar

| Property | Measured |
|---|---|
| Bar | `x=0 → 394`, `y=784 → 853`, height `69px` — **full-bleed**, `border-top: 1px` |
| List | `ul` at `60px` tall with `padding: 4px 8px`; the bar's own `padding-bottom` is `8px` (`pad-safe-bottom`) |
| Tabs | 3 × `126 × 56px` |
| Active background | `--elevated` at 70 % (`oklab(… / 0.7)`), radius 12 px |
| Active text | `#1fbfa0` on the elevated fill → ~7:1 |
| Inactive text | `#93aea6` → ~6:1 |
| Shape cue | 24 × 3 px volt bar at the top of the active tab, plus icon `scale(1.05)` |
| Labels | **visible** on all three (`مسابقات` / `جدول` / `پروفایل`) — not icon-only |

Safe-area: `env(safe-area-inset-bottom)` resolves to `0` here, so the bar is 69 px. On a real Telegram Android device with a gesture bar it will be ~90–95 px; `AppShell` measures the bar with a `ResizeObserver` and writes `--bottom-nav-h`, so the content padding follows. **Untested on-device.**

### A.9 Things that look off, literally

1. **Half-time row has a red pulsing dot and no label** (§A.5 finding 1).
2. **The ad's white creative** is the brightest thing on the page and sits mid-feed.
3. **`+ Pick your leagues` occupies a whole row by itself**, right-anchored, leaving 300 px of dead space at 394.
4. **Scores sit at the extreme opposite edge from the team names** (`x≈31` vs `x≈307` at 394 RTL). Scanned at a glance, "2" and "1" are far from "آرسنال / چلسی" — a 270 px saccade to pair a score with a team.
5. **The `4 matches` count repeats** the same information the header subtitle already gives ("۸ مسابقه"), and the header subtitle's count is *the day's* count while the group count is *the competition's* — two numbers that look like the same number.
6. **`Tottenham` renders in Latin inside a Persian UI** while every other club is translated. Not a bug per se (`names.ts` has no Persian for it), but it is the one un-translated string on the screen and it lands on the longest-name row.
7. **At 360 the last row is clipped by the tab bar** in the top-of-page capture — expected for a fixed bar, but the visible sliver of `Tottenham` under a translucent bar reads as a rendering glitch.
8. **Live minute `۶۳′`** is the only coral text on the row, and it sits at the far end from the score — the two live signals (dot/minute at one edge, score at the other) are 300 px apart.
9. **Content ghosts through the sticky header and tab bar** (`bg-base/95`): `Man City` is legible behind the `Matches` wordmark in the scrolled EN capture.
10. **Mixed clock formats in EN on the same screen**: every row clock is 24-hour (`19:30`, `20:00`, `21:00`) but the footer says `Data as of 07:20 PM`. Row clocks pass `hour12: false` (`LeagueGroup.tsx:29`); the footer's `formatClock` does not (`lib/format.ts:14-16`). Persian is unaffected (fa-IR never emits a day period), which is why the bug only shows in EN.

---

## B. Heuristic evaluation (Nielsen + mobile)

Scores: 1 = broken, 3 = usable with friction, 5 = exemplary.

| # | Heuristic | Score | Evidence |
|---|---|---|---|
| 1 | Visibility of system status | **3** | Live dot + minute work; skeletons (`LeagueGroupSkeleton`) on first load; `ErrorState`/`EmptyState` exist; the footer states data age honestly ("دادهها تا ۱۹:۲۰" matched the server's `latestLastSyncedAt`). But **half-time is invisible as a state** (§A.5), the data-age line is 11 px `ink-3` at the very bottom of the feed (below the fold on every device), and there is no "this list is stale" mark on the rows themselves. |
| 2 | Match between system and real world | **3** | Persian copy is good (`مسابقه`, `نیمهوقت`, `زنده`, ZWNJ handled, digits localised, `در برابر` for the versus form). **But the app runs two calendars at once**: the strip and header render **Gregorian** day/month under FA (`calendar: "gregory"`, `DateStrip.tsx:105`, `Matches.tsx:286`) — `۲۶ اکتبر` — while `CalendarSheet` renders **Solar Hijri** (`۴ آبان`, `JALALI_MONTHS_FA`, `CalendarSheet.tsx:7-13,19-25`). An Iranian user picking ۴ آبان from the sheet lands on a strip chip that says ۲۶ اکتبر. That is not a preference, it is two answers to the same question. |
| 3 | User control and freedom | **4** | Back button appears only on sub-routes and falls back to `/matches` on first entry instead of exiting the mini app (`TopBar.tsx:22-31`); the pick banner's dismiss is persisted (`PICK_BANNER_KEY`); sheets close on backdrop; pull-to-refresh re-syncs. Missing: no undo after adding/removing a favourite, and no way to clear the league filter except tapping `All`. |
| 4 | Consistency and standards | **4** | Logical properties are used almost everywhere — only **2** physical-class violations in `src/` (§E.3). Icon set is one family (`icons.tsx`, stroke-based). Colour semantics hold: coral = live only, volt = primary/selected, gold = evaluative. Two blemishes: `text-black` (6 sites) vs `text-on-volt` (DateStrip) for the same dark-on-volt ink, and the divider `#1d2b26` (§E.1). |
| 5 | Error prevention | **3** | Login validates inline (`nameError`, username/password shapes) and distinguishes `429` from a bad password (`api.ts:91`); prediction-window enforcement exists (`lib/predictionWindow.ts`) but predictions are **off**, so the rule is unreachable. Feed-level: a group with zero matches cannot render (`LeagueGroup` returns null), an empty day offers the next matchday. |
| 6 | Recognition rather than recall | **4** | Tab labels are visible text, group headers are visible, the date strip shows the week without a picker. Weak spots: no recently-viewed teams, no "my teams" shelf (removed), and the two dot meanings on the strip have no legend. |
| 7 | Flexibility and efficiency | **3** | Deep links `/matches?league=eng.1` scope the feed and offer a "show all" escape; the calendar jumps months; `My clubs` filters the day. But the **language toggle is not on the feed** — it lives in Profile (`Profile.tsx:239`) and on Login only, so a Persian user who lands on an English feed needs Profile → language. No swipe-between-days. |
| 8 | Aesthetic and minimalist design | **4** | The feed is disciplined: one card per competition, one accent per state, no shadows, no gradients in the list. Deductions: the white ad (§A.7), the empty league row (§A.9.3), and the duplicated match count (§A.9.5). |
| 9 | Help users recognise/recover from errors | **4** | `ErrorBoundary` wraps the app (`main.tsx:86`), `ErrorState` offers retry, `EmptyState` offers the next matchday, and stale data is labelled (`matches.syncDelayed` after 30 min). No offline-specific UI, and a failed *refetch* over cached data is silent (by design — `hasFeedError` only fires with no cache). |
| 10 | Help and documentation | **2** | Onboarding exists (3 steps) and is the only explainer. `RulesSheet` is mounted only from `Leaderboards.tsx` and `PredictionsHub.tsx` — with `PREDICTIONS_ENABLED = false` the Predictions hub is not reachable, so the rules are unreachable from the feed and from Profile. There is no help/FAQ entry anywhere in Profile (its rows are notifications, leagues, language, haptics, reset, privacy, terms). |

---

## C. Accessibility audit

### C.1 Colour contrast — PASS

62 text nodes probed with `getComputedStyle` + an alpha-composited background walk at 394 FA. **Zero WCAG AA failures.** Lowest five:

| Text | Colour | Background | Ratio | Needs |
|---|---|---|---|---|
| `۴ بازی` (group count) | `rgb(123,149,140)` | `rgb(14,37,32)` | **5.00** | 4.5 |
| `پایان` (FT) | `rgb(123,149,140)` | `rgb(14,37,32)` | **5.00** | 4.5 |
| `تبلیغ` (ad label) | `rgb(123,149,140)` | `rgb(14,37,32)` | **5.00** | 4.5 |
| `۶۳′` (live minute) | `rgb(255,90,77)` | `rgb(14,37,32)` | **5.23** | 4.5 |
| strip day/number | `rgb(123,149,140)` | `rgb(8,22,19)` | **5.75** | 4.5 |

Selected chip: `#081613` on `#1fbfa0` = **7.95**. Active tab: volt on elevated ≈ **7**. Inactive tab: `#93aea6` on base ≈ **6**. The palette has real headroom; `ink-3` at exactly 5.00 on the card surface is the tightest token and any darkening of `--surface` would break it.

Not enforced (decorative, WCAG 1.4.11 does not strictly apply): card border **1.72:1**, row divider **1.09:1**.

### C.2 Touch targets

| Viewport | Interactive elements | Under 44×44 |
|---|---|---|
| 394×853 | 24 | **0** (excluding the skip link) |
| 390×844 | 24 | **0** (excluding the skip link) |
| 360×640 | 24 | **5** |

- The skip link (`پرش به محتوا` / `Skip to content`) measures 1×1 — it is `sr-only` until focused, so it is correctly exempt.
- **At 360, five of the seven date chips measure 43.42–43.44 px wide.** The intended `after:-inset-x-1` band is present but the neighbour's band starts in the same 4 px gap, so `elementFromPoint` 4 px outside returns the neighbour: the effective width stays 43.4. On the narrowest supported phone the chips sit 0.6 px under the floor.
- Filter chips are 36 px tall visually with a 44 px band that *does* work (measured `effH = 44`).
- Everything else (tabs 56, calendar 40+band→48, rows 69) passes.

### C.3 Focus visibility — PASS

14 Tab presses through the feed; every stop reports `:focus-visible` true with `outline: 2px solid` in volt (`rgb(31,191,160)`):

skip link → calendar → 7 date chips → All → Live 2 → My clubs → Pick your leagues → first match row. No unlabeled or invisible stop. (`Table.tsx` and the sheets were not tabbed through — out of scope of the feed.)

### C.4 Accessible names

- **Zero** interactive elements without an accessible name (`a, button, input, select, textarea, [role=button]` scanned).
- **Lighthouse `label-content-name-mismatch` fails on 9 nodes** — WCAG 2.5.3 (Label in Name):
  - 7 date chips: `aria-label="یکشنبه ۲۵ اکتبر"` while the visible text is `ی` + `۲۵`. The digits appear in the label; the weekday letter does not, so the label does not contain the visible name.
  - 2 match rows: `aria-label="پاری سنتژرمن در برابر لیون, ۲۳:۰۰"` while the visible text is `۲۳:۰۰ PSG Lyon`. The club names are localised in the label but the visible ones are the short names — the strings do not contain each other.
- Row labels additionally mis-report the score (§A.5 finding 2) and call half-time "live".

### C.5 `prefers-reduced-motion` — PASS

With `Emulation.setEmulatedMedia({prefers-reduced-motion: reduce})`, computed `animation-duration` is **0.001s** on `main` (`page-in`), `.list-in`, `nav a`, and `header`, and `.live-dot` is `animation: none`. Explicit overrides exist for the dot's rings, the skeleton shimmer, the goal flash, the intro and the day-swap (`index.css:272-279, 301-305, 349-357, 382-385, 405-408`). The live dot's `::before`/`::after` rings are included by selector, so the pulse is genuinely removed, not just shortened.

### C.6 Persian RTL — mostly PASS

- `dir="rtl"` on `<html>`, `direction: rtl` computed on `body`, no horizontal overflow at any of the three widths (`scrollWidth === innerWidth`).
- Header, strip, filter row, group headers, rows and tab bar all mirror correctly.
- Deliberate `dir="ltr"` islands are correct: clocks/minutes (`LeagueGroup.tsx:135`), match-detail kickoff/minute (`MatchDetail.tsx:264,286,321`), pitch (`PitchView.tsx:173,250`), form strips (`Table.tsx:445`), phone/password inputs (`Login.tsx:139,168`).
- **One suspect:** `CommentsPanel.tsx:26` wraps a user comment in `<p dir="ltr">` (and `:227`). For a Persian comment that forces Latin word order. Not reachable with ratings off, so not observed live.
- Physical utilities that break RTL: `Skeletons.tsx:226` (`ml-auto`) and `Table.tsx:640` (`text-right`) — see E.3.

---

## D. Performance

### D.1 Lighthouse 12 (mobile, 394×853 @1.5×, Persian feed, simulated throttling)

| Category | Score |
|---|---|
| Performance | **100** |
| Accessibility | **100** |
| Best Practices | **61** |
| SEO | **100** |

Metrics: FCP `0.6s`, LCP `1.1s`, TBT `0ms`, CLS `0.006`, Speed Index `0.6s`.

**Caveat, stated plainly:** this run attached to an already-warm Chrome (`--port=9222`), so `network-requests=1` and `total-byte-weight=12 KiB` are cache artefacts and the 100 is optimistic. Treat it as "no field-visible regression on a warm cache", not as a cold-load score.

Best-Practices failures (2 of 4 are environment artefacts):
- `is-on-https` — localhost; not a real finding.
- `third-party-cookies` — **real**: the A-ADS iframe sets `1` and `USER_ID` cookies.
- `label-content-name-mismatch` — **real**, 9 nodes (C.4).
- `inspector-issues` — 1, from the ad iframe.

Top opportunities Lighthouse reports: **none above 2 ms** — `server-response-time` is the only opportunity entry and it is "root document took 0 ms". There is no ranked opportunity list to print because the page is already fast. The measured diagnostics: unused CSS **17 KiB**, main-thread work `0.9s`, JS execution `0.3s`, DOM `144` elements.

### D.2 Bundle

`npm run budget`:

```
bundle budget: JS total 156.7KB / 200.0KB · biggest react-Cg5GnsXt.js 50.8KB / 60.0KB · CSS total 13.6KB / 20.0KB
bundle budget: OK
```

| Chunk | On disk | Gzip |
|---|---|---|
| `react-*.js` (vendor) | 155.0 KB | 50.8 KB |
| `index-*.js` (shell + router + Login) | 141.6 KB | 45.4 KB |
| `query-*.js` (react-query) | 48.2 KB | 15.2 KB |
| **`Matches-*.js`** | **24.6 KB** | **8.8 KB** |
| **`MatchDetail-*.js`** | **29.9 KB** | **9.6 KB** |
| `index-*.css` | 76.9 KB | 13.9 KB |

All inside budget. The per-chunk ceiling (60 KB gzip) is only 9 KB away from being breached by `react` — that is the number to watch, not the total.

### D.3 Cold load (CDP navigation timeline, localhost, prod bundle)

| Metric | Value |
|---|---|
| TTFB | `4 ms` |
| First paint / FCP | `28 ms` |
| LCP | **`132 ms`** — the largest element is the footer hint paragraph (the feed rows are smaller text nodes) |
| CLS | `0` |
| Worst long task (LoAF) | **`66 ms` at t=444 ms** (>50 ms) |

Slowest resources: **`publisher.json?ver=3.1.33` at 1596 ms**, `?size=Adaptive` (the ad iframe) at 784 ms, `loader.core.js` at 683 ms — all three are the ad network. The app's own payload: `matches.json` 46.9 KB in 21 ms, fonts 15–22 KB each.

**The ad is the slowest thing on the page by an order of magnitude**, and its iframe has no `loading="lazy"` (`InlineAd.tsx:29-44`), so it starts loading on first paint even though it sits below the fold. Adding `loading="lazy"` is a one-line change that removes ~1.6 s of third-party work from the critical path.

---

## E. Code-level smells (read from source, no browser)

### E.1 Hard-coded colours that should be tokens

`rg "text-(black|white|#|gray|red|green|blue|amber)" src/` → 6 hits, all `text-black` on a volt surface:

| File:line | Verdict |
|---|---|
| `src/components/ui.tsx:425` | volt primary button — should be `text-on-volt` |
| `src/pages/Matches.tsx:603` | pick-banner CTA — should be `text-on-volt` |
| `src/pages/Table.tsx:143` | selected tab — should be `text-on-volt` |
| `src/components/ErrorBoundary.tsx:74` | retry button — should be `text-on-volt` |
| `src/components/panels/LineupPicker.tsx:69` | selected player — should be `text-on-volt` |
| `src/components/panels/LineupsPanel.tsx:98` | shirt-number chip — should be `text-on-volt` |

There **is** an `--on-volt` token, and `DateStrip.tsx:158` uses `text-on-volt`. So the app has two inks for the same surface: pure black and `#081613`. Not visible at a glance, but it is drift.

Also off-token: **`LeagueGroup.tsx:215` `divide-y divide-[#1d2b26]`** — a literal hex that matches no token, and at 1.09:1 it is the invisible divider from A.5.

### E.2 Hard-coded spacing that should be `--space-*`

15 hits in the five named files. The project defines a named scale (`--space-xs/sm/md/lg/xl/2xl` in `tokens.css:64-69`, exposed to Tailwind as `--spacing-*` in `index.css:41-46`), and then bypasses it:

| File:line | Utility | Token that exists |
|---|---|---|
| `Matches.tsx:438` | `mt-3` (12px) | `mt-md` |
| `Matches.tsx:667` | `mt-4` (16px) | `mt-lg` |
| `Matches.tsx:46` | `px-3.5` (14px) | no token — 14px is off-scale |
| `Matches.tsx:568` | `gap-2`, `px-4`, `py-3` | `gap-*` / `--space-lg` |
| `Matches.tsx:580,594,603,650` | `gap-2`, `px-3`, `px-4`, `px-5` | scale |
| `LeagueGroup.tsx:36` | `gap-2`, `px-3.5`, `py-[7px]` | `py-[7px]` is an arbitrary value, off-scale |
| `LeagueGroup.tsx:130` | `gap-3`, `px-3.5`, `py-[9px]` | arbitrary values |
| `TopBar.tsx:44` | `gap-3`, `pb-4`, `pt-2` | `--space-lg` / `--space-sm` |
| `TopBar.tsx:86` | `gap-1.5`, `px-3` | — |
| `TabBar.tsx` | `px-2`, `gap-1` | — |
| `AppShell.tsx:95` | `mt-4` | `mt-lg` |

The visible symptom is A.4's `12 / 20 / 21` gap sequence: three consecutive steps that should all be "one step" are three different numbers because some are tokens and some are raw Tailwind.

### E.3 Logical vs physical Tailwind

`rg "text-(left|right)|\b(ml|mr|pl|pr)-" src/` → **2 violations**:

- `src/components/Skeletons.tsx:226` — `ml-auto` → `ms-auto`
- `src/pages/Table.tsx:640` — `text-right` → `text-end`

Both break under RTL (the skeleton bar sits on the wrong side; the table cell right-aligns instead of aligning to the start edge). This is otherwise a clean result — the codebase is ~99 % logical-property.

### E.4 `any`

```
rg ": any\b|<any>|as any" src/  →  0 matches
```

Zero. The types are honest (`types.ts` is a real view-model layer).

### E.5 `TODO | FIXME | XXX | HACK`

```
rg "TODO|FIXME|XXX|HACK" src/  →  0 matches
```

Zero markers. (The long explanatory comments are documentation, not debt markers.)

### E.6 Dead exports

280 exported symbols; **55 are never imported by another file**. Excluding the feature-flag-off surfaces (`PredictionsHub`, `RatingsSkeleton`, `StreakWidget`, `RatingSlider`, `PitchView`, `LINEUP_GATED`, `justPaidOut` — expected while the flags are false), the genuinely-unreferenced set includes:

`ClubFixtureCard` (`ClubCard.tsx`), `Countdown`, `FallbackCard`, `ShareIcon`/`StarIcon`/`TableIcon`/`LockIcon` (`icons.tsx`), `PickerTabs`, `CommentsSection` + `CommentCountChip`, `ProgressBar`, `PredictionIcons`, `teamNamesFa`, `personNamesFa`, `LANG_LABEL`, `getPersistentToken`, `getEphemeralToken`, `markLoggedOut`, `roundRank`, `orderRounds`, `copyToClipboard`, `isRetryableAnchorError`, `recordFlipFirst`, `formatKickoffShort`, `formatDayHeader`, the whole `formations.ts` helper set (10 exports), `leagueKindsForFilter`, `COMPETITION_NAMES`, `humanizeSlug`, `OTHER_GROUP`, `PICKER_GROUPS`, `telegramUser`, `shareToTelegram`, `normalizeTelegramUrl`, `cellCenter`, `zoneForFieldPosition`, `LegalPage`.

Caveat: my scanner counts *cross-file* imports, so a symbol exported and used only inside its own file (`MatchRow`, `dayKey`, the auth getters) is listed but is not strictly dead — it should simply not be exported.

### E.7 Files over 400 lines

```
846 src/pages/MatchDetail.tsx
697 src/pages/Matches.tsx
668 src/pages/Table.tsx
656 src/pages/Profile.tsx
636 src/pages/TeamPage.tsx
597 src/pages/Onboarding.tsx
458 src/components/TimelineList.tsx
969 src/components/ui.tsx
```

Candidates for splitting: **`ui.tsx` (969)** — it is a grab-bag of Button/Sheet/Num/Badge/EmptyState/ErrorState and everything imports from it, so it is in the initial chunk; **`MatchDetail.tsx` (846)** — score header, timeline, stats, lineup and rating panels already live in `panels/`, so there is likely more to extract; **`Matches.tsx` (697)** — the filter rows, the empty state and the group list are three separable concerns.

### E.8 `react-hooks/exhaustive-deps` — 5 warnings in `src/`

No inline disables exist (`rg -l "react-hooks/exhaustive-deps" .` → no matches). I ran ESLint directly:

```
$ npx eslint . --format json
33 errors, 6 warnings
```

Those totals are misleading: **30 of the 33 errors and 1 of the warnings are in `.tpm/*.cjs`** scratch scripts (`no-undef` × 29 for Node globals, `no-require-imports` × 2, one unused var). In `src/` there are exactly **8** problems:

| File:line | Rule | Message |
|---|---|---|
| `hooks/useFavorites.ts:56` | exhaustive-deps | `useMemo` missing deps `add` and `setAnchor` |
| `pages/MatchDetail.tsx:168` | exhaustive-deps | `useMemo` missing dep `nf` |
| `pages/Matches.tsx:251` | exhaustive-deps | `useMemo` has an **unnecessary** dep `dayMatches` |
| `hooks/useApi.ts:203` | exhaustive-deps | `teams` logical expression can change deps every render |
| `pages/Table.tsx:182` | exhaustive-deps | `rows` logical expression can change deps every render |
| `components/DateStrip.tsx:33` | react-refresh | file exports a non-component (`dayKey`) |
| `components/TabBar.tsx:18` | no-empty-object-type | `forwardRef<HTMLElement, {}>` — the `{}` type |

The `Matches.tsx:251` one matters for behaviour, not just lint: `leagueGroups` lists `dayMatches` in its deps while deriving from `filteredMatches`, so a memo recompute is triggered by a value it never reads.

### E.9 Hard-coded `dir="rtl" | dir="ltr"`

21 sites. The ones that should use `useI18n().dir` instead of a literal:

- `CommentsPanel.tsx:26` and `:227` — a **user-authored comment** is forced LTR. Persian comments will render with Latin word order. (Not reachable while ratings are off.)
- All others are legitimate LTR islands for numbers/times/pitch coordinates (listed in C.6).

---

## F. i18n audit

### F.1 Every string goes through `t()`

`rg "(?:>|\{)[A-Za-z][^<{]*[A-Za-z](?:<|\})" src/components src/pages` filtered against `t(` returns **no** hard-coded JSX copy. Spot checks across `Matches`, `LeagueGroup`, `TabBar`, `TopBar`, `DateStrip` confirm every label, `aria-label` and `title` is a catalog key.

Residual untranslated *data* (not copy): club names missing from `i18n/names.ts` — `Tottenham` rendered in Latin inside the Persian feed. That is a data gap, not a code gap.

### F.2 EN ⇄ FA key parity

| | Count |
|---|---|
| EN keys | 602 |
| FA keys | 603 |
| Missing in FA | **0** |
| Missing in EN | **1** — `matches.groupFinished` |

`matches.groupFinished` exists only in the FA block and is never referenced (the finished label uses `status.finished`). It is a leftover key, not a missing translation. FA coverage is complete.

### F.3 Persian text rendering / Latin inside Persian

- Scores, minutes, counts and dates all pass through `<Num>` or an explicit `fa-IR` `Intl.NumberFormat`, so digits are Persian (۲, ۶۳, ۴ بازی, ۱۹:۳۰).
- Clocks are wrapped in `dir="ltr"` so `۱۹:۳۰` does not reorder (`LeagueGroup.tsx:135`).
- **Gap:** the match row's `aria-label` mixes Latin digits and English state words into a Persian sentence (`آرسنال 2-1, چلسی 1, زنده ۶۳`). Visible text is correct; the screen-reader text is not. Same root cause as C.4.
- `fa-IR` call sites (19) were each checked: every one is either a number formatter with `useGrouping: false` or a date formatter with an explicit `calendar: "gregory"` — which is exactly the Gregorian/Jalali split in B.2.

---

## G. Data and feature flags

### G.1 Feature flags

| Flag | Client (`src/lib/features.ts`) | Server (`server/features.ts`) | `.env` |
|---|---|---|---|
| `PREDICTIONS_ENABLED` | `false` (hard-coded) | `process.env.PREDICTIONS_ENABLED === "true"` → false | absent → false |
| `RATINGS_ENABLED` | `false` (hard-coded) | same → false | absent → false |

The client flags are **literal constants**, so they cannot be flipped without a rebuild; the server twins are env-driven. That is a real divergence risk: setting `PREDICTIONS_ENABLED=true` on Render would enable server endpoints while the UI stays hidden.

UI conformity, checked in source: `Profile.tsx:324,340`, `Onboarding.tsx:50,555`, `MatchDetail.tsx:709` and `App.tsx:58` (`/ratings` → `Navigate to="/matches"`) all gate correctly. **No UI element was found that shows while its flag is off**, with one leak: `rules` is reachable only from `Leaderboards` and `PredictionsHub`; with predictions off, the *rules content* is orphaned (a help/reachability problem, not a visible-flag leak).

### G.2 League allowlist and banned-league purge

```ts
// server/espn/catalog.ts:25
export const LEAGUE_ALLOWLIST = new Set(["eng.1","esp.1","ger.1","ita.1","fra.1"]);
```

Live API check — every league returned by `GET /api/matches?limit=200`:

```
{ fra.1: 27, esp.1: 30, ita.1: 40, ger.1: 27, eng.1: 30 }
```

**No banned league leaks into the feed.** `GET /api/competitions` additionally lists three cups (`eng.league_cup`, `esp.copa_del_rey`, `uefa.champions`) — that is the cup catalog, not a banned league, and it is intentional.

`server/scripts/purgeBannedLeagues.ts` exists (`npm run purge:banned-leagues`) and was **not run** in this audit — running it mutates the database.

### G.3 Stale-data sentinel

```
GET /api/health/sync
{"latestLastSyncedAt":"2026-10-26T15:50:56.382Z","staleLive":0,"stuckLive":0,
 "liveCount":0,"scheduledCount":583,"finishedCount":256,…}
```

At the time of capture the clock was ~15:55 UTC, so the sentinel was ~4 minutes old. The feed footer printed `دادهها تا ۱۹:۲۰` (= 15:50 UTC) — **honest**. The threshold for the delayed copy is 30 minutes (`Matches.tsx:266`), and the copy switches to `matches.syncDelayed` ("دادهها بهتاخیر افتاده") past it. There is no path that prints "just now"; the line always carries a clock.

---

## H. Final summary

| # | Issue | Severity | Area | File:Line | Suggested fix | Effort |
|---|---|---|---|---|---|---|
| 1 | Half-time matches render as live: coral dot, no label, announced as "live". Gold `نیمهوقت` branch is unreachable because `isLive` is tested first. | **high** | visual/a11y | `LeagueGroup.tsx:88-89,136,146` | Test `isHalftime` before `isLive` in both the render and the `status` string | S |
| 2 | Row accessible name malformed: `Arsenal 2-1, Chelsea 1, live 63` — score as a range, away score twice, English state words, Latin digits | **high** | a11y/i18n | `LeagueGroup.tsx:109-113` | Build the label from the same localized strings the row renders, once per team | S |
| 3 | FA runs two calendars: strip/header Gregorian (`۲۶ اکتبر`), calendar sheet Solar Hijri (`۴ آبان`) | **high** | visual/i18n | `DateStrip.tsx:105`, `Matches.tsx:286` vs `CalendarSheet.tsx:7-25` | Pick one calendar for FA and use it in the strip, the header and the sheet | M |
| 4 | 9 nodes fail WCAG 2.5.3: chip and row `aria-label`s do not contain their visible text | **high** | a11y | `DateStrip.tsx:150-156`, `LeagueGroup.tsx:109` | Make the label start with the visible string | S |
| 5 | Ad iframe has no `loading="lazy"`; the ad network is the slowest resource on the page (1596 ms + 784 ms + 683 ms) | **med** | perf | `InlineAd.tsx:29-44` | `loading="lazy"` + `referrerPolicy="no-referrer"` | S |
| 6 | Row dividers are `divide-[#1d2b26]` = 1.09:1 against the card — invisible, and off-token | **med** | visual/code | `LeagueGroup.tsx:215` | Use `--line` (or a dedicated `--divider`) token | S |
| 7 | Date chips are 43.4 px wide at 360 (under the 44 px floor); the `after:` band is defeated by the neighbour's band | **med** | a11y | `DateStrip.tsx:150-176` | Drop to 6 chips at ≤360 or use `gap-2` + `after:-inset-x-0.5` on the last/first | S |
| 8 | Inline ad is the only white surface in a dark app and sits mid-feed | **med** | visual | `InlineAd.tsx:18-46` | Cap the creative with a dark matte + `mix-blend`-safe wrapper, or move below the last group | M |
| 9 | 15 spacing utilities bypass the `--space-*` scale, producing a 12/20/21 px rhythm on consecutive steps | **med** | code | `Matches.tsx:438,667`, `LeagueGroup.tsx:36,130`, `TopBar.tsx:44` | Map to `mt-md`/`mt-lg`/`gap-sm` and add a 14 px step if `px-3.5` is needed | S |
| 10 | Two physical-property utilities break RTL | **med** | code/i18n | `Skeletons.tsx:226`, `Table.tsx:640` | `ml-auto`→`ms-auto`, `text-right`→`text-end` | S |
| 11 | Language toggle not reachable from the feed (Profile or Login only) | **med** | ux | `Profile.tsx:239`, `Login.tsx:93` | Add it to the feed header overflow or a long-press on the title | S |
| 12 | Rules/help unreachable while predictions are off; no help or FAQ anywhere in Profile | **med** | ux | `Leaderboards.tsx:4`, `PredictionsHub.tsx:9` | Mount `RulesButton` in Profile next to privacy/terms | S |
| 13 | Scores and team names sit ~270 px apart at 394, so pairing a score with a team is a saccade | **med** | visual | `LeagueGroup.tsx:130-190` | Move the score next to the team name (or centre the time) | M |
| 14 | Build stamp missing: a deploy cannot be identified from its output | **med** | data | `vite.config.ts`, `index.html` | Emit `%VITE_COMMIT%` into a meta tag at build time | S |
| 15 | Scrolled content ghosts through the 95 %-opaque sticky header and tab bar | **med** | visual | `TopBar.tsx:41`, `TabBar.tsx:30` | Raise to full opacity, or add a one-layer gradient scrim | S |
| 16 | EN mixes 24 h row clocks with a 12 h AM/PM footer | **med** | i18n | `lib/format.ts:14-16` | Pass `hour12: false` in `formatClock` | S |
| 17 | `text-black` (6 sites) vs `text-on-volt` for the same dark-on-volt ink | **low** | code | `ui.tsx:425`, `Matches.tsx:603`, `Table.tsx:143`, `ErrorBoundary.tsx:74`, `LineupPicker.tsx:69`, `LineupsPanel.tsx:98` | Use `text-on-volt` | S |
| 18 | Client feature flags are literal `false` while the server reads env — they can diverge | **low** | code/data | `src/lib/features.ts:7,15`, `server/features.ts:2,23` | Read both from `import.meta.env` and validate at boot | S |
| 19 | 55 exports are never imported; ~20 are genuinely unreachable (the rest are flag-off UI) | **low** | code | various (`formations.ts`, `zones.ts`, `bracket.ts`, `icons.tsx`) | Delete or un-export | M |
| 20 | `CommentsPanel.tsx` forces `dir="ltr"` on user-authored comments | **low** | i18n | `CommentsPanel.tsx:26,227` | Use `dir="auto"` | S |
| 21 | `ui.tsx` (969), `MatchDetail` (846), `Matches` (697) exceed the 400-line guideline | **low** | code | see E.7 | Split `ui.tsx` first — it ships in the initial chunk | L |
| 22 | Card border 1.72:1 and header hairline 1.72:1 — grouping reads as a tint, not a card | **low** | visual | `tokens.css` `--line` | Nudge `--line` up ~15 % | S |
| 23 | Third-party cookies (`1`, `USER_ID`) set by the ad iframe | **low** | perf/data | `InlineAd.tsx:29` | `sandbox` the iframe without `allow-same-origin` | S |
| 24 | `matches.groupFinished` key exists only in FA and is unreferenced | **low** | i18n | `src/i18n/strings.ts` | Delete | S |
| 25 | 5 `exhaustive-deps` warnings in `src/` (one is an *unnecessary* dep that forces needless memo recomputes) | **low** | code | `Matches.tsx:251`, `useFavorites.ts:56`, `MatchDetail.tsx:168`, `useApi.ts:203`, `Table.tsx:182` | Fix the deps | S |
| 26 | `TabBar.tsx:18` uses `forwardRef<HTMLElement, {}>` (lint error) and `DateStrip.tsx:33` exports a non-component | **low** | code | `TabBar.tsx:18`, `DateStrip.tsx:33` | `Record<string, never>`; move `dayKey` to a util | S |
| 27 | The "followed club plays" dot is unreachable on the selected day, and the app always opens on today | **low** | visual/ux | `DateStrip.tsx:158-176` | Offset the two markers (dot under the number, ring for today) | S |

### Top 10 to fix first (most user-visible per hour of work)

1. **Half-time renders as live** (`LeagueGroup.tsx:136`) — one condition swap, fixes a state the user cannot currently perceive.
2. **Row `aria-label`** (`LeagueGroup.tsx:110`) — build it from the rendered strings; fixes screen-reader users *and* half of finding 4.
3. **Date-chip labels** (`DateStrip.tsx:150`) — start the label with the chip's visible text; clears 7 of the 9 WCAG 2.5.3 failures.
4. **`loading="lazy"` on the ad iframe** (`InlineAd.tsx:29`) — removes ~1.6 s of third-party work from the feed's first paint.
5. **Row divider colour** (`LeagueGroup.tsx:215`) — `#1d2b26` → `--line`; makes the list readable at 1×.
6. **Header/tab-bar ghosting** (`TopBar.tsx:41`, `TabBar.tsx:30`) — `bg-base/95` → solid; kills the most obviously "broken-looking" artefact on the screen.
7. **EN clock format** (`lib/format.ts:14`) — add `hour12: false`; stops `07:20 PM` sitting under three 24-hour row clocks.
8. **The two physical-class fixes** (`Skeletons.tsx:226`, `Table.tsx:640`) — two words, removes the only RTL breakage in the app.
9. **360 px date chips** (`DateStrip.tsx`) — recover the 44 px floor on the narrowest phone.
10. **One calendar for FA** (`DateStrip.tsx:105` + `Matches.tsx:286`) — stop showing `۲۶ اکتبر` beside a Jalali picker. Decide, then apply in three places.

Just outside: the `text-on-volt` sweep (6 files, invisible but free) and giving the rules sheet a door in Profile.

---

## I. Repo state at the end

```
$ git status --short
 M scripts/shoot-cdp.mjs            (pre-existing, not mine)
?? scripts/audit-analyze.mjs        (pre-existing)
?? scripts/audit-shots.mjs          (pre-existing)
?? scripts/fa-audit.mjs             (pre-existing)
?? scripts/shoot-verdi-multi.mjs    (pre-existing)
?? ui-code.txt                      (pre-existing)
?? audit-full.md                    (this report)

$ git log --oneline origin/main..HEAD
df699b4 Screenshots: dependency-free CDP shooter (playwright isn't installed here)
1e176b6 Sync: repair finished-fixture history on boot so form strips reach five
6ae3fe4 Tables: Cups tab as the new route to /cups
1abcafe Profile: redeem row under the invite link
9f20685 Profile: Persian digits on the version line in FA
```

**Caveat to read literally:** HEAD is *not* `fbb9c91` — it is `ui-polish-pass`, five commits ahead of origin/main, which is `39d645d`. Nothing was pushed, nothing was committed. This report is **uncommitted** at the repo root; you can review it before it becomes history.

The audit work itself lived in `d/audit-main` (a `git worktree` of `39d645d`, excluded via `.git/info/exclude`) and `.tmp/audit/` (harness + raw JSON). Both are local-only; delete `d/audit-main` with `git worktree remove d/audit-main --force` when you are done with it.

**No source file was modified in the writing of this report.**

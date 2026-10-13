/**
 * The bot's command menu (/matches, /profile, /leaderboards) and the Mini App
 * deep links behind them.
 *
 * Why this suite exists: the app is a HashRouter, so the page lives AFTER the
 * `#`. `/matches` and `/#/matches` both parse fine as URLs and only one of them
 * lands on the Matches screen — the other opens the app and then the router
 * throws the user at the fallback route. Nothing type-checks that, and it is
 * invisible until someone taps the button in Telegram.
 *
 * Two things are checked: the command menu that gets registered with Telegram,
 * and the reply each command sends — dispatched through grammy itself, so
 * command parsing, the handlers and the `web_app` button payload are all the
 * real ones. The only thing stubbed is the HTTP layer, via an API transformer.
 */
import { strict as assert } from "node:assert";
import { Bot } from "grammy";
import { deepLink, registerCommands, registerHandlers } from "../server/bot/index.js";
import { botCommandMenu, botPageCopy, type BotPage } from "../server/messages.js";

const PAGES: BotPage[] = ["matches", "profile", "leaderboards"];
const LANGS = ["en", "fa"] as const;

/** A syntactically valid token — this bot never talks to Telegram. */
const TEST_TOKEN = "123456:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

/** What getMe would have returned, so grammy needs no round trip for it. */
const TEST_BOT_INFO = {
  id: 123456,
  is_bot: true,
  first_name: "Vkick Test",
  username: "vkick_test_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: true,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
} as const;

interface ApiCall {
  method: string;
  payload: Record<string, unknown>;
}

/**
 * A bot with the real handlers registered and every API call captured: the
 * transformer is grammy's own interception point (it also runs on the fresh
 * Api instance grammy builds per update), so a dispatch exercises the actual
 * middleware stack and stops one step short of the network.
 */
function testBot(): { bot: Bot; calls: ApiCall[] } {
  const bot = new Bot(TEST_TOKEN, { botInfo: TEST_BOT_INFO });
  const calls: ApiCall[] = [];
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    // The per-method result is never inspected — grammy's transformer type is
    // generic over the method, so `never` stands in for the concrete result.
    return { ok: true, result: undefined as never };
  });
  registerHandlers(bot);
  return { bot, calls };
}

/** Send one command from a private chat, as Telegram would. */
async function dispatch(bot: Bot, command: string): Promise<void> {
  const chatId = 400_000_000;
  await bot.handleUpdate({
    update_id: 1,
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: "private", first_name: "Tester" },
      from: { id: chatId, is_bot: false, first_name: "Tester" },
      text: command,
      entities: [{ type: "bot_command", offset: 0, length: command.length }],
    },
  });
}

/** The reply_markup the bot sent in response to one command. */
async function replyMarkupFor(command: string): Promise<unknown> {
  const { bot, calls } = testBot();
  await dispatch(bot, command);
  const send = calls.find((c) => c.method === "sendMessage");
  assert.ok(send, `${command}: the bot replied`);
  const markup = send.payload.reply_markup as {
    inline_keyboard?: Array<Array<{ text?: string; web_app?: { url?: string } }>>;
  };
  return markup;
}

/** Run `fn` with MINI_APP_URL set, restoring whatever was there before. */
async function withMiniAppUrl(url: string | undefined, fn: () => void | Promise<void>) {
  const saved = process.env.MINI_APP_URL;
  if (url === undefined) delete process.env.MINI_APP_URL;
  else process.env.MINI_APP_URL = url;
  try {
    await fn();
  } finally {
    if (saved === undefined) delete process.env.MINI_APP_URL;
    else process.env.MINI_APP_URL = saved;
  }
}

export async function runBotMenuTests(): Promise<void> {
  // The menu Telegram shows: exactly the three commands, described for a user
  // reading the "/" list.
  assert.deepEqual(
    botCommandMenu("en"),
    [
      { command: "matches", description: "View today's fixtures" },
      { command: "profile", description: "View your profile" },
      { command: "leaderboards", description: "View the leaderboards" },
    ],
    "the English command menu is the three deep-link commands",
  );

  // Menu order is handler order (BOT_PAGES), so a command in the menu always
  // has a handler and every handler is reachable.
  assert.deepEqual(
    botCommandMenu("en").map((c) => c.command),
    PAGES,
    "menu commands and handler pages agree",
  );

  // Persian: same commands, translated descriptions, nothing empty.
  const fa = botCommandMenu("fa");
  assert.deepEqual(
    fa.map((c) => c.command),
    PAGES,
    "the Persian menu lists the same commands",
  );
  for (let i = 0; i < fa.length; i += 1) {
    assert.ok(fa[i].description.trim().length > 0, `fa: ${fa[i].command} has a description`);
    assert.notEqual(
      fa[i].description,
      botCommandMenu("en")[i].description,
      `${fa[i].command} description is translated, not copied`,
    );
  }

  // Every page has reply copy + a button label, in both languages.
  for (const page of PAGES) {
    for (const lang of LANGS) {
      const copy = botPageCopy(lang, page);
      assert.ok(copy.text.trim().length > 0, `${lang}: ${page} reply text is empty`);
      assert.ok(copy.button.trim().length > 0, `${lang}: ${page} button label is empty`);
    }
  }

  // The registration itself: one setMyCommands for the default language and one
  // for Persian. A missing call means the menu never appears in Telegram.
  {
    const { bot, calls } = testBot();
    await registerCommands(bot);
    const sets = calls.filter((c) => c.method === "setMyCommands");
    assert.equal(sets.length, 2, "setMyCommands runs once per language");
    assert.deepEqual(sets[0].payload.commands, botCommandMenu("en"), "the default menu is English");
    assert.equal(sets[0].payload.language_code, undefined, "the default menu is unscoped");
    assert.deepEqual(sets[1].payload.commands, botCommandMenu("fa"), "the second menu is Persian");
    assert.equal(sets[1].payload.language_code, "fa", "the second menu is scoped to fa");
  }

  // The deep link: hash route, one slash, and a trailing slash on the env var
  // must not double up.
  await withMiniAppUrl("https://vkick.onrender.com", () => {
    assert.equal(deepLink("matches"), "https://vkick.onrender.com/#/matches");
    assert.equal(deepLink("profile"), "https://vkick.onrender.com/#/profile");
    assert.equal(deepLink("leaderboards"), "https://vkick.onrender.com/#/leaderboards");
  });
  await withMiniAppUrl("https://vkick.onrender.com/", () => {
    assert.equal(deepLink("matches"), "https://vkick.onrender.com/#/matches", "trailing slash trimmed");
  });
  await withMiniAppUrl(undefined, () => {
    // Same fallback /start's button uses, so an unset MINI_APP_URL can never
    // produce a relative URL that Telegram rejects.
    assert.equal(deepLink("profile"), "https://example.com/#/profile");
  });

  for (const page of PAGES) {
    const url = deepLink(page);
    assert.match(url, /^https:\/\//, `${page}: link is absolute https`);
    assert.ok(url.endsWith(`/#/${page}`), `${page}: link is a hash route to /${page}`);
  }

  // End to end, through grammy: each command answers with ONE button of type
  // web_app pointing at that page's deep link. This payload IS the feature, so
  // it is asserted as the user would experience it.
  await withMiniAppUrl("https://vkick.onrender.com", async () => {
    for (const page of PAGES) {
      const markup = (await replyMarkupFor(`/${page}`)) as {
        inline_keyboard?: Array<Array<{ text?: string; web_app?: { url?: string } }>>;
      };
      const rows = markup.inline_keyboard ?? [];
      assert.equal(rows.length, 1, `/${page}: exactly one row`);
      assert.equal(rows[0].length, 1, `/${page}: exactly one button`);
      const button = rows[0][0];
      assert.ok(
        typeof button.text === "string" && button.text.trim().length > 0,
        `/${page}: button has a label`,
      );
      assert.equal(
        button.web_app?.url,
        `https://vkick.onrender.com/#/${page}`,
        `/${page}: the button is a web_app opening that page`,
      );
    }
  });

  console.log("  botMenu: /matches /profile /leaderboards menu + hash deep links OK");
}

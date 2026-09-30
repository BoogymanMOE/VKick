async function main() {
  const BASE = "https://understat.com";
  const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

  // First get cookies from team page
  const teamPageRes = await fetch(`${BASE}/team/Real_Madrid/2023`, { headers: { "User-Agent": UA } });
  const cookies = teamPageRes.headers.get("set-cookie");

  // Try with jQuery-like headers
  const headers = {
    "User-Agent": UA,
    Accept: "application/json",
    "X-Requested-With": "XMLHttpRequest",
    Referer: `${BASE}/team/Real_Madrid/2023`,
  };
  if (cookies) headers["Cookie"] = cookies;

  const endpoints = ["getTeamData/Real_Madrid/2023", "getLeagueData/La_liga/2023", "main/getPlayersStats/"];

  for (const ep of endpoints) {
    try {
      const isPost = ep === "main/getPlayersStats/";
      const res = await fetch(`${BASE}/${ep}`, {
        method: isPost ? "POST" : "GET",
        headers: {
          ...headers,
          "Content-Type": isPost ? "application/x-www-form-urlencoded; charset=UTF-8" : undefined,
        },
        body: isPost ? "team=Real_Madrid&season=2023" : undefined,
      });
      console.log(`${ep}: ${res.status} ${res.statusText}`);
      if (res.ok) {
        const text = await res.text();
        if (text.startsWith("{") || text.startsWith("[")) {
          console.log("  JSON:", text.slice(0, 2000));
        }
      }
    } catch (e) {
      console.log(`${ep}: ERROR`, e);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

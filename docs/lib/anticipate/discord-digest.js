/**
 * The pre-game storylines as Discord webhook payloads (no imports, so both the GitHub build's
 * scripts/notify.js and the Cloudflare Worker's cloudflare/digest.js can use it).
 * stories: [{ away, home, start (ISO), lines: [{ text }] }].
 * opts: { date ("Thu, Nov 12"), heading (default "Tonight's storylines"), note, site }.
 */
export function discordDigest(stories, { date, heading = "Tonight's storylines", note = "", site = "https://campgambino.github.io/nba-command-center/" } = {}) {
  const time = (iso) => new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
  const embeds = stories.filter((g) => g.lines.length).map((g) => ({
    title: `${g.away} @ ${g.home} · ${time(g.start)} ET`,
    description: g.lines.map((l) => `• ${l.text}`).join("\n").slice(0, 3900),
    color: 0x4f9cf7,
  }));
  const payloads = [];
  let cur = [], size = 0;
  for (const e of embeds) {
    const n = e.title.length + e.description.length;
    if (cur.length === 10 || size + n > 5500) { payloads.push(cur); cur = []; size = 0; }
    cur.push(e); size += n;
  }
  if (cur.length) payloads.push(cur);
  return payloads.map((em, i) => ({
    username: "NBA Command Center",
    content: i === 0 ? `**${heading}, ${date}** · ${stories.length} game${stories.length === 1 ? "" : "s"}${note ? ` (${note})` : ""} · ${site}` : "",
    embeds: em,
    allowed_mentions: { parse: [] },
  }));
}

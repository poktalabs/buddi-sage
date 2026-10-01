// The Telegram admin bot's webhook. It talks to exactly one person: every update must carry
// Telegram's secret header (TELEGRAM_WEBHOOK_SECRET, set with setWebhook), and the sender and
// chat must both be TELEGRAM_OWNER_ID. Anyone else gets a silent 200 so Telegram stops
// retrying and the bot never confirms it exists. Replies ride back in the webhook response
// (Telegram runs a method returned there), so commands need no outbound call.
import type { Lang } from "../../shared/api";
import type { Env } from "../env";
import { closeRequest, getCode, getCodeRequest, listPendingRequests, normaliseCode, readStats } from "../db";
import { json } from "../http";
import { requireHeader } from "../session";
import { DEFAULT_ALLOWANCE, issueCodes, MAX_ALLOWANCE, MAX_COUNT } from "./admin";

// Measured on the first three local Rounds (ElevenLabs conversation cost 747 to 1068 credits)
// plus an estimate for the Replay speech. An estimate for /stats, not a bill.
export const CREDITS_PER_ROUND_ESTIMATE = 1400;

type Update = { message?: { text?: string; chat?: { id?: number; type?: string }; from?: { id?: number } } };

export const HELP = [
  "BUDDi Sage admin",
  "",
  "/guest [count] [note]  new Guest codes, 3 Rounds each",
  "/gift <rounds> [note]  one Gift code with that many Rounds",
  "/requests  pending code requests",
  "/approve <id> [rounds]  issue a code for a request (Guest, or Gift with rounds)",
  "/dismiss <id>  close a request without a code",
  "/code <CODE>  look up a code",
  "/stats  codes, Rounds and estimated credits",
].join("\n");

const silent = () => new Response(null, { status: 200 });

function reply(chatId: number, text: string): Response {
  return json({ method: "sendMessage", chat_id: chatId, text, disable_web_page_preview: true });
}

/** `/approve_12@SageBot extra words` → { cmd: "approve", args: ["12", "extra", "words"] }. */
export function parseCommand(text: string): { cmd: string; args: string[] } | null {
  const parts = text.trim().split(/\s+/);
  const head = parts[0]?.split("@")[0] ?? "";
  if (!head.startsWith("/")) return null;
  const glued = /^\/([a-z]+)_(\d+)$/i.exec(head);
  if (glued) return { cmd: glued[1]!.toLowerCase(), args: [glued[2]!, ...parts.slice(1)] };
  return { cmd: head.slice(1).toLowerCase(), args: parts.slice(1) };
}

const toInt = (s: string | undefined): number | null => (s !== undefined && /^\d+$/.test(s) ? Number(s) : null);

/** A link that opens the landing page on "I have a code" with the code filled in. */
export function codeLink(origin: string, code: string): string {
  return `${origin}/?code=${encodeURIComponent(code)}`;
}

/** The message Mel forwards to the requester, in the language they used on the landing page. */
export function inviteText(code: string, rounds: number, origin: string, lang: Lang): string {
  if (lang === "es") {
    return [
      `Aquí está tu código de BUDDi Sage Mode: ${code}`,
      `Incluye ${rounds} ${rounds === 1 ? "Ronda" : "Rondas"} (una pregunta de entrevista cada una). La práctica es en inglés.`,
      `Empieza aquí: ${codeLink(origin, code)}`,
    ].join("\n");
  }
  return [
    `Here is your BUDDi Sage Mode code: ${code}`,
    `It gives you ${rounds} ${rounds === 1 ? "Round" : "Rounds"} (one interview Question each).`,
    `Start here: ${codeLink(origin, code)}`,
  ].join("\n");
}

async function run(cmd: string, args: string[], env: Env, origin: string): Promise<string> {
  switch (cmd) {
    case "start":
    case "help":
      return HELP;

    case "guest": {
      const count = args[0] !== undefined && toInt(args[0]) !== null ? toInt(args[0])! : 1;
      const noteWords = toInt(args[0]) !== null ? args.slice(1) : args;
      const codes = await issueCodes(env, { kind: "guest", count, note: noteWords.join(" ") || undefined });
      if (!codes) return `Usage: /guest [count 1-${MAX_COUNT}] [note]`;
      return [`${codes.length} Guest ${codes.length === 1 ? "code" : "codes"}, ${DEFAULT_ALLOWANCE.guest} Rounds each:`, ...codes.map((c) => `${c}  ${codeLink(origin, c)}`)].join("\n");
    }

    case "gift": {
      const rounds = toInt(args[0]);
      const codes = rounds === null ? null : await issueCodes(env, { kind: "gift", allowance: rounds, note: args.slice(1).join(" ") || undefined });
      if (!codes) return `Usage: /gift <rounds 1-${MAX_ALLOWANCE}> [note]`;
      return `Gift code, ${rounds} Rounds:\n${codes[0]}\n${codeLink(origin, codes[0]!)}`;
    }

    case "requests": {
      const rows = await listPendingRequests(env.DB, 10);
      if (rows.length === 0) return "No pending requests.";
      return rows
        .map((r) =>
          [
            `#${r.id} @${r.handle} [${r.lang}] ${r.created_at.slice(0, 16).replace("T", " ")}`,
            r.job ? `  Job: ${r.job}` : "",
            `  /approve_${r.id}   /dismiss_${r.id}`,
          ].filter(Boolean).join("\n"),
        )
        .join("\n\n");
    }

    case "approve": {
      const id = toInt(args[0]);
      const rounds = args[1] === undefined ? null : toInt(args[1]);
      if (id === null || (args[1] !== undefined && rounds === null)) return "Usage: /approve <id> [rounds]";
      const request = await getCodeRequest(env.DB, id);
      if (!request) return `No request #${id}.`;
      if (request.status !== "pending") return `Request #${id} is already ${request.status}${request.code ? ` (${request.code})` : ""}.`;
      const kind = rounds === null ? "guest" : "gift";
      const who = `@${request.handle}`;
      const codes = await issueCodes(env, { kind, allowance: rounds ?? undefined, note: `request #${id}`, contact: who });
      if (!codes) return `Usage: /approve <id> [rounds 1-${MAX_ALLOWANCE}]`;
      const code = codes[0]!;
      if (!(await closeRequest(env.DB, id, "approved", code))) return `Request #${id} was closed meanwhile; ${code} was issued anyway.`;
      const allowance = rounds ?? DEFAULT_ALLOWANCE.guest!;
      return [`Approved #${id}. Reply to ${who}'s DM with:`, "", inviteText(code, allowance, origin, request.lang)].join("\n");
    }

    case "dismiss": {
      const id = toInt(args[0]);
      if (id === null) return "Usage: /dismiss <id>";
      return (await closeRequest(env.DB, id, "dismissed", null)) ? `Dismissed #${id}.` : `Request #${id} is not pending.`;
    }

    case "code": {
      if (!args[0]) return "Usage: /code <CODE>";
      const row = await getCode(env.DB, normaliseCode(args.join("")));
      if (!row) return "No such code.";
      return [
        `${row.code} (${row.kind})`,
        `Rounds: ${row.used} of ${row.allowance} used`,
        `Contact: ${row.contact ?? "none yet"}`,
        `Voice clone: ${row.voice_id ? "yes" : "no"}`,
        row.note ? `Note: ${row.note}` : "",
        `Created: ${row.created_at.slice(0, 16).replace("T", " ")}`,
      ].filter(Boolean).join("\n");
    }

    case "stats": {
      const s = await readStats(env.DB);
      const spent = s.codes.reduce((n, c) => n + (c.used ?? 0), 0);
      return [
        "Codes:",
        ...(s.codes.length ? s.codes.map((c) => `  ${c.kind}: ${c.n} codes, ${c.used ?? 0} of ${c.allowance ?? 0} Rounds used`) : ["  none"]),
        "Rounds:",
        ...(s.rounds.length ? s.rounds.map((r) => `  ${r.status}: ${r.n}`) : ["  none"]),
        `Pending requests: ${s.pendingRequests}`,
        `Estimated ElevenLabs credits: about ${(spent * CREDITS_PER_ROUND_ESTIMATE).toLocaleString("en-US")} (${CREDITS_PER_ROUND_ESTIMATE} per Round)`,
      ].join("\n");
    }

    default:
      return `Unknown command.\n\n${HELP}`;
  }
}

export async function telegramWebhook(req: Request, env: Env): Promise<Response> {
  if (!env.TELEGRAM_WEBHOOK_SECRET || !env.TELEGRAM_OWNER_ID) return new Response(null, { status: 404 });
  if (!requireHeader(req, "x-telegram-bot-api-secret-token", env.TELEGRAM_WEBHOOK_SECRET)) return new Response(null, { status: 401 });

  let update: Update;
  try {
    update = (await req.json()) as Update;
  } catch {
    return silent();
  }
  const msg = update.message;
  const owner = env.TELEGRAM_OWNER_ID;
  if (!msg?.text || String(msg.from?.id) !== owner || String(msg.chat?.id) !== owner || msg.chat?.type !== "private") return silent();

  const parsed = parseCommand(msg.text);
  const text = parsed ? await run(parsed.cmd, parsed.args, env, new URL(req.url).origin) : HELP;
  return reply(msg.chat.id!, text);
}

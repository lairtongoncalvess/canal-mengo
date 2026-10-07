// Canal do Mengão — versão GitHub Actions (sem Firebase, sem custo)
// Roda uma vez por execução: desfalques/retornos, lembrete de jogo e placar final.
// O estado fica em state.json (o workflow faz commit dele de volta no repositório).

const fs = require("fs");

const BASE = "https://sports.bzzoiro.com/api/v2";
const TEAM_ID = 160; // Flamengo
const TZ = "America/Sao_Paulo";
const STATE_FILE = process.env.STATE_FILE || "state.json";

const cfg = () => ({
  bsdToken: process.env.BSD_TOKEN,
  tgToken: process.env.TG_TOKEN,
  chat: process.env.TG_CHAT,
  appLink: process.env.APP_LINK || "",
  dryRun: process.env.DRY_RUN !== "false", // só posta de verdade se DRY_RUN for exatamente "false"
});

// ── Utilitários ─────────────────────────────────────────────────────────────
async function bsd(path) {
  const res = await fetch(BASE + path, {
    headers: { Authorization: `Token ${cfg().bsdToken}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Bzzoiro ${path} -> HTTP ${res.status}`);
  return res.json();
}

async function postTelegram(text) {
  const c = cfg();
  const full = c.appLink ? `${text}\n\n📲 ${c.appLink}` : text;
  if (c.dryRun) {
    console.log("[DRY_RUN] mensagem que seria enviada:\n" + full + "\n");
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${c.tgToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: c.chat, text: full, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Telegram HTTP ${res.status}: ${await res.text()}`);
}

const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);

function formatBack(raw) {
  if (!raw) return "sem data";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw));
  return m ? `${m[3]}/${m[2]}` : String(raw);
}

// Tipos de lesão chegam em inglês; acrescente aqui o que aparecer.
const INJURY_PT = {
  "thigh injury": "lesão na coxa",
  "broken wrist": "fratura no punho",
  "knee injury": "lesão no joelho",
  "ankle injury": "lesão no tornozelo",
  "hamstring injury": "lesão na posterior da coxa",
  "calf injury": "lesão na panturrilha",
  "muscle injury": "lesão muscular",
  "groin injury": "lesão na virilha",
  "back injury": "lesão nas costas",
  "foot injury": "lesão no pé",
  illness: "problema de saúde",
  national_team: "servindo à seleção",
};
const translateInjury = (s) =>
  s ? INJURY_PT[String(s).toLowerCase()] || String(s) : "motivo não divulgado";

// ── Leitura da API (formato confirmado pelos DTOs do app) ───────────────────
function extractUnavailable(squad) {
  return (squad.players || [])
    .filter((p) => p.availability === "injured" || p.availability === "suspended")
    .map((p) => ({
      id: p.id,
      key: `${p.id}:${p.availability}`,
      name: p.name,
      kind: p.availability,
      reason: p.injury_type,
      backDate: p.injury_expected_return,
    }));
}

function extractNextMatch(events) {
  const e = (events.results || [])
    .filter((x) => x.status === "notstarted")
    .sort((a, b) => new Date(a.event_date) - new Date(b.event_date))[0];
  if (!e) return null;
  return {
    id: e.id,
    home: e.home_team,
    away: e.away_team,
    kickoffISO: e.event_date,
    competition: e.league && e.league.name,
  };
}

// ── 1) Desfalques e retornos ────────────────────────────────────────────────
async function checkInjuries(state) {
  const squad = await bsd(`/teams/${TEAM_ID}/squad/`);
  if (!squad.players || squad.players.length === 0) {
    console.warn("Elenco vazio na API; ignorando para não gerar falso retorno.");
    return;
  }
  const current = extractUnavailable(squad);
  const currentKeys = new Set(current.map((p) => p.key));
  const currentIds = new Set(current.map((p) => p.id));

  // Primeira execução: só guarda a foto atual, sem postar nada.
  if (!state.unavailable) {
    state.unavailable = Object.fromEntries(
      current.map((p) => [p.key, { id: p.id, name: p.name }])
    );
    console.log(`Estado inicial gravado (${current.length} indisponíveis).`);
    return;
  }

  const next = { ...state.unavailable };
  state.unavailable = next; // atualizado aos poucos: o que já foi postado não repete

  for (const p of current) {
    if (next[p.key]) continue;
    const msg =
      p.kind === "suspended"
        ? `🟥 ${p.name} está suspenso e desfalca o Flamengo.`
        : `🚑 ${p.name} é desfalque do Flamengo: ${translateInjury(p.reason)}.\nRetorno previsto: ${formatBack(p.backDate)}.`;
    await postTelegram(msg);
    next[p.key] = { id: p.id, name: p.name };
  }

  for (const [key, entry] of Object.entries({ ...next })) {
    if (currentKeys.has(key)) continue;
    if (currentIds.has(entry.id)) {
      delete next[key]; // mudou de lesão para suspensão (ou vice-versa); já foi anunciado acima
      continue;
    }
    await postTelegram(
      `✅ ${entry.name} está liberado e volta a ficar à disposição do Flamengo.`
    );
    delete next[key];
  }
}

// ── 2) Lembrete de jogo (até 2h antes) ──────────────────────────────────────
async function matchReminder(state) {
  const events = await bsd(`/events/?team_id=${TEAM_ID}&status=notstarted`);
  const m = extractNextMatch(events);
  if (!m) return;

  const diffMin = (new Date(m.kickoffISO).getTime() - Date.now()) / 60000;
  if (!(diffMin > 0 && diffMin <= 120)) return;

  state.reminded = state.reminded || [];
  if (state.reminded.includes(m.id)) return;

  const hora = new Date(m.kickoffISO).toLocaleTimeString("pt-BR", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
  });
  await postTelegram(
    `⚽ Hoje tem Mengão!\n${m.home} x ${m.away}\n🕒 ${hora} (Brasília)${m.competition ? ` · ${m.competition}` : ""}`
  );
  state.reminded = [...state.reminded, m.id].slice(-30);
}

// ── 3) Placar final ─────────────────────────────────────────────────────────
async function finalScore(state) {
  const from = isoDate(Date.now() - 3 * 86400000);
  const to = isoDate(Date.now() + 86400000);
  const data = await bsd(
    `/teams/${TEAM_ID}/fixtures/?date_from=${from}&date_to=${to}&limit=30`
  );
  const finished = (data.results || []).filter(
    (f) => f.status === "finished" && f.home_score != null && f.away_score != null
  );

  // Primeira execução: marca os jogos já terminados como "vistos", sem postar.
  if (!state.finals) {
    state.finals = finished.map((f) => f.id);
    console.log(`Estado inicial de placares gravado (${finished.length}).`);
    return;
  }

  for (const f of finished) {
    if (state.finals.includes(f.id)) continue;
    const flaHome = f.home_team_id === TEAM_ID || /flamengo/i.test(f.home_team || "");
    const flaGoals = flaHome ? f.home_score : f.away_score;
    const oppGoals = flaHome ? f.away_score : f.home_score;
    const icon = flaGoals > oppGoals ? "✅" : flaGoals === oppGoals ? "🤝" : "❌";
    await postTelegram(
      `🏁 Fim de jogo! ${icon}\n${f.home_team} ${f.home_score} x ${f.away_score} ${f.away_team}`
    );
    state.finals = [...state.finals, f.id].slice(-60);
  }
}

// ── Execução ────────────────────────────────────────────────────────────────
async function main() {
  const c = cfg();
  if (!c.bsdToken) throw new Error("Falta o segredo BSD_TOKEN.");
  if (!c.dryRun && (!c.tgToken || !c.chat)) {
    throw new Error("Falta o segredo TG_TOKEN ou a variável TG_CHAT.");
  }
  console.log(`Modo: ${c.dryRun ? "TESTE (DRY_RUN)" : "PRODUÇÃO"}`);

  let state = {};
  try {
    state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch (_) {
    state = {};
  }

  let failed = 0;
  for (const [name, fn] of [
    ["checkInjuries", checkInjuries],
    ["matchReminder", matchReminder],
    ["finalScore", finalScore],
  ]) {
    try {
      await fn(state);
    } catch (err) {
      failed++;
      console.error(`Erro em ${name}:`, err.message);
    }
  }

  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
  if (failed > 0) process.exitCode = 1;
}

module.exports = { main };
if (require.main === module) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

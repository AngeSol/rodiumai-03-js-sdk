// Exercice 3 - même script que l'exercice 2, avec le SDK npm `rodiumai`.
// Chat -> image -> vidéo, menu [p]récédent / [r]ester / [s]uivant / [q]uitter.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import * as sdk from "rodiumai";

const API_KEY = process.env.RODIUMAI_API_KEY;
const CHAT_MODEL = process.env.CHAT_MODEL ?? "openai/gpt-4o";
const IMAGE_MODEL = process.env.IMAGE_MODEL ?? "google/gemini-3.1-flash-image";
const VIDEO_MODEL = process.env.VIDEO_MODEL ?? "google/veo-3.1-lite";
const VIDEO_SECONDS = Number(process.env.VIDEO_SECONDS ?? 4);
const OUT_DIR = "outputs";

if (!API_KEY) {
  console.error("Clé absente : créez un fichier .env (voir .env.example).");
  process.exit(1);
}

// timeout large : la vidéo peut durer plusieurs minutes
const client = new sdk.RodiumAI({ apiKey: API_KEY, timeout: 600000 });
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function save(item, filename) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, filename);
  if (!item?.b64_json) {
    console.log("  Réponse reçue, mais sans b64_json. Contenu :", JSON.stringify(item).slice(0, 400));
    throw new Error("Pas de b64_json dans la réponse.");
  }
  const buf = Buffer.from(item.b64_json, "base64");
  fs.writeFileSync(file, buf);
  console.log(`  Fichier enregistré : ${file}`);
  return buf;
}

function explain(e) {
  console.log(`  ! ${e.constructor?.name ?? "Erreur"} : ${e.message}`);
  if (e instanceof sdk.InvalidAPIKeyError) console.log("   -> Clé absente ou fausse : vérifiez le .env.");
  else if (e instanceof sdk.InsufficientRODIError) console.log("   -> Solde RODI épuisé : rechargez en Mobile Money.");
  else if (e instanceof sdk.ModelNotFoundError) console.log("   -> Modèle inexistant : vérifiez le nom dans le catalogue.");
  else if (e instanceof sdk.RateLimitError) console.log("   -> Trop de requêtes : attendez un peu.");
  else if (e instanceof sdk.TimeoutError) console.log("   -> Délai dépassé : réessayez ou augmentez le timeout.");
}

// ------------------------------- les étapes -------------------------------
async function stepChat(ctx) {
  console.log("\n=== ÉTAPE 1/3 : CHAT (SDK) ===");
  const sujet = (await rl.question("Sujet de l'image à créer : ")).trim() || "un marché coloré à Lomé";
  const res = await client.chat.completions.create({
    model: CHAT_MODEL,
    messages: [
      { role: "system", content: "Tu es un assistant concis." },
      { role: "user", content: `Écris un prompt visuel en 2 phrases pour générer une image sur : ${sujet}` },
    ],
    max_tokens: 200,
  });
  ctx.scene = res.choices[0].message.content;
  console.log(`\n${ctx.scene}\n`);
  console.log("  Tokens :", res.usage?.total_tokens ?? "n/a", "| Coût :", res.cost_rodi ?? "n/a", "RODI");
  return true;
}

async function stepImage(ctx) {
  console.log("\n=== ÉTAPE 2/3 : IMAGE (SDK) ===");
  if (!ctx.scene) { console.log("  Pas de texte de l'étape 1 : revenez en arrière ([p])."); return false; }
  const res = await client.images.generate({
    model: IMAGE_MODEL, prompt: ctx.scene.slice(0, 900), size: "1024x1024",
  });
  ctx.imageB64 = save(res.data[0], "image.png").toString("base64");
  return true;
}

// Plan B pour la vidéo : le SDK renvoie "Video generation is not yet available".
async function rawVideo(args) {
  const base = (process.env.RODIUMAI_BASE_URL ?? "https://api.rodiumai.io/v1").replace(/\/$/, "");
  const r = await fetch(`${base}/videos/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(600000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} : ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

async function stepVideo(ctx) {
  console.log("\n=== ÉTAPE 3/3 : VIDÉO (plusieurs minutes, facturée à la seconde) ===");
  if (!ctx.imageB64) { console.log("  Pas d'image de l'étape 2 : revenez en arrière ([p])."); return false; }
  const args = {
    model: VIDEO_MODEL,
    prompt: ctx.scene.slice(0, 900),
    duration_seconds: VIDEO_SECONDS,
    image: { b64_json: ctx.imageB64, mime_type: "image/png" },
  };
  let res, via;
  try {
    res = await client.video.generations.create(args);
    via = "SDK";
  } catch (e) {
    if (!/not yet available/i.test(e.message)) throw e;   // autre erreur : on la montre
    console.log("  Le SDK n'offre pas encore la vidéo -> appel HTTP direct.");
    res = await rawVideo(args);
    via = "HTTP direct";
  }
  console.log(`  [${via}]`);
  save(res.data?.[0] ?? res, "video.mp4");
  return true;
}

const STEPS = [stepChat, stepImage, stepVideo];

// ------------------------------- boucle menu -------------------------------
const ctx = {};
let i = 0;
while (i < STEPS.length) {
  let ok = false;
  try { ok = await STEPS[i](ctx); } catch (e) { explain(e); }
  const last = i === STEPS.length - 1;
  const choix = (await rl.question(`\n[p] précédent  [r] rester/refaire  [s] ${last ? "terminer" : "suivant"}  [q] quitter : `)).trim().toLowerCase();
  if (choix === "q") break;
  if (choix === "p") i = Math.max(0, i - 1);
  else if (choix === "s") { if (ok) i++; else console.log("  Impossible de passer : l'étape n'a pas réussi."); }
}
console.log("\nTerminé. Fichiers dans outputs/.");
rl.close();
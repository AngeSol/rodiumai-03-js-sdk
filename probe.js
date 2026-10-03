import "dotenv/config";
import * as sdk from "rodiumai";

const client = new sdk.RodiumAI({ apiKey: process.env.RODIUMAI_API_KEY });

function listMethods(obj) {
  const names = new Set();
  let o = obj;
  while (o && o !== Object.prototype) {
    Object.getOwnPropertyNames(o).forEach((n) => n !== "constructor" && !n.startsWith("_") && names.add(n));
    o = Object.getPrototypeOf(o);
  }
  return [...names];
}

for (const ns of ["chat", "images", "video", "audio", "embeddings"]) {
  const part = client[ns];
  console.log(`\n--- client.${ns} (${typeof part}) ---`);
  for (const name of listMethods(part)) {
    const v = part[name];
    console.log(`  ${name} : ${typeof v}`);
    if (v && typeof v === "object") {
      console.log(`     -> contenu : ${listMethods(v).join(", ")}`);
    }
  }
}
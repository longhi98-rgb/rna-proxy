var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
function pulisciTesto(s) {
  return s.replace(/<[^>]+>/g, "").replace(/&euro;/gi, "\u20AC").replace(/&#039;/gi, "'").replace(/&amp;/gi, "&").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}
__name(pulisciTesto, "pulisciTesto");
function estraiCampo(html, labelPattern) {
  const re1 = new RegExp(
    "<strong[^>]*>[^<]*" + labelPattern + '[^<]*<\\/strong>\\s*<span[^>]*class="[^"]*d-block[^"]*"[^>]*>([\\s\\S]*?)<\\/span>',
    "i"
  );
  const m1 = re1.exec(html);
  if (m1) return pulisciTesto(m1[1]);
  const re2 = new RegExp(
    "<strong[^>]*>[^<]*" + labelPattern + "[^<]*<\\/strong>[\\s\\S]{0,300}?<span[^>]*>([\\s\\S]*?)<\\/span>",
    "i"
  );
  const m2 = re2.exec(html);
  if (m2) return pulisciTesto(m2[1]);
  return "";
}
__name(estraiCampo, "estraiCampo");
function normalizzaDimensione(raw) {
  if (!raw) return "";
  const r = raw.toUpperCase().replace(/\s+/g, " ").trim();
  if (r.includes("MICRO")) return "PMI";
  if (r.includes("PICCOL") || r.includes("MEDIA") || r === "PMI") return "PMI";
  if (r.includes("GRANDE") || r.includes("LARGE")) return "Grande Impresa";
  return "Non rilevata";
}
__name(normalizzaDimensione, "normalizzaDimensione");
async function sha256Hex(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sha256Hex, "sha256Hex");
function stripBOM(s) {
  return s && s.charCodeAt(0) === 65279 ? s.slice(1) : s;
}
__name(stripBOM, "stripBOM");
var PLAFOND_OWNERS = ["rodrigo", "consulente2", "team_fp", "team_ga", "team_mfl", "team_bd", "team_bd2", "team_ab"];
var PLAFOND_MAX = 3e5;
function plafondSubMonths(d, n) {
  const r = new Date(d);
  r.setMonth(r.getMonth() - n);
  return r;
}
__name(plafondSubMonths, "plafondSubMonths");
function plafondPct(c) {
  return Math.min(Math.round(c / PLAFOND_MAX * 100), 100);
}
__name(plafondPct, "plafondPct");
function formattaImporto(n) {
  return n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
__name(formattaImporto, "formattaImporto");
function calcPlafond(aiuti) {
  const oggi = /* @__PURE__ */ new Date(), cutoff = plafondSubMonths(oggi, 36);
  const dm = (aiuti || []).filter(
    (a) => (a.tipo_aiuto === "de minimis" || a.tipo_aiuto === "misto") && a.incluso_in_plafond && a.data_concessione && !isNaN(new Date(a.data_concessione))
  );
  const getImpDM = /* @__PURE__ */ __name((a) => a.importo_dm != null ? a.importo_dm : a.importo_totale_aiuto, "getImpDM");
  const consumed = dm.filter((a) => {
    const dc = new Date(a.data_concessione), scad = new Date(dc.getFullYear() + 3, dc.getMonth(), dc.getDate());
    return dc >= cutoff && scad > oggi;
  }).reduce((s, a) => s + getImpDM(a), 0);
  return { consumed, residuo: Math.max(PLAFOND_MAX - consumed, 0) };
}
__name(calcPlafond, "calcPlafond");
async function calcolaPlafondPerCF(cf, env) {
  const listePerOwner = await Promise.all(PLAFOND_OWNERS.map(async (owner) => {
    const raw = await env.RNA_DB.get(`state:aziende:${owner}`);
    return { owner, list: raw ? JSON.parse(raw) : [] };
  }));
  const trovati = [];
  for (const { owner, list } of listePerOwner) {
    const az = list.find((a) => (a.codice_fiscale || "").toUpperCase().trim() === cf);
    if (az) trovati.push({ owner, azienda: az });
  }
  if (trovati.length === 0) {
    return { notFound: true, codice_fiscale: cf };
  }
  const rawGruppi = await env.RNA_DB.get("state:gruppi");
  const gruppi = rawGruppi ? JSON.parse(rawGruppi) : [];
  let tutteLeAziende = null;
  const caricaTutteLeAziende = /* @__PURE__ */ __name(() => {
    if (!tutteLeAziende) tutteLeAziende = listePerOwner.flatMap((x) => x.list);
    return tutteLeAziende;
  }, "caricaTutteLeAziende");
  const calcolaRisultato = /* @__PURE__ */ __name((owner, az) => {
    const gruppo = az.gruppo_id ? gruppi.find((g) => g.id === az.gruppo_id) : null;
    let consumed, residuo;
    if (gruppo && gruppo.impresa_unica) {
      const azGruppo = caricaTutteLeAziende().filter((a) => a.gruppo_id === gruppo.id);
      consumed = azGruppo.reduce((s, a) => s + calcPlafond(a.aiuti).consumed, 0);
      residuo = Math.max(PLAFOND_MAX - consumed, 0);
    } else {
      const r = calcPlafond(az.aiuti);
      consumed = r.consumed;
      residuo = r.residuo;
    }
    return {
      codice_fiscale: az.codice_fiscale,
      ragione_sociale: az.ragione_sociale,
      owner,
      gruppo: gruppo ? gruppo.nome_gruppo : null,
      plafond_residuo: Math.round(residuo * 100) / 100,
      plafond_consumato: Math.round(consumed * 100) / 100,
      saturazione_percentuale: plafondPct(consumed),
      aggiornato_al: az.ultima_interrogazione || null
    };
  }, "calcolaRisultato");
  if (trovati.length === 1) {
    return calcolaRisultato(trovati[0].owner, trovati[0].azienda);
  }
  const conGruppo = trovati.filter(({ azienda }) => !!azienda.gruppo_id);
  if (conGruppo.length === 1) {
    return {
      ...calcolaRisultato(conGruppo[0].owner, conGruppo[0].azienda),
      nota: "scelto automaticamente: unico record collegato a un gruppo"
    };
  }
  const risultatiTutti = trovati.map(({ owner, azienda }) => calcolaRisultato(owner, azienda));
  const stessoResiduo = risultatiTutti.every((r) => r.plafond_residuo === risultatiTutti[0].plafond_residuo);
  if (stessoResiduo) {
    return {
      ...risultatiTutti[0],
      nota: "scelto automaticamente: valori identici tra owner, nessuna differenza sostanziale"
    };
  }
  return {
    conflitto: true,
    codice_fiscale: cf,
    risultati: risultatiTutti
  };
}
__name(calcolaPlafondPerCF, "calcolaPlafondPerCF");
var worker_default = {
  async fetch(request, env, ctx) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    };
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const json = /* @__PURE__ */ __name((data, status) => new Response(JSON.stringify(data), {
      status: status || 200,
      headers: Object.assign({ "Content-Type": "application/json" }, cors)
    }), "json");
    if (path === "/") {
      return json({
        status: "RNA Proxy attivo (Cloudflare Worker v4.3)",
        version: "4.3",
        kv: env.RNA_DB ? "connesso" : "NON connesso"
      });
    }
    if (path === "/api/db" && method === "GET") {
      const key = url.searchParams.get("key");
      if (!key) return json({ error: "key mancante" }, 400);
      const val = await env.RNA_DB.get(key);
      return json({ data: val ? JSON.parse(val) : null });
    }
    if (path === "/api/db" && method === "POST") {
      const key = url.searchParams.get("key");
      if (!key) return json({ error: "key mancante" }, 400);
      const body = await request.json();
      await env.RNA_DB.put(key, JSON.stringify(body));
      return json({ ok: true });
    }
    if (path === "/api/db" && method === "DELETE") {
      const key = url.searchParams.get("key");
      if (!key) return json({ error: "key mancante" }, 400);
      await env.RNA_DB.delete(key);
      return json({ ok: true });
    }
    if (path === "/api/db-list" && method === "GET") {
      const prefix = url.searchParams.get("prefix") || "";
      const list = await env.RNA_DB.list({ prefix });
      return json({ keys: list.keys.map((k) => k.name) });
    }
    if (path === "/api/plafond" && method === "GET") {
      const cf = (url.searchParams.get("cf") || "").toUpperCase().trim();
      if (!cf) return json({ error: "cf mancante" }, 400);
      const risultato = await calcolaPlafondPerCF(cf, env);
      if (risultato.notFound) {
        return json({ error: "Azienda non trovata", codice_fiscale: cf }, 404);
      }
      return json(risultato);
    }
    if (path === "/api/sync-hubspot" && method === "POST") {
      let cf;
      try {
        const body = await request.json();
        cf = (body.cf || "").toUpperCase().trim();
      } catch {
        return json({ error: "Body non valido" }, 400);
      }
      if (!cf) return json({ error: "cf mancante" }, 400);
      const risultato = await calcolaPlafondPerCF(cf, env);
      if (risultato.notFound) {
        console.log(`[sync-hubspot] ${cf}: azienda non trovata`);
        return json({ error: "Azienda non trovata" }, 404);
      }
      if (risultato.conflitto) {
        console.log(`[sync-hubspot] ${cf}: skip, conflitto non risolvibile automaticamente`);
        return json({ skipped: true, motivo: "conflitto non risolvibile automaticamente" });
      }
      if (!env.HUBSPOT_TOKEN) {
        console.log(`[sync-hubspot] ${cf}: errore, HUBSPOT_TOKEN non configurato`);
        return json({ error: "HUBSPOT_TOKEN non configurato" }, 500);
      }
      const valoreScritto = formattaImporto(risultato.plafond_residuo);
      const patchCompany = /* @__PURE__ */ __name((id) => fetch(`https://api.hubapi.com/crm/v3/objects/companies/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${env.HUBSPOT_TOKEN}`
        },
        body: JSON.stringify({ properties: { de_minimis_disponibile: valoreScritto } })
      }), "patchCompany");
      const rawCache = await env.RNA_DB.get("state:hubspot_ids");
      const cache = rawCache ? JSON.parse(rawCache) : {};
      const idCache = cache[cf];
      if (idCache) {
        const r = await patchCompany(idCache);
        if (r.ok) {
          console.log(`[sync-hubspot] ${cf}: OK (cache hit, id ${idCache}), valore ${valoreScritto}`);
          return json({ ok: true, hubspot_company_id: idCache, valore_scritto: valoreScritto });
        }
        if (r.status === 404) {
          console.log(`[sync-hubspot] ${cf}: cache non valida (id ${idCache} -> 404), rimuovo e rifaccio la ricerca`);
          delete cache[cf];
          await env.RNA_DB.put("state:hubspot_ids", JSON.stringify(cache));
        } else {
          const detail = await r.text();
          console.log(`[sync-hubspot] ${cf}: errore scrittura HubSpot (cache hit) - HTTP ${r.status}: ${detail}`);
          return json({ error: "Errore scrittura HubSpot", detail: `HTTP ${r.status}: ${detail}` }, 502);
        }
      } else {
        console.log(`[sync-hubspot] ${cf}: nessun id in cache, ricerca su HubSpot`);
      }
      let company;
      try {
        const r = await fetch("https://api.hubapi.com/crm/v3/objects/companies/search", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${env.HUBSPOT_TOKEN}`
          },
          body: JSON.stringify({
            filterGroups: [
              { filters: [{ propertyName: "codicefiscale", operator: "EQ", value: cf }] },
              { filters: [{ propertyName: "partitaiva", operator: "EQ", value: cf }] }
            ],
            limit: 1
          })
        });
        if (!r.ok) {
          const detail = await r.text();
          throw new Error(`HubSpot search HTTP ${r.status}: ${detail}`);
        }
        const data = await r.json();
        company = data.results && data.results[0] || null;
      } catch (e) {
        console.log(`[sync-hubspot] ${cf}: errore ricerca HubSpot - ${e.message}`);
        return json({ error: "Errore ricerca HubSpot", detail: e.message }, 502);
      }
      if (!company) {
        console.log(`[sync-hubspot] ${cf}: skip, nessuna company HubSpot trovata (ricerca)`);
        return json({ skipped: true, motivo: "nessuna company HubSpot con questo CF/PIVA" });
      }
      try {
        const r = await patchCompany(company.id);
        if (!r.ok) {
          const detail = await r.text();
          throw new Error(`HubSpot PATCH HTTP ${r.status}: ${detail}`);
        }
      } catch (e) {
        console.log(`[sync-hubspot] ${cf}: errore scrittura HubSpot (ricerca) - ${e.message}`);
        return json({ error: "Errore scrittura HubSpot", detail: e.message }, 502);
      }
      cache[cf] = company.id;
      await env.RNA_DB.put("state:hubspot_ids", JSON.stringify(cache));
      console.log(`[sync-hubspot] ${cf}: OK (ricerca), company ${company.id}, valore ${valoreScritto} \u2014 id salvato in cache`);
      return json({ ok: true, hubspot_company_id: company.id, valore_scritto: valoreScritto });
    }
    if (path === "/api/ai/analizza-pdf" && method === "POST") {
      if (!env.ANTHROPIC_API_KEY) {
        return json({ error: "API key Anthropic non configurata" }, 500);
      }
      try {
        const body = await request.json();
        const { base64, mediaType } = body;
        if (!base64) return json({ error: "base64 mancante" }, 400);
        const prompt = `Sei un esperto di report Cerved gruppi societari italiani.
Analizza il documento ed estrai le societ\xE0 del gruppo con sede in ITALIA.

REGOLE:
- Includi SOLO societ\xE0 con codice fiscale italiano (11 cifre numeriche) o con sede in Italia
- Escludi societ\xE0 estere (Germania, Francia, Serbia, Croazia, USA, UK, Cina, ecc.)
- Escludi societ\xE0 con quota diretta inferiore al 5%
- Per ogni societ\xE0 restituisci SOLO questi campi: nome, cf, quota, livello, tipo, sel
- "tipo": "controllata" se quota>=50%, "partecipata" se quota<50%, "verifica_manuale" se quota non disponibile
- "sel": true se quota>=50%, false altrimenti
- "cf": codice fiscale 11 cifre oppure "" se non disponibile
- "livello": SEMPRE una stringa tra virgolette (es. "1", "1.2", "1.2.1"), MAI un numero nudo, anche per gerarchie profonde

Rispondi SOLO con JSON valido, nessun testo prima o dopo, nessun markdown:
{"nome_gruppo":"...","societa":[{"nome":"...","cf":"...","quota":100,"livello":"1","tipo":"controllata","sel":true}]}`;
        const risposta = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01"
          },
          body: JSON.stringify({
            model: "claude-sonnet-5-5",
            max_tokens: 9e3,
            messages: [{
              role: "user",
              content: [
                {
                  type: "document",
                  source: {
                    type: "base64",
                    media_type: mediaType || "application/pdf",
                    data: base64
                  }
                },
                { type: "text", text: prompt }
              ]
            }]
          })
        });
        if (!risposta.ok) {
          const err = await risposta.text();
          return json({ error: "Anthropic error: " + err }, 502);
        }
        const data = await risposta.json();
        const testo = data.content.filter((b) => b.type === "text").map((b) => b.text).join("");
        let cleaned = testo.replace(/```json|```/g, "").trim();
        const start = cleaned.indexOf("{");
        const end = cleaned.lastIndexOf("}");
        if (start !== -1 && end !== -1) cleaned = cleaned.slice(start, end + 1);
        cleaned = cleaned.replace(/"livello"\s*:\s*(\d+(?:\.\d+){2,})/g, '"livello": "$1"');
        cleaned = cleaned.replace(/,\s*([}\]])/g, "$1").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
        let parsed;
        try {
          parsed = JSON.parse(cleaned);
        } catch (parseErr) {
          return json({
            error: "JSON non valido dalla risposta AI: " + parseErr.message,
            raw: cleaned.slice(0, 2e3)
          }, 502);
        }
        return json(parsed);
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }
    if (path === "/api/rna/azienda") {
      const cf = url.searchParams.get("cf");
      if (!cf) return json({ error: "cf mancante" }, 400);
      const body = new URLSearchParams();
      body.append("values[cfBen]", cf.toUpperCase().trim());
      body.append("values[count]", "1");
      try {
        const r = await fetch("https://www.rna.gov.it/rna/oracle/query/trasparenza/aiuti", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "application/json",
            "Origin": "https://www.rna.gov.it",
            "Referer": "https://www.rna.gov.it/RegistroNazionaleTrasparenza/faces/pages/TrasparenzaAiuto.jspx"
          },
          body: body.toString()
        });
        if (!r.ok) return json({ error: "RNA error", status: r.status }, 502);
        const data = await r.json();
        return json(data);
      } catch (e) {
        return json({ error: "Errore chiamata RNA", detail: e.message }, 502);
      }
    }
    if (path === "/api/rna/dettaglio") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "id mancante" }, 400);
      const pageUrl = `https://www.rna.gov.it/trasparenza/aiuti/${id}`;
      let lastError = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const r = await fetch(pageUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
              "Accept-Language": "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7",
              "Accept-Encoding": "gzip, deflate, br",
              "Cache-Control": "no-cache",
              "Pragma": "no-cache",
              "Sec-Fetch-Dest": "document",
              "Sec-Fetch-Mode": "navigate",
              "Sec-Fetch-Site": "same-origin",
              "Sec-Fetch-User": "?1",
              "Upgrade-Insecure-Requests": "1",
              "Origin": "https://www.rna.gov.it",
              "Referer": "https://www.rna.gov.it/RegistroNazionaleTrasparenza/faces/pages/TrasparenzaAiuto.jspx"
            }
          });
          if (!r.ok) {
            lastError = `HTTP ${r.status}`;
            await new Promise((res) => setTimeout(res, 2e3 * (attempt + 1)));
            continue;
          }
          const html = await r.text();
          const autoritaConcedente = estraiCampo(html, "Autorit[\xE0a&#;0-9]*\\s*Concedente") || estraiCampo(html, "Concedente");
          const dimensioneRaw = estraiCampo(html, "Dimensione\\s*Beneficiar[io]*") || estraiCampo(html, "Dimensione");
          const dimensioneBeneficiario = normalizzaDimensione(dimensioneRaw);
          const componenti = [];
          const tbodyRx = /<tbody[\s\S]*?>([\s\S]*?)<\/tbody>/gi;
          let tbodyMatch;
          while ((tbodyMatch = tbodyRx.exec(html)) !== null) {
            const tbodyContent = tbodyMatch[1];
            const righe = tbodyContent.split(/<tr[\s\S]*?>/i).slice(1);
            for (const riga of righe) {
              if (!riga.trim() || riga.trim() === "</tbody>") continue;
              const celle = [];
              const tdRx = /<td[^>]*>([\s\S]*?)<\/td>/gi;
              let m;
              while ((m = tdRx.exec(riga)) !== null) {
                const testo = m[1].replace(/<[^>]+>/g, "").replace(/&euro;/gi, "\u20AC").replace(/&#039;/gi, "'").replace(/&amp;/gi, "&").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
                celle.push(testo);
              }
              if (celle.length >= 9 && celle[1]) {
                componenti.push({
                  id_componente: celle[0] || "",
                  tipo_procedimento: celle[1] || "",
                  regolamento: celle[2] || "",
                  obiettivo: celle[3] || "",
                  settore: celle[4] || "",
                  soggetto_interm: celle[5] || "",
                  strumento_aiuto: celle[6] || "",
                  importo_nominale: celle[7] || "",
                  elemento_aiuto: celle[8] || ""
                });
              }
            }
            if (componenti.length > 0) break;
          }
          let classificazione = "notifica";
          let tipoProcedimento = "";
          if (componenti.length > 0) {
            tipoProcedimento = componenti[0].tipo_procedimento;
            const hasDM = componenti.some(
              (c) => c.tipo_procedimento.toLowerCase().includes("minim")
            );
            const hasNonDM = componenti.some(
              (c) => !c.tipo_procedimento.toLowerCase().includes("minim")
            );
            if (hasDM && hasNonDM) classificazione = "misto";
            else if (hasDM) classificazione = "de minimis";
            else {
              const tp = tipoProcedimento.toLowerCase();
              if (tp.includes("esenzione") || tp.includes("exempt"))
                classificazione = "esenzione";
              else
                classificazione = "notifica";
            }
          }
          return json({
            id_concessione: id,
            tipo_procedimento: tipoProcedimento,
            classificazione,
            regolamento: componenti[0]?.regolamento || "",
            strumento_aiuto: componenti[0]?.strumento_aiuto || "",
            autorita_concedente: autoritaConcedente,
            dimensione_beneficiario: dimensioneBeneficiario,
            dimensione_raw: dimensioneRaw,
            componenti,
            url_fonte: pageUrl,
            // Debug info
            n_componenti: componenti.length,
            html_length: html.length
          });
        } catch (e) {
          lastError = e.message;
          await new Promise((res) => setTimeout(res, 2e3 * (attempt + 1)));
        }
      }
      return json({
        error: "Errore scraping dettaglio dopo 3 tentativi",
        detail: lastError,
        id_concessione: id,
        componenti: [],
        classificazione: "in_elaborazione",
        tipo_procedimento: "",
        regolamento: "",
        strumento_aiuto: "",
        autorita_concedente: "",
        dimensione_beneficiario: "",
        dimensione_raw: "",
        url_fonte: pageUrl
      }, 502);
    }
    if (path === "/api/rna/misure") {
      const params = new URLSearchParams();
      ["titolo", "ente", "regione", "tipo", "anno", "car"].forEach((f) => {
        const v = url.searchParams.get(f);
        if (v) params.append(`values[${f}]`, v);
      });
      params.append("values[count]", "1");
      try {
        const r = await fetch("https://www.rna.gov.it/rna/oracle/query/trasparenza/misure", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/json",
            "Origin": "https://www.rna.gov.it",
            "Referer": "https://www.rna.gov.it/RegistroNazionaleTrasparenza/faces/pages/TrasparenzaMisura.jspx"
          },
          body: params.toString()
        });
        const data = await r.json();
        return json(data);
      } catch (e) {
        return json({ error: "Errore ricerca misure", detail: e.message }, 502);
      }
    }
    if (path === "/api/rna/beneficiari") {
      const car = url.searchParams.get("car");
      if (!car) return json({ error: "car mancante" }, 400);
      const params = new URLSearchParams();
      params.append("values[car]", car);
      params.append("values[count]", "1");
      try {
        const r = await fetch("https://www.rna.gov.it/rna/oracle/query/trasparenza/aiuti", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/json",
            "Origin": "https://www.rna.gov.it",
            "Referer": "https://www.rna.gov.it/RegistroNazionaleTrasparenza/faces/pages/TrasparenzaAiuto.jspx"
          },
          body: params.toString()
        });
        const data = await r.json();
        return json(data);
      } catch (e) {
        return json({ error: "Errore ricerca beneficiari", detail: e.message }, 502);
      }
    }
    if (path === "/api/auth/login" && method === "POST") {
      let username, password;
      try {
        const body = await request.json();
        username = body.username;
        password = body.password;
      } catch {
        return json({ error: "Body non valido" }, 400);
      }
      const raw = await env.RNA_DB.get(`auth:credentials:${username}`);
      if (!raw) return json({ error: "Credenziali non valide" }, 401);
      const record = JSON.parse(stripBOM(raw));
      if (record.firstAccess === true) {
        return json({ firstAccess: true, username });
      }
      const hashHex = await sha256Hex(password);
      if (hashHex !== record.passwordHash) {
        return json({ error: "Credenziali non valide" }, 401);
      }
      const token = globalThis.crypto.randomUUID();
      const expiresAt = Date.now() + 8 * 60 * 60 * 1e3;
      await env.RNA_DB.put(`auth:session:${token}`, JSON.stringify({
        username: record.username,
        activeOwner: record.activeOwner,
        role: record.role,
        teams: record.teams,
        displayName: record.displayName,
        expiresAt
      }), { expirationTtl: 28800 });
      return json({
        token,
        username: record.username,
        activeOwner: record.activeOwner,
        role: record.role,
        teams: record.teams,
        displayName: record.displayName
      });
    }
    if (path === "/api/auth/setup" && method === "POST") {
      let username, newPassword;
      try {
        const body = await request.json();
        username = body.username;
        newPassword = body.newPassword;
      } catch {
        return json({ error: "Body non valido" }, 400);
      }
      const raw = await env.RNA_DB.get(`auth:credentials:${username}`);
      if (!raw) return json({ error: "Non autorizzato" }, 403);
      const record = JSON.parse(stripBOM(raw));
      if (record.firstAccess !== true) return json({ error: "Non autorizzato" }, 403);
      if (!newPassword || newPassword.length < 8) {
        return json({ error: "Password troppo corta (min. 8 caratteri)" }, 400);
      }
      const hashHex = await sha256Hex(newPassword);
      await env.RNA_DB.put(`auth:credentials:${username}`, JSON.stringify({
        ...record,
        passwordHash: hashHex,
        firstAccess: false
      }));
      const token = globalThis.crypto.randomUUID();
      const expiresAt = Date.now() + 8 * 60 * 60 * 1e3;
      await env.RNA_DB.put(`auth:session:${token}`, JSON.stringify({
        username: record.username,
        activeOwner: record.activeOwner,
        role: record.role,
        teams: record.teams,
        displayName: record.displayName,
        expiresAt
      }), { expirationTtl: 28800 });
      return json({
        token,
        username: record.username,
        activeOwner: record.activeOwner,
        role: record.role,
        teams: record.teams,
        displayName: record.displayName
      });
    }
    if (path === "/api/auth/switchteam" && method === "POST") {
      const auth = request.headers.get("Authorization") || "";
      const token = auth.replace(/^Bearer\s+/i, "");
      const rawSession = await env.RNA_DB.get(`auth:session:${token}`);
      if (!rawSession) return json({ error: "Sessione scaduta" }, 401);
      const session = JSON.parse(stripBOM(rawSession));
      if (session.expiresAt && session.expiresAt < Date.now()) {
        return json({ error: "Sessione scaduta" }, 401);
      }
      let newOwner;
      try {
        const body = await request.json();
        newOwner = body.newOwner;
      } catch {
        return json({ error: "Body non valido" }, 400);
      }
      if (!Array.isArray(session.teams) || !session.teams.includes(newOwner)) {
        return json({ error: "Owner non autorizzato" }, 403);
      }
      await env.RNA_DB.put(`auth:session:${token}`, JSON.stringify({
        ...session,
        activeOwner: newOwner
      }), { expirationTtl: 28800 });
      return json({ activeOwner: newOwner });
    }
    if (path === "/api/auth/me" && method === "GET") {
      const auth = request.headers.get("Authorization") || "";
      const token = auth.replace(/^Bearer\s+/i, "");
      const rawSession = await env.RNA_DB.get(`auth:session:${token}`);
      if (!rawSession) return json({ error: "Sessione scaduta" }, 401);
      const session = JSON.parse(stripBOM(rawSession));
      if (session.expiresAt < Date.now()) {
        await env.RNA_DB.delete(`auth:session:${token}`);
        return json({ error: "Sessione scaduta" }, 401);
      }
      return json({
        username: session.username,
        activeOwner: session.activeOwner,
        role: session.role,
        teams: session.teams,
        displayName: session.displayName
      });
    }
    return json({ error: "Endpoint non trovato", path }, 404);
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map

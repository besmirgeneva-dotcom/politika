
import { GoogleGenAI, Type } from "@google/genai";
import { GameEvent, SimulationResponse, ChatMessage, ChaosLevel, Alliance } from "../types";
import { normalizeCountryName } from "../constants";

// --- CONFIGURATION ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const GROQ_API_KEY = process.env.VITE_GROQ_API_KEY || "";

export type AIProvider = 'gemini' | 'groq' | 'huggingface';

// Helper pour estimer les tokens (approx 4 chars = 1 token)
const estimateTokens = (input: string, output: string): number => {
    return Math.ceil((input.length + output.length) / 4);
};

// --- JSON EXTRACTION HELPER (ROBUST) ---
// Extrait le JSON valide même s'il est entouré de texte, en comptant la profondeur des accolades/crochets.
const extractJson = (text: string): string => {
    // 1. Trouver le premier caractère ouvrant
    const match = text.match(/(\{|\[)/);
    if (!match) return "{}";
    
    const startIndex = match.index!;
    const openChar = match[0];
    const closeChar = openChar === '{' ? '}' : ']';
    
    let depth = 0;
    let inString = false;
    let escape = false;

    // 2. Parcourir pour trouver la fermeture correspondante exacte
    for (let i = startIndex; i < text.length; i++) {
        const char = text[i];
        
        // Gestion des échappements et chaines de caractères
        if (escape) {
            escape = false;
            continue;
        }
        if (char === '\\') {
            escape = true;
            continue;
        }
        if (char === '"') {
            inString = !inString;
            continue;
        }
        
        // Comptage de profondeur (hors string)
        if (!inString) {
            if (char === openChar) {
                depth++;
            } else if (char === closeChar) {
                depth--;
                // Si on revient à 0, c'est la fin du JSON valide
                if (depth === 0) {
                    return text.substring(startIndex, i + 1);
                }
            }
        }
    }
    
    // Fallback: Si on n'a pas trouvé la fermeture (JSON tronqué?), on renvoie tout depuis le début
    // en espérant que le parser s'en sorte ou échoue proprement.
    return text.substring(startIndex);
};

// --- OPTIMIZATION: MINIFIED SCHEMA KEYS ---
const MINIFIED_SCHEMA = {
    type: Type.OBJECT,
    properties: {
      ti: { type: Type.STRING, enum: ["day", "month", "year"] },
      ev: { 
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            t: { type: Type.STRING, enum: ["world", "crisis", "economy", "war", "alliance"] },
            h: { type: Type.STRING },
            d: { type: Type.STRING },
            rc: { type: Type.STRING }
          },
          required: ["t", "h", "d"]
        },
      },
      gt: { type: Type.INTEGER }, // globalTensionChange
      ec: { type: Type.INTEGER }, // economyHealthChange
      mi: { type: Type.INTEGER }, // militaryPowerChange
      po: { type: Type.INTEGER }, // popularityChange
      co: { type: Type.INTEGER }, // corruptionChange
      sp: { type: Type.BOOLEAN }, // spaceProgramActive
      nu: { type: Type.BOOLEAN }, // nuclearAcquired (NEW)
      mu: { // mapUpdates
        type: Type.ARRAY,
        items: {
            type: Type.OBJECT,
            properties: {
                t: { type: Type.STRING, enum: ['annexation', 'build_base', 'build_air_base', 'build_defense', 'remove_entity', 'dissolve'] },
                tc: { type: Type.STRING }, // targetCountry
                no: { type: Type.STRING }, // newOwner
                lat: { type: Type.NUMBER },
                lng: { type: Type.NUMBER },
                lbl: { type: Type.STRING }, // label
                id: { type: Type.STRING } // entityId
            },
            required: ['t', 'tc']
        }
      },
      iu: { // infrastructureUpdates
          type: Type.ARRAY,
          items: {
              type: Type.OBJECT,
              properties: {
                  c: { type: Type.STRING }, // country
                  t: { type: Type.STRING }, // type
                  v: { type: Type.INTEGER } // change
              },
              required: ["c", "t", "v"]
          }
      },
      im: { // incomingMessages
          type: Type.ARRAY,
          items: {
              type: Type.OBJECT,
              properties: {
                  s: { type: Type.STRING }, // sender
                  tx: { type: Type.STRING }, // text
                  tg: { type: Type.ARRAY, items: { type: Type.STRING } } // targets
              },
              required: ["s", "tx", "tg"]
          }
      },
      au: { // allianceUpdate
          type: Type.OBJECT,
          properties: {
              a: { type: Type.STRING, enum: ["create", "update", "dissolve"] }, // action
              n: { type: Type.STRING }, // name
              t: { type: Type.STRING }, // type
              m: { type: Type.ARRAY, items: { type: Type.STRING } }, // members
              l: { type: Type.STRING } // leader
          },
          required: ["a"]
      }
    },
    required: ["ti", "ev", "gt", "ec", "mi", "po", "co"],
};

// Map the minified JSON back to the full SimulationResponse for the app
// AJOUT: Sécurisation avec || '' ou || 0 pour éviter les null/undefined qui cassent l'UI
const mapMinifiedToFull = (min: any, tokens: number = 0): SimulationResponse => {
    return {
        timeIncrement: min.ti || 'day',
        tokenUsage: tokens,
        events: Array.isArray(min.ev) ? min.ev.map((e: any) => ({
            type: e.t || 'world',
            headline: e.h || 'Événement inconnu',
            description: e.d || 'Aucun détail disponible.', 
            relatedCountry: e.rc ? String(e.rc) : undefined
        })) : [],
        globalTensionChange: min.gt || 0,
        economyHealthChange: min.ec || 0,
        militaryPowerChange: min.mi || 0,
        popularityChange: min.po || 0,
        corruptionChange: min.co || 0,
        spaceProgramActive: !!min.sp,
        nuclearAcquired: !!min.nu,
        mapUpdates: Array.isArray(min.mu) ? min.mu.map((u: any) => ({
            type: u.t,
            targetCountry: u.tc ? String(u.tc) : "Inconnu",
            newOwner: u.no ? String(u.no) : undefined,
            lat: Number(u.lat) || 0,
            lng: Number(u.lng) || 0,
            label: u.lbl ? String(u.lbl) : undefined,
            entityId: u.id ? String(u.id) : undefined
        })) : undefined,
        infrastructureUpdates: Array.isArray(min.iu) ? min.iu.map((i: any) => ({
            country: String(i.c),
            type: String(i.t),
            change: Number(i.v)
        })) : undefined,
        incomingMessages: Array.isArray(min.im) ? min.im.map((m: any) => ({
            sender: m.s ? String(m.s) : "Inconnu",
            text: m.tx ? String(m.tx) : "...",
            targets: Array.isArray(m.tg) ? m.tg.map(String) : []
        })) : undefined,
        allianceUpdate: min.au ? {
            action: min.au.a,
            name: min.au.n ? String(min.au.n) : undefined,
            type: min.au.t ? String(min.au.t) : undefined,
            members: Array.isArray(min.au.m) ? min.au.m.map(String) : [],
            leader: min.au.l ? String(min.au.l) : undefined
        } : undefined
    };
};

// --- RETRY LOGIC ---
const withRetry = async <T>(fn: () => Promise<T>, retries = 3, delay = 2000): Promise<T> => {
    try {
        return await fn();
    } catch (error: any) {
        let isRateLimit = error?.status === 429 || error?.message?.includes("429");
        let isServerOverload = error?.status === 503 || error?.message?.includes("503");
        
        if (retries > 0 && (isRateLimit || isServerOverload)) {
            const jitter = Math.random() * 500;
            await new Promise(r => setTimeout(r, delay + jitter));
            return withRetry(fn, retries - 1, delay * 2);
        }
        throw error;
    }
};

const generateRobustContent = async (prompt: string, config: any): Promise<any> => {
    try {
        return await withRetry(async () => {
            return await ai.models.generateContent({
                model: "gemini-3-flash-preview",
                contents: prompt,
                config: config
            });
        }, 3, 2000);
    } catch (error) {
        console.warn("Primary model failed, utilizing fallback.");
        try {
            return await withRetry(async () => {
                return await ai.models.generateContent({
                    model: "gemini-flash-lite-latest",
                    contents: prompt,
                    config: config
                });
            }, 2, 3000);
        } catch (fbError) { throw fbError; }
    }
};

// --- SYSTEM INSTRUCTIONS ---
const SYSTEM_INSTRUCTION = `
Moteur GeoSim. Simulation Géopolitique.
RÈGLES CRITIQUES:
1. NARRATION: Tu es le maître du jeu.
2. ÉVÉNEMENTS (OBLIGATOIRE):
   - Tu DOIS générer au moins 2 événements dans le tableau 'ev' à CHAQUE réponse.
   - Si le joueur fait une action, le premier événement 'ev' doit décrire le résultat (succès/échec).
   - Le second événement doit être une actualité mondiale (crise, économie, guerre ailleurs).
   - NE RENVOIE JAMAIS 'ev' VIDE.
3. STATISTIQUES: Fais évoluer les valeurs (gt, ec, mi, po, co) selon l'action.
4. FORMAT JSON MINIFIÉ (Clés):
   - ev: Liste d'événements [{t:type, h:titre, d:desc}]. Types: 'world', 'crisis', 'economy', 'war'.
   - gt: Global Tension Change (+/- int)
   - ec: Economy Change
   - mi: Military Change
   - po: Popularity Change
   - co: Corruption Change
   - mu: Map Updates (annexation, build_base...)
`;

export const simulateTurn = async (
  playerCountry: string,
  currentDate: string,
  playerAction: string,
  recentHistory: GameEvent[],
  ownedTerritories: string[] = [],
  entitiesSummary: string = "",
  isLandlocked: boolean = false,
  hasNuclear: boolean = false,
  diplomaticContext: string = "",
  chaosLevel: ChaosLevel = 'normal',
  provider: AIProvider = 'gemini',
  playerPower: number = 50,
  alliance: Alliance | null = null,
  neutralTerritories: string[] = [] 
): Promise<SimulationResponse> => {
  
  const hist = recentHistory.slice(-5).map(e => `[${e.date}]${e.type}:${e.headline}`).join(';');
  const allContext = alliance ? `ALLIANCE:${alliance.name}` : "Non-aligné";
  
  let territoryStr = ownedTerritories.join(',');
  if (ownedTerritories.length > 8) {
    const core = ownedTerritories.slice(0, 3).join(',');
    territoryStr = `${core} (+${ownedTerritories.length - 3} others)`;
  }

  const neutralStr = neutralTerritories.length > 0 
      ? (neutralTerritories.length > 20 
          ? `${neutralTerritories.slice(0, 20).join(',')} (+${neutralTerritories.length - 20} déserts)` 
          : neutralTerritories.join(',')) 
      : "Aucun";
  
  const prompt = `
    CONTEXTE:
    Date:${currentDate} | Pays:${playerCountry} | Puissance:${playerPower}
    Nucléaire:${hasNuclear ? "OUI" : "NON"} | Géo:${isLandlocked ? "Enclavé" : "Accès Mer"}
    Alliances:${allContext} | Chaos:${chaosLevel}
    Territoires:${territoryStr}
    
    ACTION JOUEUR: "${playerAction || "Gouverner le pays"}"
    
    HISTORIQUE RÉCENT: ${hist}
    
    TÂCHE: Simuler le tour en JSON.
    IMPÉRATIF:
    1. Calcule les changements de stats (gt, ec, mi...).
    2. REMPLIS OBLIGATOIREMENT le tableau 'ev' avec 2 ou 3 événements narratifs (Réussite de l'action joueur + Actualité mondiale).
  `;

  if (provider === 'groq' && GROQ_API_KEY) {
      try {
          const rawStr = await callGroq(prompt, SYSTEM_INSTRUCTION, true, null);
          const jsonStr = extractJson(rawStr);
          return mapMinifiedToFull(JSON.parse(jsonStr), estimateTokens(prompt, jsonStr));
      } catch (e) { 
          console.warn("Groq fail, fallback Gemini", e); 
          // Continue to fallback
      }
  } 

  try {
      const response = await generateRobustContent(prompt, {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          responseSchema: MINIFIED_SCHEMA,
          temperature: 0.9, 
      });
      return mapMinifiedToFull(JSON.parse(response.text), estimateTokens(prompt, response.text));
  } catch (error) { 
      console.error("Gemini Error", error);
      return getFallbackResponse(); 
  }
};

const callGroq = async (prompt: string, system: string, jsonMode: boolean = true, schema: any = null): Promise<string> => {
    try {
        if (!GROQ_API_KEY) throw new Error("No Groq Key");
        let sys = system;
        if (jsonMode) sys += " REPOND UNIQUEMENT EN JSON VALIDE.";
        
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                messages: [{ role: "system", content: sys }, { role: "user", content: prompt }],
                model: "llama-3.3-70b-versatile",
                temperature: 0.85,
                max_tokens: 2048,
                response_format: jsonMode ? { type: "json_object" } : undefined
            })
        });
        if (!response.ok) throw new Error(`Groq ${response.status}`);
        const data = await response.json();
        return data.choices[0]?.message?.content || "";
    } catch (e) { throw e; }
};

export const sendDiplomaticMessage = async (
    playerCountry: string,
    targets: string[],
    message: string,
    history: ChatMessage[],
    context: any,
    provider: AIProvider = 'gemini'
): Promise<{ messages: { sender: string, text: string }[], usage: number }> => {
    
    const targetSet = new Set(targets.map(t => normalizeCountryName(t)));
    
    const conv = history
        .filter(msg => {
            const msgParticipants = new Set<string>();
            if (msg.sender === 'player') {
                msg.targets.forEach(t => msgParticipants.add(normalizeCountryName(t)));
            } else {
                msgParticipants.add(normalizeCountryName(msg.senderName));
                msg.targets.forEach(t => {
                    const norm = normalizeCountryName(t);
                    if (norm !== playerCountry) msgParticipants.add(norm);
                });
            }
            
            if (msgParticipants.size !== targetSet.size) return false;
            for (const p of msgParticipants) {
                if (!targetSet.has(p)) return false;
            }
            return true;
        })
        .slice(-6)
        .map(msg => `${msg.sender === 'player' ? 'Moi' : msg.senderName}:${msg.text}`)
        .join('|');

    const contextStr = JSON.stringify(context);

    const prompt = `
    CONTEXTE GLOBAL JEU: ${contextStr}
    INTERLOCUTEURS (IA): ${targets.join(',')}
    JOUEUR (Moi): ${playerCountry}
    HISTORIQUE: ${conv}
    MESSAGE DU JOUEUR: "${message}"
    TÂCHE: Répondre en tant que les pays ciblés. FORMAT SORTIE: JSON: [{"s":"NomPays","t":"MessageCourt"}]
    `;

    const CHAT_SCHEMA = {
        type: Type.ARRAY,
        items: {
            type: Type.OBJECT,
            properties: { s: { type: Type.STRING }, t: { type: Type.STRING } },
            required: ["s", "t"]
        }
    };

    if (provider === 'groq' && GROQ_API_KEY) {
        try {
            const rawStr = await callGroq(prompt, "Chef d'état. JSON: [{'s':'Pays','t':'Message'}]", true);
            const jsonStr = extractJson(rawStr);
            const raw = JSON.parse(jsonStr);
            
            // Normalisation des données pour éviter les crashs si l'IA renvoie null
            const arr = Array.isArray(raw) ? raw : (raw.messages || [raw]);
            return { 
                messages: arr.map((r: any) => ({ 
                    sender: r.s ? String(r.s) : (targets[0] || 'Inconnu'), 
                    text: r.t ? String(r.t) : "..." 
                })), 
                usage: estimateTokens(prompt, jsonStr) 
            };
        } catch (e) { 
            console.warn("Groq fail chat", e); 
            // Continue fallback
        }
    }
    
    try {
        const response = await generateRobustContent(prompt, { 
            responseMimeType: "application/json",
            responseSchema: CHAT_SCHEMA,
            temperature: 0.7 
        });
        const raw = JSON.parse(response.text);
        const messages = raw.map((r: any) => ({ 
            sender: r.s ? String(r.s) : (targets[0] || 'Inconnu'), 
            text: r.t ? String(r.t) : "..." 
        })) || [];
        return { messages, usage: estimateTokens(prompt, response.text) };
    } catch (e) { 
        return { messages: [{ sender: targets[0], text: "..." }], usage: 0 }; 
    }
}

const getFallbackResponse = (): SimulationResponse => {
    return {
        timeIncrement: 'day',
        tokenUsage: 0,
        events: [{ type: "world", headline: "Silence Radio", description: "Aucune information." }],
        globalTensionChange: 0, 
        economyHealthChange: 0, 
        militaryPowerChange: 0, 
        popularityChange: 0, 
        corruptionChange: 0
    };
};

export const getStrategicSuggestions = async (
    playerCountry: string,
    recentHistory: GameEvent[],
    provider: AIProvider = 'gemini'
): Promise<{ suggestions: string[], usage: number }> => {
    const hist = recentHistory.slice(-3).map(e => e.headline).join(';');
    const prompt = `3 actions courtes pour ${playerCountry}. Contexte:${hist}. JSON:{"s":["..."]}`;
    try {
        if (provider === 'groq' && GROQ_API_KEY) {
             const rawStr = await callGroq(prompt, "Conseiller stratégique. JSON.", true);
             const jsonStr = extractJson(rawStr);
             const p = JSON.parse(jsonStr);
             const list = p.s || p.suggestions || p;
             return { 
                 suggestions: Array.isArray(list) ? list.map(String) : [], 
                 usage: estimateTokens(prompt, jsonStr) 
             };
        }
        const response = await generateRobustContent(prompt, { responseMimeType: "application/json" });
        const p = JSON.parse(response.text);
        const list = p.s || p.suggestions || p;
        return { 
            suggestions: Array.isArray(list) ? list.map(String) : [], 
            usage: estimateTokens(prompt, response.text) 
        };
    } catch (e) { return { suggestions: ["Développer Industrie", "Renforcer Armée"], usage: 0 }; }
}

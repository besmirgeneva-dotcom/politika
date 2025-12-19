
import { GoogleGenAI, Type } from "@google/genai";
import { GameEvent, SimulationResponse, ChatMessage, ChaosLevel, Alliance } from "../types";
import { normalizeCountryName } from "../constants";

// --- CONFIGURATION ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const GROQ_API_KEY = process.env.VITE_GROQ_API_KEY || "";
// HUGGINGFACE Removed due to CORS issues

export type AIProvider = 'gemini' | 'groq' | 'huggingface';

// Helper pour estimer les tokens (approx 4 chars = 1 token)
const estimateTokens = (input: string, output: string): number => {
    return Math.ceil((input.length + output.length) / 4);
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
                t: { type: Type.STRING, enum: ['annexation', 'build_base', 'build_defense', 'remove_entity', 'dissolve'] },
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
const mapMinifiedToFull = (min: any, tokens: number = 0): SimulationResponse => {
    return {
        timeIncrement: min.ti || 'day',
        tokenUsage: tokens,
        events: min.ev?.map((e: any) => ({
            type: e.t || 'world',
            headline: e.h || 'Événement inconnu',
            description: e.d || 'Aucun détail disponible.', // Sécurisation ici
            relatedCountry: e.rc
        })) || [],
        globalTensionChange: min.gt || 0,
        economyHealthChange: min.ec || 0,
        militaryPowerChange: min.mi || 0,
        popularityChange: min.po || 0,
        corruptionChange: min.co || 0,
        spaceProgramActive: min.sp,
        nuclearAcquired: min.nu,
        mapUpdates: min.mu?.map((u: any) => ({
            type: u.t,
            targetCountry: u.tc,
            newOwner: u.no,
            lat: u.lat,
            lng: u.lng,
            label: u.lbl,
            entityId: u.id
        })),
        infrastructureUpdates: min.iu?.map((i: any) => ({
            country: i.c,
            type: i.t,
            change: i.v
        })),
        incomingMessages: min.im?.map((m: any) => ({
            sender: m.s,
            text: m.tx,
            targets: m.tg
        })),
        allianceUpdate: min.au ? {
            action: min.au.a,
            name: min.au.n,
            type: min.au.t,
            members: min.au.m,
            leader: min.au.l
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
1. NARRATION DYNAMIQUE: Ne te contente pas de confirmer les ordres. Décris les RÉACTIONS du monde. Si le joueur est puissant/nucléaire, ses voisins doivent s'inquiéter, protester ou s'armer.
2. ÉVÉNEMENTS AUTONOMES: Si le joueur passe son tour ou fait une action mineure, TU DOIS IMPÉRATIVEMENT générer des événements mondiaux intéressants (Coups d'état, crises éco, tensions frontalières, avancées techno) sans lien direct avec le joueur pour rendre le monde vivant.
3. NUCLÉAIRE: Si 'Nuc:OUI' dans le prompt, l'IA doit générer de la tension diplomatique, des sanctions ou de la peur chez les voisins.
4. CARTE/STATS: Utilise les clés JSON (mu, gt, ec...) uniquement si nécessaire.
5. FORMAT: JSON minifié valide.
6. INTERDICTION MESSAGE: Ne jamais générer de message diplomatique (im) venant du pays du joueur. Ne jamais répéter les données techniques (INFRA:...) dans les textes.
7. PAYS VIDE: Les pays dans 'TERRES_DESOLEES' sont vides/détruits. Le joueur peut les annexer sans résistance (type: 'annexation').
`;

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
  neutralTerritories: string[] = [] // NOUVEAU
): Promise<SimulationResponse> => {
  
  const hist = recentHistory.slice(-5).map(e => `[${e.date}]${e.type}:${e.headline}`).join(';');
  const allContext = alliance ? `ALLIANCE:${alliance.name}` : "Non-aligné";
  
  let territoryStr = ownedTerritories.join(',');
  if (ownedTerritories.length > 8) {
    const core = ownedTerritories.slice(0, 3).join(',');
    territoryStr = `${core} (+${ownedTerritories.length - 3} others)`;
  }

  const neutralStr = neutralTerritories.length > 0 ? neutralTerritories.join(',') : "Aucun";
  
  // Prompt enrichi avec le contexte nucléaire, géographique et les pays vides
  const prompt = `
    CONTEXTE:
    Date:${currentDate} | Pays:${playerCountry} | Puissance:${playerPower}
    Nucléaire:${hasNuclear ? "OUI (Menace)" : "NON"} | Géo:${isLandlocked ? "Enclavé" : "Accès Mer"}
    Alliances:${allContext} | Chaos:${chaosLevel}
    Territoires:${territoryStr}
    TERRES_DESOLEES (Vides/Détruits): ${neutralStr}
    
    ACTION JOUEUR: "${playerAction || "Aucun ordre spécifique (Le pays tourne au ralenti)"}"
    
    HISTORIQUE: ${hist}
    INFRA: ${entitiesSummary}
    DIPLO: ${diplomaticContext}
    
    TÂCHE: Simuler le tour. IMPORTANT: Si l'action joueur est vide/passive, TU DOIS OBLIGATOIREMENT générer au moins 1 événement mondial majeur (guerre ailleurs, économie, catastrophe) pour que le jeu continue d'être intéressant. Si attaque pays vide -> annexion immédiate.
  `;

  if (provider === 'groq' && GROQ_API_KEY) {
      try {
          const jsonStr = await callGroq(prompt, SYSTEM_INSTRUCTION, true, null);
          return mapMinifiedToFull(JSON.parse(jsonStr), estimateTokens(prompt, jsonStr));
      } catch (e) { console.warn("Groq fail, fallback Gemini", e); }
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

// Corrected filtering for chat to isolate group contexts strictly
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

    // NOUVEAU: Stringify du contexte pour injection réelle
    const contextStr = JSON.stringify(context);

    // Prompt amélioré pour forcer l'IA à utiliser le contexte
    const prompt = `
    CONTEXTE GLOBAL JEU: ${contextStr}
    (Utilise ces stats pour déterminer si les interlocuteurs doivent avoir peur, être respectueux ou méprisants).
    
    INTERLOCUTEURS (IA): ${targets.join(',')}
    JOUEUR (Moi): ${playerCountry}
    
    HISTORIQUE CONVERSATION:
    ${conv}
    
    NOUVEAU MESSAGE DU JOUEUR: "${message}"
    
    TÂCHE: Répondre en tant que les pays ciblés (INTERLOCUTEURS). 
    - Si le joueur est puissant/nucléaire (voir contexte), sois prudent.
    - Si le joueur est faible, sois arrogant.
    - Sois bref et direct.
    
    FORMAT SORTIE: JSON minifié: [{"s":"NomPays","t":"MessageCourt"}]
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
            const jsonStr = await callGroq(prompt, "Tu es chef d'état. Repond JSON: [{'s':'Pays','t':'Message'}]", true);
            const raw = JSON.parse(jsonStr);
            const arr = Array.isArray(raw) ? raw : (raw.messages || [raw]);
            return { 
                messages: arr.map((r: any) => ({ sender: r.s, text: r.t })), 
                usage: estimateTokens(prompt, jsonStr) 
            };
        } catch (e) { console.warn("Groq fail"); }
    }
    
    try {
        const response = await generateRobustContent(prompt, { 
            responseMimeType: "application/json",
            responseSchema: CHAT_SCHEMA,
            temperature: 0.7 
        });
        const raw = JSON.parse(response.text);
        const messages = raw.map((r: any) => ({ sender: r.s, text: r.t })) || [];
        return { messages, usage: estimateTokens(prompt, response.text) };
    } catch (e) { 
        return { messages: [{ sender: targets[0], text: "..." }], usage: 0 }; 
    }
}

const getFallbackResponse = (): SimulationResponse => {
    const r = () => Math.floor(Math.random() * 5) - 2;
    return {
        timeIncrement: 'day',
        tokenUsage: 0,
        events: [{ type: "world", headline: "Silence Radio", description: "Aucune information majeure reçue ce jour." }],
        globalTensionChange: r(), 
        economyHealthChange: r(), 
        militaryPowerChange: 0, 
        popularityChange: r(), 
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
             const j = await callGroq(prompt, "Conseiller stratégique. JSON.", true);
             const p = JSON.parse(j);
             return { suggestions: p.s || p.suggestions || [], usage: estimateTokens(prompt, j) };
        }
        const response = await generateRobustContent(prompt, { responseMimeType: "application/json" });
        const p = JSON.parse(response.text);
        return { suggestions: p.s || p.suggestions || p, usage: estimateTokens(prompt, response.text) };
    } catch (e) { return { suggestions: ["Développer Industrie", "Renforcer Armée", "Accords Commerciaux"], usage: 0 }; }
}

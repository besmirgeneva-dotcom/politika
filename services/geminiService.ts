
import { GoogleGenAI, Type } from "@google/genai";
import { GameEvent, SimulationResponse, ChatMessage, ChaosLevel, Alliance } from "../types";

// --- CONFIGURATION ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const GROQ_API_KEY = process.env.VITE_GROQ_API_KEY || "";

export type AIProvider = 'gemini' | 'groq';

// --- OPTIMIZATION: MINIFIED SCHEMA KEYS ---
const MINIFIED_SCHEMA = {
    type: Type.OBJECT,
    properties: {
      ti: { type: Type.STRING, enum: ["day", "month", "year"] }, // timeIncrement
      ev: { // events
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            t: { type: Type.STRING, enum: ["world", "crisis", "economy", "war", "alliance"] }, // type
            h: { type: Type.STRING }, // headline
            d: { type: Type.STRING }, // description
            rc: { type: Type.STRING } // relatedCountry
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
      sg: { type: Type.ARRAY, items: { type: Type.STRING } }, // strategicSuggestions (OPTIMIZATION 3)
      mu: { // mapUpdates
        type: Type.ARRAY,
        items: {
            type: Type.OBJECT,
            properties: {
                t: { type: Type.STRING, enum: ['annexation', 'build_base', 'build_defense', 'remove_entity'] },
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
                  v: { type: Type.INTEGER } // change (value)
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

const mapMinifiedToFull = (min: any): SimulationResponse => {
    return {
        timeIncrement: min.ti,
        events: min.ev?.map((e: any) => ({
            type: e.t,
            headline: e.h,
            description: e.d,
            relatedCountry: e.rc
        })) || [],
        globalTensionChange: min.gt || 0,
        economyHealthChange: min.ec || 0,
        militaryPowerChange: min.mi || 0,
        popularityChange: min.po || 0,
        corruptionChange: min.co || 0,
        spaceProgramActive: min.sp,
        strategicSuggestions: min.sg || [], // Capture suggestions
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
                    model: "gemini-2.5-flash-lite-latest",
                    contents: prompt,
                    config: config
                });
            }, 2, 3000);
        } catch (fbError) { throw fbError; }
    }
};

const SYSTEM_INSTRUCTION = `
Tu es le Moteur de Réalité de GeoSim.
RÈGLES STRICTES:
1. CARTE (mapUpdates/mu): UNIQUEMENT pour 'build_base' (militaire/aérien/naval) ou 'build_defense' (radar/silo). 
   SI joueur demande "Usine/Port civil/Infra" -> 'infrastructureUpdates/iu' (PAS sur carte).
2. DIPLOMATIE (incomingMessages/im): Seulement PAYS souverains, ONU, UE, OTAN. Jamais de ministères internes.
3. GAMEPLAY: Arcade/Permissif. Militaire > 60 écrase les faibles.
4. INFRA MEMOIRE: Si input dit "UNCHANGED", utilise ta mémoire contextuelle.
5. CONSEIL: Ajoute TOUJOURS 3 suggestions courtes pour le prochain tour dans 'sg'.
6. FORMAT: Réponds UNIQUEMENT via le schéma JSON minifié fourni.
`;

const callGroq = async (prompt: string, system: string, jsonMode: boolean = true, schema: any = null): Promise<string> => {
    try {
        if (!GROQ_API_KEY) throw new Error("No Groq Key");
        let sys = system;
        if (jsonMode && schema) sys += "\nJSON SCHEMA:\n" + JSON.stringify(schema);
        
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
  alliance: Alliance | null = null
): Promise<SimulationResponse> => {
  
  const hist = recentHistory.slice(-15).map(e => `[${e.date}]${e.type}:${e.headline}`).join('\n');
  const allContext = alliance ? `ALLIANCE:${alliance.name}(${alliance.leader})` : "NON-ALIGNÉ";
  
  // OPTIMIZATION 1: TERRITORIES TRUNCATION
  const territoriesStr = ownedTerritories.length > 5 
    ? `${ownedTerritories[0]} (+${ownedTerritories.length - 1} territoires)` 
    : ownedTerritories.join(',');

  const prompt = `
    DATE:${currentDate}|PAYS:${playerCountry}(Mil:${playerPower})|POSS:${territoriesStr}|CHAOS:${chaosLevel}|${allContext}
    ACTION:"${playerAction || "Rien"}"
    HIST:
    ${hist}
    INFRA:${entitiesSummary}
    DIPLO:${diplomaticContext}
    Si constr. CIVILE -> 'iu'. Si MILITAIRE -> 'mu'.
  `;

  if (provider === 'groq' && GROQ_API_KEY) {
      try {
          const jsonStr = await callGroq(prompt, SYSTEM_INSTRUCTION, true, MINIFIED_SCHEMA);
          return mapMinifiedToFull(JSON.parse(jsonStr));
      } catch (e) { console.warn("Groq fail, fallback Gemini"); }
  } 
  
  try {
      const response = await generateRobustContent(prompt, {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          responseSchema: MINIFIED_SCHEMA,
          temperature: 0.85,
      });
      return mapMinifiedToFull(JSON.parse(response.text));
  } catch (error) { return getFallbackResponse(); }
};

export const sendDiplomaticMessage = async (
    playerCountry: string,
    targets: string[],
    message: string,
    history: ChatMessage[],
    context: any,
    provider: AIProvider = 'gemini'
): Promise<{ sender: string, text: string }[]> => {
    
    const conv = history
        .filter(msg => targets.includes(msg.senderName) || (msg.sender === 'player' && msg.targets.some(t => targets.includes(t))))
        .slice(-6)
        .map(msg => `${msg.sender === 'player' ? playerCountry : msg.senderName}:${msg.text}`)
        .join('\n');

    const prompt = `
    Incarne: ${targets.join(', ')}.
    Contexte: Exp=${playerCountry}(Mil:${context.militaryPower}).
    Chat:
    ${conv}
    Msg: "${message}"
    Réponds JSON minifié: [{ "s": "Pays", "t": "..." }]
    `;

    const CHAT_SCHEMA = {
        type: Type.ARRAY,
        items: {
            type: Type.OBJECT,
            properties: {
                s: { type: Type.STRING }, // sender
                t: { type: Type.STRING }  // text
            },
            required: ["s", "t"]
        }
    };

    if (provider === 'groq' && GROQ_API_KEY) {
        try {
            const jsonStr = await callGroq(prompt, "Tu es un chef d'état. JSON.", true, CHAT_SCHEMA);
            const raw = JSON.parse(jsonStr);
            return raw.map((r: any) => ({ sender: r.s, text: r.t }));
        } catch (e) { console.warn("Groq fail"); }
    }
    
    try {
        const response = await generateRobustContent(prompt, { 
            responseMimeType: "application/json",
            responseSchema: CHAT_SCHEMA,
            temperature: 0.7 
        });
        const raw = JSON.parse(response.text);
        return raw.map((r: any) => ({ sender: r.s, text: r.t })) || [];
    } catch (e) { 
        return [{ sender: targets[0], text: "..." }]; 
    }
}

const getFallbackResponse = (): SimulationResponse => ({
    timeIncrement: 'day',
    events: [{ type: "world", headline: "Réseau instable", description: "Connexion aux satellites perdue." }],
    globalTensionChange: 0, economyHealthChange: 0, militaryPowerChange: 0, popularityChange: 0, corruptionChange: 0
});

export const getStrategicSuggestions = async (
    playerCountry: string,
    recentHistory: GameEvent[],
    provider: AIProvider = 'gemini'
): Promise<string[]> => {
    const hist = recentHistory.slice(-5).map(e => e.headline).join('; ');
    const prompt = `Suggère 3 actions pour ${playerCountry}. Contexte: ${hist}. JSON: {"s": ["..."]}`;
    try {
        if (provider === 'groq' && GROQ_API_KEY) {
             const j = await callGroq(prompt, "Conseiller. JSON.", true, { type: "object", properties: { s: { type: "array", items: { type: "string" } } } });
             return JSON.parse(j).s;
        }
        const response = await generateRobustContent(prompt, { responseMimeType: "application/json" });
        const p = JSON.parse(response.text);
        return p.s || p.suggestions || p;
    } catch (e) { return ["Développer l'industrie", "Renforcer l'armée", "Accords commerciaux"]; }
}

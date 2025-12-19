
import { GoogleGenAI, Type } from "@google/genai";
import { GameEvent, SimulationResponse, ChatMessage, ChaosLevel, Alliance } from "../types";
import { normalizeCountryName } from "../constants";

// --- CONFIGURATION ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const GROQ_API_KEY = process.env.VITE_GROQ_API_KEY || "";
const HUGGINGFACE_API_KEY = process.env.VITE_HUGGINGFACE_API_KEY || "";

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
                t: { type: Type.STRING, enum: ['annexation', 'annex_province', 'build_base', 'build_defense', 'remove_entity', 'dissolve'] },
                tc: { type: Type.STRING }, // targetCountry or "Country:Province"
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
        timeIncrement: min.ti,
        tokenUsage: tokens,
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
                    model: "gemini-2.5-flash-lite-latest",
                    contents: prompt,
                    config: config
                });
            }, 2, 3000);
        } catch (fbError) { throw fbError; }
    }
};

// --- SYSTEM INSTRUCTIONS ---
const SYSTEM_INSTRUCTION = `
Moteur GeoSim. Règles:
1. STATS (gt,ec,mi,po,co): DOIVENT CHANGER à chaque tour. Ne laisse jamais tout à 0. Ajoute de la volatilité (-3 à +3) même sans événement majeur.
2. CARTE(mu): 'annexation' (Pays entier), 'annex_province' (Une partie, ex: "France:Normandie"), 'build_base', 'dissolve'.
3. INFRA(iu): Civil seulement.
4. ACTION: Arcade. Si action agressive, tension (gt) doit monter.
5. FORMAT: JSON minifié uniquement.
Si le joueur demande d'attaquer une région spécifique, utilise 'annex_province' avec le nom "Pays:Région".
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

const callHuggingFace = async (prompt: string, system: string): Promise<string> => {
    try {
        if (!HUGGINGFACE_API_KEY) throw new Error("No Hugging Face Key");
        
        const MODEL_ID = "mistralai/Mistral-7B-Instruct-v0.3"; 
        const fullPrompt = `<s>[INST] ${system}\n\n${prompt} [/INST]`;

        const response = await fetch(`https://api-inference.huggingface.co/models/${MODEL_ID}`, {
            method: "POST",
            headers: { 
                "Authorization": `Bearer ${HUGGINGFACE_API_KEY}`, 
                "Content-Type": "application/json" 
            },
            body: JSON.stringify({
                inputs: fullPrompt,
                parameters: {
                    max_new_tokens: 1500,
                    return_full_text: false,
                    temperature: 0.8,
                    do_sample: true
                }
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`HF Error ${response.status}: ${errText}`);
        }

        const data = await response.json();
        let text = Array.isArray(data) ? data[0]?.generated_text : data?.generated_text;
        
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start !== -1 && end !== -1) return text.substring(start, end + 1);
        return text;

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
  
  const hist = recentHistory.slice(-5).map(e => `[${e.date}]${e.type}:${e.headline}`).join(';');
  const allContext = alliance ? `ALLIANCE:${alliance.name}` : "";
  
  let territoryStr = ownedTerritories.join(',');
  if (ownedTerritories.length > 8) {
    const core = ownedTerritories.slice(0, 3).join(',');
    territoryStr = `${core} (+${ownedTerritories.length - 3} others)`;
  }
  
  const prompt = `
    DT:${currentDate}|P:${playerCountry}(Pow:${playerPower})|T:${territoryStr}|C:${chaosLevel}|${allContext}
    ACT:"${playerAction || "Rien"}"
    HIST:${hist}
    INF:${entitiesSummary}
    DIP:${diplomaticContext}
  `;

  if (provider === 'groq' && GROQ_API_KEY) {
      try {
          const jsonStr = await callGroq(prompt, SYSTEM_INSTRUCTION, true, null);
          return mapMinifiedToFull(JSON.parse(jsonStr), estimateTokens(prompt, jsonStr));
      } catch (e) { console.warn("Groq fail, fallback Gemini", e); }
  } 
  
  if (provider === 'huggingface' && HUGGINGFACE_API_KEY) {
      try {
          const sys = SYSTEM_INSTRUCTION + " IMPORTANT: Repond uniquement en JSON valide minifié.";
          const jsonStr = await callHuggingFace(prompt, sys);
          return mapMinifiedToFull(JSON.parse(jsonStr), estimateTokens(prompt, jsonStr));
      } catch (e) { console.warn("HF fail, fallback Gemini", e); }
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
    
    // Create a unique key for this conversation based on participants (Player is implied)
    const targetSet = new Set(targets.map(t => normalizeCountryName(t)));
    
    const conv = history
        .filter(msg => {
            // Calculate participants for each message
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
            
            // Strict equality check for sets
            if (msgParticipants.size !== targetSet.size) return false;
            for (const p of msgParticipants) {
                if (!targetSet.has(p)) return false;
            }
            return true;
        })
        .slice(-6)
        .map(msg => `${msg.sender === 'player' ? 'Moi' : msg.senderName}:${msg.text}`)
        .join('|');

    const prompt = `
    Role:${targets.join(',')}.
    Moi:${playerCountry}.
    Chat:${conv}
    Msg:"${message}"
    JSON minifié:[{"s":"Pays","t":"Court"}]
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

    if (provider === 'huggingface' && HUGGINGFACE_API_KEY) {
        try {
            const sys = "Tu es chef d'état. Repond uniquement en JSON valide: [{'s':'Pays','t':'Message'}]";
            const jsonStr = await callHuggingFace(prompt, sys);
            const raw = JSON.parse(jsonStr);
            const arr = Array.isArray(raw) ? raw : (raw.messages || [raw]);
            return { 
                messages: arr.map((r: any) => ({ sender: r.s, text: r.t })), 
                usage: estimateTokens(prompt, jsonStr) 
            };
        } catch (e) { console.warn("HF fail"); }
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
        if (provider === 'huggingface' && HUGGINGFACE_API_KEY) {
             const j = await callHuggingFace(prompt, "Conseiller stratégique. Repond uniquement en JSON valide: {s:[]}");
             const p = JSON.parse(j);
             return { suggestions: p.s || p.suggestions || [], usage: estimateTokens(prompt, j) };
        }
        const response = await generateRobustContent(prompt, { responseMimeType: "application/json" });
        const p = JSON.parse(response.text);
        return { suggestions: p.s || p.suggestions || p, usage: estimateTokens(prompt, response.text) };
    } catch (e) { return { suggestions: ["Développer Industrie", "Renforcer Armée", "Accords Commerciaux"], usage: 0 }; }
}

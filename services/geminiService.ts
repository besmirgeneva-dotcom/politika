
import { GoogleGenAI, Type } from "@google/genai";
import { GameEvent, SimulationResponse, ChatMessage, ChaosLevel, Alliance } from "../types";

// --- CONFIGURATION ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const GROQ_API_KEY = process.env.VITE_GROQ_API_KEY || "";
const HUGGINGFACE_API_KEY = process.env.VITE_HUGGINGFACE_API_KEY || "";

export type AIProvider = 'gemini' | 'groq' | 'huggingface';

// --- OPTIMIZATION: MINIFIED SCHEMA KEYS ---
// To save output tokens, we ask the AI for short keys and map them back to full types.
// 'ti' = timeIncrement, 'ev' = events, etc.
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
                t: { type: Type.STRING, enum: ['annexation', 'build_base', 'build_defense', 'remove_entity', 'dissolve'] }, // Added 'dissolve'
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
        nuclearAcquired: min.nu, // NEW MAPPING
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

// --- CONDENSED SYSTEM INSTRUCTIONS (TOKEN SAVING) ---
const SYSTEM_INSTRUCTION = `
Moteur GeoSim. Règles:
1. CARTE(mu):
   - 'build_base'/'build_defense'
   - 'annexation': Conquête normale.
   - 'dissolve': Si pays détruit/rayé (ex: nuke), devient "Terre non revendiquée".
2. NUCLEAIRE(nu): true SI joueur termine projet nucléaire.
3. INFRA(iu): Civil seulement.
4. DIPLOMATIE(im): Pays souverains/ONU/OTAN seulement.
5. ACTION: Arcade, permissif. Militaire>60=puissant.
6. FORMAT: JSON minifié fourni (ti,ev,gt,nu...).
7. STYLE: Descriptions courtes (max 15 mots).
`;

const callGroq = async (prompt: string, system: string, jsonMode: boolean = true, schema: any = null): Promise<string> => {
    try {
        if (!GROQ_API_KEY) throw new Error("No Groq Key");
        let sys = system;
        // Groq/Llama requires explicit JSON instruction
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
        
        // Using Qwen2.5-7B-Instruct - generally reliable and high quality for JSON
        const MODEL_ID = "Qwen/Qwen2.5-7B-Instruct"; 
        
        // ChatML format for Qwen
        const fullPrompt = `<|im_start|>system\n${system}<|im_end|>\n<|im_start|>user\n${prompt}<|im_end|>\n<|im_start|>assistant\n`;

        const response = await fetch(`https://api-inference.huggingface.co/models/${MODEL_ID}`, {
            method: "POST",
            headers: { 
                "Authorization": `Bearer ${HUGGINGFACE_API_KEY}`, 
                "Content-Type": "application/json" 
            },
            body: JSON.stringify({
                inputs: fullPrompt,
                parameters: {
                    max_new_tokens: 2000,
                    return_full_text: false, // Only get the generated part
                    temperature: 0.7,
                    do_sample: true
                }
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`HF Error ${response.status}: ${errText}`);
        }

        const data = await response.json();
        // HF Inference API usually returns array: [{ generated_text: "..." }]
        let text = Array.isArray(data) ? data[0]?.generated_text : data?.generated_text;
        
        // Clean markdown code blocks if present
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        
        // Find the first '{' and last '}' to extract JSON
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start !== -1 && end !== -1) {
            return text.substring(start, end + 1);
        }
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
  
  // OPTIMIZATION: Reduce history size (6 events max instead of 15)
  // OPTIMIZATION: Shorten event format string
  const hist = recentHistory.slice(-6).map(e => `[${e.date}]${e.type}:${e.headline}`).join(';');
  const allContext = alliance ? `ALLIANCE:${alliance.name}` : "";
  
  // OPTIMIZATION: Summarize territory list if too long (>8 items)
  let territoryStr = ownedTerritories.join(',');
  if (ownedTerritories.length > 8) {
    const core = ownedTerritories.slice(0, 3).join(',');
    territoryStr = `${core} (+${ownedTerritories.length - 3} others)`;
  }
  
  // OPTIMIZATION: Ultra-short labels
  const prompt = `
    DT:${currentDate}|P:${playerCountry}(Pow:${playerPower},Nuke:${hasNuclear})|T:${territoryStr}|C:${chaosLevel}|${allContext}
    ACT:"${playerAction || "Rien"}"
    HIST:${hist}
    INF:${entitiesSummary}
    DIP:${diplomaticContext}
  `;

  if (provider === 'groq' && GROQ_API_KEY) {
      try {
          const jsonStr = await callGroq(prompt, SYSTEM_INSTRUCTION, true, null);
          return mapMinifiedToFull(JSON.parse(jsonStr));
      } catch (e) { console.warn("Groq fail, fallback Gemini", e); }
  } 
  
  if (provider === 'huggingface' && HUGGINGFACE_API_KEY) {
      try {
          const sys = SYSTEM_INSTRUCTION + " IMPORTANT: Repond uniquement en JSON valide minifié.";
          const jsonStr = await callHuggingFace(prompt, sys);
          return mapMinifiedToFull(JSON.parse(jsonStr));
      } catch (e) { console.warn("HF fail, fallback Gemini", e); }
  }

  try {
      const response = await generateRobustContent(prompt, {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          responseSchema: MINIFIED_SCHEMA,
          temperature: 0.85,
      });
      return mapMinifiedToFull(JSON.parse(response.text));
  } catch (error) { 
      console.error("Gemini Error", error);
      return getFallbackResponse(); 
  }
};

export const sendDiplomaticMessage = async (
    playerCountry: string,
    targets: string[],
    message: string,
    history: ChatMessage[],
    context: any,
    provider: AIProvider = 'gemini'
): Promise<{ sender: string, text: string }[]> => {
    
    // OPTIMIZATION: Only send last 3 relevant messages
    const conv = history
        .filter(msg => targets.includes(msg.senderName) || (msg.sender === 'player' && msg.targets.some(t => targets.includes(t))))
        .slice(-3)
        .map(msg => `${msg.sender === 'player' ? 'Moi' : msg.senderName}:${msg.text}`)
        .join('|');

    const prompt = `
    Role:${targets.join(',')}.
    Moi:${playerCountry}(Pow:${context.militaryPower}).
    Chat:${conv}
    Msg:"${message}"
    JSON minifié:[{"s":"Pays","t":"Court"}]
    `;

    // Minified Chat Schema
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
            const jsonStr = await callGroq(prompt, "Tu es chef d'état. Repond JSON: [{'s':'Pays','t':'Message'}]", true);
            const raw = JSON.parse(jsonStr);
            // Handle simple object vs array return from Groq
            const arr = Array.isArray(raw) ? raw : (raw.messages || [raw]);
            return arr.map((r: any) => ({ sender: r.s, text: r.t }));
        } catch (e) { console.warn("Groq fail"); }
    }

    if (provider === 'huggingface' && HUGGINGFACE_API_KEY) {
        try {
            const sys = "Tu es chef d'état. Repond uniquement en JSON valide: [{'s':'Pays','t':'Message'}]";
            const jsonStr = await callHuggingFace(prompt, sys);
            const raw = JSON.parse(jsonStr);
            const arr = Array.isArray(raw) ? raw : (raw.messages || [raw]);
            return arr.map((r: any) => ({ sender: r.s, text: r.t }));
        } catch (e) { console.warn("HF fail"); }
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
    events: [{ type: "world", headline: "Interférences", description: "Données corrompues." }],
    globalTensionChange: 0, economyHealthChange: 0, militaryPowerChange: 0, popularityChange: 0, corruptionChange: 0
});

export const getStrategicSuggestions = async (
    playerCountry: string,
    recentHistory: GameEvent[],
    provider: AIProvider = 'gemini'
): Promise<string[]> => {
    // OPTIMIZATION: Only 3 historical events
    const hist = recentHistory.slice(-3).map(e => e.headline).join(';');
    const prompt = `3 actions courtes pour ${playerCountry}. Contexte:${hist}. JSON:{"s":["..."]}`;
    try {
        if (provider === 'groq' && GROQ_API_KEY) {
             const j = await callGroq(prompt, "Conseiller stratégique. JSON.", true);
             const p = JSON.parse(j);
             return p.s || p.suggestions || [];
        }
        if (provider === 'huggingface' && HUGGINGFACE_API_KEY) {
             const j = await callHuggingFace(prompt, "Conseiller stratégique. Repond uniquement en JSON valide: {s:[]}");
             const p = JSON.parse(j);
             return p.s || p.suggestions || [];
        }
        const response = await generateRobustContent(prompt, { responseMimeType: "application/json" });
        const p = JSON.parse(response.text);
        return p.s || p.suggestions || p;
    } catch (e) { return ["Industrie", "Armée", "Commerce"]; }
}

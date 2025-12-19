
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

// Helper pour obtenir les participants uniques d'un message
const getMsgParticipants = (msg: ChatMessage, playerCountry: string): string => {
    const raw = msg.sender === 'player' ? [...msg.targets] : [msg.senderName, ...msg.targets];
    return Array.from(new Set(raw.map(n => normalizeCountryName(n)).filter(n => n !== playerCountry))).sort().join(',');
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
      gt: { type: Type.INTEGER },
      ec: { type: Type.INTEGER },
      mi: { type: Type.INTEGER },
      po: { type: Type.INTEGER },
      co: { type: Type.INTEGER },
      sp: { type: Type.BOOLEAN },
      nu: { type: Type.BOOLEAN },
      mu: { 
        type: Type.ARRAY,
        items: {
            type: Type.OBJECT,
            properties: {
                t: { type: Type.STRING, enum: ['annexation', 'build_base', 'build_defense', 'remove_entity', 'dissolve'] }, 
                tc: { type: Type.STRING },
                no: { type: Type.STRING },
                lat: { type: Type.NUMBER },
                lng: { type: Type.NUMBER },
                lbl: { type: Type.STRING },
                id: { type: Type.STRING }
            },
            required: ['t', 'tc']
        }
      },
      iu: { 
          type: Type.ARRAY,
          items: {
              type: Type.OBJECT,
              properties: {
                  c: { type: Type.STRING },
                  t: { type: Type.STRING },
                  v: { type: Type.INTEGER }
              },
              required: ["c", "t", "v"]
          }
      },
      im: { 
          type: Type.ARRAY,
          items: {
              type: Type.OBJECT,
              properties: {
                  s: { type: Type.STRING },
                  tx: { type: Type.STRING },
                  tg: { type: Type.ARRAY, items: { type: Type.STRING } }
              },
              required: ["s", "tx", "tg"]
          }
      },
      au: { 
          type: Type.OBJECT,
          properties: {
              a: { type: Type.STRING, enum: ["create", "update", "dissolve"] },
              n: { type: Type.STRING },
              t: { type: Type.STRING },
              m: { type: Type.ARRAY, items: { type: Type.STRING } },
              l: { type: Type.STRING }
          },
          required: ["a"]
      }
    },
    required: ["ti", "ev", "gt", "ec", "mi", "po", "co"],
};

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

const withRetry = async <T>(fn: () => Promise<T>, retries = 3, delay = 2000): Promise<T> => {
    try {
        return await fn();
    } catch (error: any) {
        if (retries > 0 && (error?.status === 429 || error?.status === 503)) {
            await new Promise(r => setTimeout(r, delay));
            return withRetry(fn, retries - 1, delay * 2);
        }
        throw error;
    }
};

const generateRobustContent = async (prompt: string, config: any): Promise<any> => {
    return await withRetry(() => ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: config
    }));
};

const SYSTEM_INSTRUCTION = `Moteur GeoSim. Règles: 1. CARTE: build_base/build_defense, annexation. 2. FORMAT: JSON minifié.`;

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
  const hist = recentHistory.slice(-6).map(e => `[${e.date}]${e.type}:${e.headline}`).join(';');
  const prompt = `DT:${currentDate}|P:${playerCountry}|T:${ownedTerritories.length}|C:${chaosLevel}\nACT:"${playerAction}"\nHIST:${hist}\nINF:${entitiesSummary}\nDIP:${diplomaticContext}`;

  try {
      const response = await generateRobustContent(prompt, {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          responseSchema: MINIFIED_SCHEMA,
      });
      return mapMinifiedToFull(JSON.parse(response.text), estimateTokens(prompt, response.text));
  } catch (error) { 
      return { timeIncrement: 'day', tokenUsage: 0, events: [], globalTensionChange: 0, economyHealthChange: 0, militaryPowerChange: 0, popularityChange: 0, corruptionChange: 0 };
  }
};

export const sendDiplomaticMessage = async (
    playerCountry: string,
    targets: string[],
    message: string,
    history: ChatMessage[],
    context: any,
    provider: AIProvider = 'gemini'
): Promise<{ sender: string, text: string, tokens: number }[]> => {
    
    // FILTRAGE STRICT DE LA CONVERSATION PAR PARTICIPANTS
    const targetSet = Array.from(new Set(targets.map(t => normalizeCountryName(t)))).sort().join(',');
    const conv = history
        .filter(msg => getMsgParticipants(msg, playerCountry) === targetSet)
        .slice(-5)
        .map(msg => `${msg.sender === 'player' ? 'Moi' : msg.senderName}:${msg.text}`)
        .join('|');

    const prompt = `
    GROUPE DIPLOMATIQUE: ${targets.join(', ')} et Moi (${playerCountry}).
    HISTORIQUE LOCAL: ${conv || "Aucun"}
    MESSAGE DU JOUEUR: "${message}"
    
    INSTRUCTION: Réponds en tant qu'un ou plusieurs pays du groupe. Tiens compte des autres pays présents dans le chat.
    FORMAT JSON: [{"s":"Pays","t":"Message court"}]
    `;

    try {
        const response = await generateRobustContent(prompt, { 
            responseMimeType: "application/json",
            temperature: 0.7 
        });
        const raw = JSON.parse(response.text);
        const arr = Array.isArray(raw) ? raw : (raw.messages || [raw]);
        const tokens = estimateTokens(prompt, response.text);
        return arr.map((r: any) => ({ sender: r.s, text: r.t, tokens }));
    } catch (e) { 
        return [{ sender: targets[0], text: "...", tokens: 0 }]; 
    }
}

export const getStrategicSuggestions = async (
    playerCountry: string,
    recentHistory: GameEvent[],
    provider: AIProvider = 'gemini'
): Promise<{ suggestions: string[], tokens: number }> => {
    const hist = recentHistory.slice(-3).map(e => e.headline).join(';');
    const prompt = `3 actions pour ${playerCountry}. Contexte:${hist}. JSON:{"s":["..."]}`;
    try {
        const response = await generateRobustContent(prompt, { responseMimeType: "application/json" });
        const p = JSON.parse(response.text);
        return { suggestions: p.s || p.suggestions || p, tokens: estimateTokens(prompt, response.text) };
    } catch (e) { return { suggestions: ["Industrie", "Armée", "Commerce"], tokens: 0 }; }
}

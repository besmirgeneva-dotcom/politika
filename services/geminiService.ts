
import { GoogleGenAI, Type } from "@google/genai";
import { GameEvent, SimulationResponse, ChatMessage, ChaosLevel, Alliance } from "../types";

// --- CONFIGURATION ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const GROQ_API_KEY = process.env.VITE_GROQ_API_KEY || "";

export type AIProvider = 'gemini' | 'groq';

// --- OPTIMIZATION: MINIFIED SCHEMA KEYS (Saves ~30% output tokens) ---
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
      mu: { 
        type: Type.ARRAY,
        items: {
            type: Type.OBJECT,
            properties: {
                t: { type: Type.STRING, enum: ['annexation', 'build_base', 'build_defense', 'remove_entity'] },
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

const SYSTEM_INSTRUCTION = `
Moteur GeoSim. Règles strictes pour tokens :
1. CARTE (mu): Uniquement 'build_base' ou 'build_defense'.
2. INFRA (iu): Pour constructions civiles (usines/ports).
3. PAYS: Ne mentionne que les souverains.
4. HISTOIRE: Utilise le contexte partiel fourni.
5. FORMAT: JSON MINIFIÉ UNIQUEMENT.
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
  alliance: Alliance | null = null
): Promise<SimulationResponse> => {
  
  // OPTIMIZATION: Reduce history size sent to IA (10 instead of 15)
  const hist = recentHistory.slice(-10).map(e => `[${e.date}]${e.type}:${e.headline}`).join('\n');
  const allContext = alliance ? `ALLIANCE:${alliance.name}` : "N/A";
  
  // OPTIMIZATION: Truncate territory list if too long
  const territoryText = ownedTerritories.length > 5 
    ? `${ownedTerritories[0]} (+${ownedTerritories.length - 1} terr.)`
    : ownedTerritories.join(',');

  const prompt = `
    DATE:${currentDate}|PAYS:${playerCountry}(Pow:${playerPower})|POSS:${territoryText}|CHAOS:${chaosLevel}|${allContext}
    ACTION:"${playerAction || "Rien"}"
    HIST:${hist}
    INFRA:${entitiesSummary}
    DIPLO:${diplomaticContext}
  `;

  try {
      const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt,
          config: {
              systemInstruction: SYSTEM_INSTRUCTION,
              responseMimeType: "application/json",
              responseSchema: MINIFIED_SCHEMA,
              temperature: 0.8,
          }
      });
      return mapMinifiedToFull(JSON.parse(response.text));
  } catch (error) {
      return {
          timeIncrement: 'day',
          events: [{ type: "world", headline: "Instabilité", description: "Le simulateur a rencontré une erreur." }],
          globalTensionChange: 0, economyHealthChange: 0, militaryPowerChange: 0, popularityChange: 0, corruptionChange: 0
      };
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
    // Optimization: Shorter history for chat
    const conv = history.slice(-4).map(msg => `${msg.senderName}:${msg.text}`).join('\n');

    const prompt = `Incarne:${targets.join(',')}. Exp:${playerCountry}. Hist:${conv}. Msg:"${message}". Réponds JSON:[{"s":"Pays","t":"msg"}]`;

    try {
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: prompt,
            config: { 
                responseMimeType: "application/json",
                temperature: 0.7 
            }
        });
        const raw = JSON.parse(response.text);
        return Array.isArray(raw) ? raw.map((r: any) => ({ sender: r.s || r.sender, text: r.t || r.text })) : [];
    } catch (e) { return []; }
}

export const getStrategicSuggestions = async (
    playerCountry: string,
    recentHistory: GameEvent[],
    provider: AIProvider = 'gemini'
): Promise<string[]> => {
    const hist = recentHistory.slice(-3).map(e => e.headline).join('; ');
    const prompt = `3 actions pour ${playerCountry} (Hist:${hist}). JSON:{"s":["..."]}`;
    try {
        const response = await ai.models.generateContent({ 
            model: "gemini-3-flash-preview",
            contents: prompt,
            config: { responseMimeType: "application/json" } 
        });
        return JSON.parse(response.text).s || [];
    } catch (e) { return ["Développer l'armée", "Améliorer l'économie"]; }
}


import { GoogleGenAI, Schema, Type } from "@google/genai";
import { GameEvent, SimulationResponse, ChatMessage, ChaosLevel, Alliance } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const GROQ_API_KEY = process.env.VITE_GROQ_API_KEY || "";

export type AIProvider = 'gemini' | 'groq';

const withRetry = async <T>(fn: () => Promise<T>, retries = 3, delay = 2000): Promise<T> => {
    try {
        return await fn();
    } catch (error: any) {
        const errString = JSON.stringify(error);
        const errMsg = error?.message || "";
        const isRetryable = error?.status === 429 || error?.code === 429 || error?.status === 503 || errString.includes("RESOURCE_EXHAUSTED") || errMsg.toLowerCase().includes("overloaded");

        if (retries > 0 && isRetryable) {
            await new Promise(r => setTimeout(r, delay + Math.random() * 500));
            return withRetry(fn, retries - 1, delay * 2);
        }
        throw error;
    }
};

const generateRobustContent = async (prompt: string, config: any): Promise<any> => {
    try {
        return await withRetry(() => ai.models.generateContent({ model: "gemini-3-flash-preview", contents: prompt, config }));
    } catch (error) {
        return await withRetry(() => ai.models.generateContent({ model: "gemini-2.5-flash-lite-latest", contents: prompt, config }));
    }
};

const SYSTEM_INSTRUCTION = `Role: Moteur de simulation GeoSim.
Style: Dépêches AFP, Français, Arcade (permissif).
Règles Infra: 
1. Militaire Majeur (Base, Radar, Silo) -> 'mapUpdates'.
2. Civil/Industrie (Usine, Port, Centrale) -> 'infrastructureUpdates' (mémoire) + Event.
Diplomatie: Uniquement PAYS, ONU, UE, OTAN. Pas de ministères.
Suggestions: Propose 3 actions courtes et stratégiques.
Noms: Toujours utiliser les noms français officiels.`;

// POINT 1: SCHEMA EPURE (SANS DESCRIPTIONS)
const RESPONSE_SCHEMA_JSON = {
    type: "object",
    properties: {
      timeIncrement: { type: "string", enum: ["day", "month", "year"] },
      worldSummary: { type: "string" }, // Résumé pour le tour suivant
      strategicSuggestions: { type: "array", items: { type: "string" } }, // Fusion Point 4
      events: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["world", "crisis", "economy", "war", "alliance"] },
            headline: { type: "string" },
            description: { type: "string" },
            relatedCountry: { type: "string" }
          },
          required: ["type", "headline", "description"]
        },
      },
      globalTensionChange: { type: "integer" },
      economyHealthChange: { type: "integer" },
      militaryPowerChange: { type: "integer" },
      popularityChange: { type: "integer" },
      corruptionChange: { type: "integer" },
      spaceProgramActive: { type: "boolean" },
      mapUpdates: {
        type: "array",
        items: {
            type: "object",
            properties: {
                type: { type: "string", enum: ['annexation', 'build_base', 'build_defense', 'remove_entity'] },
                targetCountry: { type: "string" },
                newOwner: { type: "string" },
                lat: { type: "number" },
                lng: { type: "number" },
                label: { type: "string" },
                entityId: { type: "string" }
            },
            required: ['type', 'targetCountry']
        }
      },
      infrastructureUpdates: {
          type: "array",
          items: {
              type: "object",
              properties: { country: { type: "string" }, type: { type: "string" }, change: { type: "integer" } },
              required: ["country", "type", "change"]
          }
      },
      incomingMessages: {
          type: "array",
          items: {
              type: "object",
              properties: { sender: { type: "string" }, text: { type: "string" }, targets: { type: "array", items: { type: "string" } } },
              required: ["sender", "text", "targets"]
          }
      },
      allianceUpdate: {
          type: "object",
          properties: {
              action: { type: "string", enum: ["create", "update", "dissolve"] },
              name: { type: "string" },
              type: { type: "string" },
              members: { type: "array", items: { type: "string" } },
              leader: { type: "string" }
          },
          required: ["action"]
      }
    },
    required: ["timeIncrement", "worldSummary", "strategicSuggestions", "events", "globalTensionChange", "economyHealthChange", "militaryPowerChange", "popularityChange", "corruptionChange"],
};

export const simulateTurn = async (
  playerCountry: string,
  currentDate: string,
  playerAction: string,
  recentHistory: GameEvent[],
  ownedTerritories: string[],
  entitiesSummary: string,
  isLandlocked: boolean,
  hasNuclear: boolean,
  diplomaticContext: string,
  chaosLevel: ChaosLevel,
  provider: AIProvider,
  playerPower: number,
  alliance: Alliance | null,
  worldSummary: string // Point 2: Reçoit le résumé du tour précédent
): Promise<SimulationResponse> => {
  
  // POINT 2: COMPRESSION HISTORIQUE (3 FULL + 12 TITRES)
  const compressedHistory = recentHistory.slice(-15).map((e, idx, arr) => {
      const isRecent = idx >= arr.length - 3;
      return `[${e.date}] ${e.type}: ${e.headline}${isRecent ? ` - ${e.description}` : ''}`;
  }).join('\n');

  const prompt = `PAYS: ${playerCountry} | DATE: ${currentDate} | CHAOS: ${chaosLevel} | POWER: ${playerPower}
ALLIANCE: ${alliance ? alliance.name : 'Aucune'}
PRECEDEMMENT: ${worldSummary || "Début de mandat."}
ACTION: "${playerAction || "Statut quo."}"
HISTOIRE COMPRESSÉE:
${compressedHistory}
INFRA (COMPACT): ${entitiesSummary}
DIPLOMATIE: ${diplomaticContext}`;

  if (provider === 'groq' && GROQ_API_KEY) {
      try {
          const jsonStr = await callGroq(prompt, SYSTEM_INSTRUCTION);
          return JSON.parse(jsonStr);
      } catch (e) {}
  } 
  
  try {
      const response = await generateRobustContent(prompt, {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA_JSON as any,
          temperature: 0.8,
      });
      return JSON.parse(response.text) as SimulationResponse;
  } catch (error) { return getFallbackResponse(); }
};

const callGroq = async (prompt: string, system: string): Promise<string> => {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            messages: [{ role: "system", content: system + "\nJSON ONLY." }, { role: "user", content: prompt }],
            model: "llama-3.3-70b-versatile",
            response_format: { type: "json_object" }
        })
    });
    const data = await response.json();
    return data.choices[0]?.message?.content || "";
};

export const sendDiplomaticMessage = async (
    playerCountry: string,
    targets: string[],
    message: string,
    history: ChatMessage[],
    context: any,
    provider: AIProvider = 'gemini'
): Promise<{ sender: string, text: string }[]> => {
    const conv = history.slice(-5).map(m => `${m.senderName}: ${m.text}`).join('\n');
    const prompt = `Pays: ${targets.join(',')}. Message de ${playerCountry}: "${message}". Conv:\n${conv}`;
    const schema = { type: "array", items: { type: "object", properties: { sender: { type: "string" }, text: { type: "string" } }, required: ["sender", "text"] } };
    
    try {
        const response = await generateRobustContent(prompt, { systemInstruction: "Réponds en tant que chefs d'états. Bref. JSON.", responseMimeType: "application/json", responseSchema: schema as any });
        return JSON.parse(response.text) || [];
    } catch (e) { return [{ sender: targets[0], text: "Message reçu." }]; }
}

export const getStrategicSuggestions = async (playerCountry: string, recentHistory: GameEvent[]): Promise<string[]> => {
    // Cette fonction n'est plus appelée pour économiser des tokens, les suggestions viennent de simulateTurn
    return ["Analyser les marchés", "Renforcer les frontières", "Ouvrir des négociations"];
}

const getFallbackResponse = (): SimulationResponse => ({
    timeIncrement: 'month', worldSummary: "Stabilité globale.", strategicSuggestions: ["Attendre", "Observer", "Agir"],
    events: [{ type: "world", headline: "Calme relatif", description: "Le mois s'écoule sans incident majeur." }],
    globalTensionChange: 0, economyHealthChange: 0, militaryPowerChange: 0, popularityChange: 0, corruptionChange: 0
});

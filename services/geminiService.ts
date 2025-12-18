
import { GoogleGenAI, Type } from "@google/genai";
import { GameEvent, SimulationResponse, ChatMessage, ChaosLevel, Alliance } from "../types";

// --- CONFIGURATION ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const GROQ_API_KEY = process.env.VITE_GROQ_API_KEY || "";

export type AIProvider = 'gemini' | 'groq';

// --- RETRY LOGIC (Exponential Backoff) ---
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

// --- OPTIMISATION : INSTRUCTION SYSTÈME COMPACTE ---
const SYSTEM_INSTRUCTION = `Role: Moteur GeoSim. 
Style: Dépêches AFP, Français. 
Règles: 
1. Infra Carte: 'mapUpdates' (Bases, Défense).
2. Infra Mémoire: 'infrastructureUpdates' (Usines, Ports Civils).
3. Diplomatie: Pays/ONU/UE/OTAN seulement.
4. Contexte: Utilise 'worldSummary' pour la cohérence. Mets-le à jour.
5. Suggestions: Inclus 3 actions courtes pour le joueur.`;

// --- OPTIMISATION : SCHÉMA JSON SANS DESCRIPTIONS (Gain Tokens) ---
const RESPONSE_SCHEMA_JSON = {
    type: "object",
    properties: {
      timeIncrement: { type: "string", enum: ["day", "month", "year"] },
      worldSummary: { type: "string" }, // Résumé narratif court pour le prochain tour
      strategicSuggestions: { type: "array", items: { type: "string" } }, // Fusion requête suggestions
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
  entitiesSummary: string, // Format compressé "FRA:B1,I2"
  isLandlocked: boolean,
  hasNuclear: boolean,
  recentChat: string,
  chaosLevel: ChaosLevel,
  provider: AIProvider,
  playerPower: number,
  alliance: Alliance | null,
  worldSummary: string // Le contexte narratif actuel
): Promise<SimulationResponse> => {
  
  // OPTIMISATION: On ne garde que les 3 derniers événements en détail
  // Le reste est supposé être contenu dans worldSummary
  const shortHistory = recentHistory.slice(-3).map(e => `[${e.date}] ${e.type}: ${e.headline}`).join('\n');
  
  const allianceInfo = alliance ? `Alliance: ${alliance.name} (${alliance.leader})` : "Non-aligné";

  const prompt = `PAYS: ${playerCountry} | DATE: ${currentDate} | CHAOS: ${chaosLevel} | POWER: ${playerPower}
${allianceInfo} | Landlocked: ${isLandlocked} | Nuke: ${hasNuclear}
CONTEXTE MONDIAL: ${worldSummary || "Début de partie."}
ACTION JOUEUR: "${playerAction || "Rien."}"
DERNIERS FAITS:
${shortHistory}
INFRA (Codes: B=Base, D=Défense, I=Infra): ${entitiesSummary}
CHAT RECENT: ${recentChat}`;

  try {
      const response = await generateRobustContent(prompt, {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA_JSON as any,
          temperature: 0.8,
      });
      return JSON.parse(response.text) as SimulationResponse;
  } catch (error) { 
      return {
          timeIncrement: 'month', worldSummary: "Stabilité.", strategicSuggestions: ["Observer", "Agir"],
          events: [{ type: "world", headline: "Calme", description: "Le temps passe." }],
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
    // Optimisation context chat
    const conv = history.slice(-5).map(m => `${m.senderName}: ${m.text}`).join('\n');
    const prompt = `Pays: ${targets.join(',')}. Message de ${playerCountry}: "${message}".
Conv:\n${conv}
Réponds JSON: [{ "sender": "Pays", "text": "..." }]`;
    
    const schema = { type: "array", items: { type: "object", properties: { sender: { type: "string" }, text: { type: "string" } }, required: ["sender", "text"] } };
    
    try {
        const response = await generateRobustContent(prompt, { systemInstruction: "Diplomatie courte. JSON.", responseMimeType: "application/json", responseSchema: schema as any });
        return JSON.parse(response.text) || [];
    } catch (e) { return [{ sender: targets[0], text: "Bien reçu." }]; }
}

export const getStrategicSuggestions = async (playerCountry: string, recentHistory: GameEvent[]): Promise<string[]> => {
    // Fallback si jamais appelé manuellement, mais devrait être géré par simulateTurn
    return ["Renforcer l'économie", "Chercher des alliés", "Surveiller les frontières"];
}

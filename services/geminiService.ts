
import { GoogleGenAI, Schema, Type } from "@google/genai";
import { GameEvent, SimulationResponse, ChatMessage, ChaosLevel } from "../types";

// --- CONFIGURATION ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const GROQ_API_KEY = process.env.VITE_GROQ_API_KEY || "";

export type AIProvider = 'gemini' | 'groq';

const withRetry = async <T>(fn: () => Promise<T>, retries = 3, delay = 2000): Promise<T> => {
    try {
        return await fn();
    } catch (error: any) {
        let isRateLimit = false;
        let isServerOverload = false;
        const errString = JSON.stringify(error);
        const errMsg = error?.message || "";
        if (error?.status === 429 || error?.code === 429 || errString.includes("429") || errMsg.includes("429") || errMsg.toLowerCase().includes("quota") || errString.includes("RESOURCE_EXHAUSTED")) isRateLimit = true;
        if (error?.status === 503 || error?.code === 503 || errString.includes("503") || errMsg.includes("503") || errMsg.toLowerCase().includes("overloaded") || errMsg.toLowerCase().includes("unavailable")) isServerOverload = true;
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
            return await ai.models.generateContent({ model: "gemini-3-flash-preview", contents: prompt, config: config });
        }, 3, 2000);
    } catch (error) {
        try {
            return await withRetry(async () => {
                return await ai.models.generateContent({ model: "gemini-2.5-flash-lite-latest", contents: prompt, config: config });
            }, 2, 3000);
        } catch (fallbackError) { throw fallbackError; }
    }
};

// --- SYSTEM INSTRUCTION UPDATED ---
const SYSTEM_INSTRUCTION = `
ROLE: Tu es le "Moteur de Réalité" de GeoSim.

RÈGLES DE CARTOGRAPHIE (STRICTES) :
1. **INSTALLATIONS PERMANENTES UNIQUEMENT** : Tu ne peux créer des marqueurs (mapUpdates) QUE pour : 
   - 'build_factory' (armement/avions)
   - 'build_port' (militaire)
   - 'build_airport' (base militaire terrestre)
   - 'build_airbase' (base aérienne)
   - 'build_defense' (radars, missiles)
2. **INTERDICTION DE MARQUEUR POUR DÉPLOIEMENT** : Si le joueur demande un "déploiement", une "mobilisation", un "mouvement de troupes" ou une "attaque", tu dois décrire l'action dans les 'events' et modifier les stats, mais tu ne dois JAMAIS générer de marqueur sur la carte pour cela.
3. **PRÉCISION TRANSFRONTALIÈRE** : Assure-toi que les coordonnées (lat, lng) sont STRICTEMENT à l'intérieur du pays cible. Ne place jamais d'usine ou de base chez un voisin par erreur.
4. **SUPPRESSION** : Gère les demandes de suppression ('retirer', 'supprimer', 'démanteler') via 'remove_entity'.
`;

const RESPONSE_SCHEMA_JSON = {
    type: "object",
    properties: {
      timeIncrement: { type: "string", enum: ["day", "month", "year"] },
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
      mapUpdates: {
        type: "array",
        items: {
            type: "object",
            properties: {
                type: { type: "string", enum: ['annexation', 'build_factory', 'build_port', 'build_airport', 'build_airbase', 'build_defense', 'remove_entity'] },
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
          properties: { action: { type: "string", enum: ["create", "update", "dissolve"] }, name: { type: "string" }, type: { type: "string" }, members: { type: "array", items: { type: "string" } }, leader: { type: "string" } },
          required: ["action"]
      }
    },
    required: ["timeIncrement", "events", "globalTensionChange", "economyHealthChange", "militaryPowerChange", "popularityChange", "corruptionChange"],
};

export const simulateTurn = async (
  playerCountry: string,
  currentDate: string,
  playerAction: string,
  recentHistory: GameEvent[],
  ownedTerritories: string[] = [],
  existingEntities: string[] = [],
  isLandlocked: boolean = false,
  hasNuclear: boolean = false,
  diplomaticContext: string = "",
  chaosLevel: ChaosLevel = 'normal',
  provider: AIProvider = 'gemini',
  playerPower: number = 50
): Promise<SimulationResponse> => {
  const historyContext = recentHistory.slice(-15).map(e => `[${e.date}] ${e.type.toUpperCase()}: ${e.headline}`).join('\n');
  const prompt = `
    DATE: ${currentDate} | PAYS JOUEUR: ${playerCountry} (Puissance: ${playerPower}/100)
    ACTION JOUEUR: "${playerAction || "Maintien de l'ordre."}"
    INSTALLATIONS SUR CARTE: ${existingEntities.join(', ')}
    
    RAPPEL : 
    - PAS DE MARQUEUR pour déploiement/mouvement.
    - Seuls 'build_factory', 'build_port', 'build_airport', 'build_airbase', 'build_defense' créent des points.
    - Coordonnées lat/lng précises DANS le pays.
  `;

  if (provider === 'groq' && GROQ_API_KEY) {
      try {
          const jsonStr = await callGroq(prompt, SYSTEM_INSTRUCTION, true, RESPONSE_SCHEMA_JSON);
          return JSON.parse(jsonStr) as SimulationResponse;
      } catch (error) { console.warn("Groq failed."); }
  } 
  
  try {
      const response = await generateRobustContent(prompt, { systemInstruction: SYSTEM_INSTRUCTION, responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA_JSON as any, temperature: 0.85 });
      return JSON.parse(response.text) as SimulationResponse;
  } catch (error) { return getFallbackResponse(); }
};

const callGroq = async (prompt: string, system: string, jsonMode: boolean = true, schema: any = null): Promise<string> => {
    try {
        if (!GROQ_API_KEY) throw new Error("Clé API Groq manquante.");
        let systemContent = system;
        if (jsonMode) systemContent += "\n\nJSON SCHEMA:\n" + JSON.stringify(schema || RESPONSE_SCHEMA_JSON);
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                messages: [{ role: "system", content: systemContent }, { role: "user", content: prompt }],
                model: "llama-3.3-70b-versatile",
                temperature: 0.85,
                max_tokens: 2048,
                response_format: jsonMode ? { type: "json_object" } : undefined
            })
        });
        const data = await response.json();
        return data.choices[0]?.message?.content || "";
    } catch (e) { throw e; }
};

export const sendDiplomaticMessage = async (playerCountry: string, responder: string, groupParticipants: string[], message: string, history: ChatMessage[], context: { militaryPower: number; economyHealth: number; globalTension: number; hasNuclear: boolean; }, provider: AIProvider = 'gemini'): Promise<string | null> => {
    const conversationContext = history.filter(msg => msg.targets.includes(responder) || groupParticipants.includes(msg.senderName)).slice(-6).map(msg => `${msg.sender === 'player' ? playerCountry : msg.senderName}: ${msg.text}`).join('\n');
    const prompt = `Tu es le dirigeant de ${responder}. ${playerCountry} te dit : "${message}". Contexte : ${conversationContext}.`;
    try {
        const response = await generateRobustContent(prompt, { temperature: 0.7 });
        return response.text?.trim() || "Reçu.";
    } catch (e) { return "Transmission diplomatique reçue."; }
}

export const getStrategicSuggestions = async (playerCountry: string, recentHistory: GameEvent[], provider: AIProvider = 'gemini'): Promise<string[]> => {
    const prompt = `Suggère 3 actions pour ${playerCountry}. JSON: {"suggestions": ["..."]}`;
    try {
        const response = await generateRobustContent(prompt, { responseMimeType: "application/json" });
        return JSON.parse(response.text).suggestions || [];
    } catch (e) { return ["Moderniser l'industrie"]; }
}

const getFallbackResponse = (): SimulationResponse => ({
    timeIncrement: 'day',
    events: [{ type: "world", headline: "Instabilité", description: "Perturbations mondiales." }],
    globalTensionChange: 0, economyHealthChange: 0, militaryPowerChange: 0, popularityChange: 0, corruptionChange: 0
});

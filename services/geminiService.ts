import { GoogleGenAI, Type } from "@google/genai";
import { GameEvent, SimulationResponse, ChatMessage, ChaosLevel } from "../types";

// --- CONFIGURATION ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// --- RETRY LOGIC (Exponential Backoff) ---
const withRetry = async <T>(fn: () => Promise<T>, retries = 3, delay = 2000): Promise<T> => {
    try {
        return await fn();
    } catch (error: any) {
        let isRetryable = false;
        const errMsg = error?.message || "";
        
        if (error?.status === 429 || error?.status === 503 || errMsg.includes("429") || errMsg.includes("503")) {
            isRetryable = true;
        }

        if (retries > 0 && isRetryable) {
            const jitter = Math.random() * 500;
            await new Promise(r => setTimeout(r, delay + jitter));
            return withRetry(fn, retries - 1, delay * 2);
        }
        throw error;
    }
};

const SYSTEM_INSTRUCTION = `
ROLE: Tu es le "Moteur de Réalité" d'une simulation géopolitique complexe (GeoSim).
CONTEXTE: Jeu vidéo de stratégie "Grand Strategy".
OBJECTIF: Simuler un monde VIVANT, AUTONOME et COHÉRENT.

RÈGLES D'OR POUR L'IA (CRITIQUE):
1. **AUTONOMIE TOTALE DES PNJs**:
   - Tu contrôles les 195 autres pays. Ils ont leurs propres intérêts.
   - ILS N'ATTENDENT PAS LE JOUEUR. Ils signent des traités, déclenchent des guerres et des crises économiques ENTRE EUX.

2. **LE JOUEUR N'EST PAS DIEU**:
   - Si le joueur ordonne une action irréaliste, l'action DOIT ÉCHOUER avec des conséquences logiques.

3. **TON ET STYLE**:
   - Style journalistique ou dépêche diplomatique. Précis, froid, impactant.
   - Utilise les noms français exacts des pays.

Format de réponse attendu : JSON UNIQUEMENT.
`;

const GEMINI_SCHEMA = {
    type: Type.OBJECT,
    properties: {
      timeIncrement: { type: Type.STRING, enum: ["day", "month", "year"] },
      events: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            type: { type: Type.STRING, enum: ["world", "crisis", "economy", "war", "alliance"] },
            headline: { type: Type.STRING },
            description: { type: Type.STRING },
            relatedCountry: { type: Type.STRING }
          },
          required: ["type", "headline", "description"]
        },
      },
      globalTensionChange: { type: Type.INTEGER },
      economyHealthChange: { type: Type.INTEGER },
      militaryPowerChange: { type: Type.INTEGER },
      popularityChange: { type: Type.INTEGER },
      corruptionChange: { type: Type.INTEGER },
      spaceProgramActive: { type: Type.BOOLEAN },
      mapUpdates: {
        type: Type.ARRAY,
        items: {
            type: Type.OBJECT,
            properties: {
                type: { type: Type.STRING, enum: ['annexation', 'build_factory', 'build_port', 'build_airport', 'build_airbase', 'build_defense'] },
                targetCountry: { type: Type.STRING },
                newOwner: { type: Type.STRING },
                lat: { type: Type.NUMBER },
                lng: { type: Type.NUMBER },
                label: { type: Type.STRING }
            },
            required: ['type', 'targetCountry']
        }
      },
      incomingMessages: {
          type: Type.ARRAY,
          items: {
              type: Type.OBJECT,
              properties: {
                  sender: { type: Type.STRING },
                  text: { type: Type.STRING },
                  targets: { type: Type.ARRAY, items: { type: Type.STRING } }
              },
              required: ["sender", "text", "targets"]
          }
      },
      allianceUpdate: {
          type: Type.OBJECT,
          properties: {
              action: { type: Type.STRING, enum: ["create", "update", "dissolve"] },
              name: { type: Type.STRING },
              type: { type: Type.STRING },
              members: { type: Type.ARRAY, items: { type: Type.STRING } },
              leader: { type: Type.STRING }
          },
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
  chaosLevel: ChaosLevel = 'normal'
): Promise<SimulationResponse> => {
  const historyContext = recentHistory.slice(-15).map(e => `[${e.date}] ${e.type.toUpperCase()}: ${e.headline}`).join('\n');
  const prompt = `
    DATE ACTUELLE: ${currentDate}
    PAYS DU JOUEUR: ${playerCountry}
    POSSESSIONS: ${ownedTerritories.join(', ')}
    ACTION DU JOUEUR: "${playerAction || "Statu quo."}"
    CONTEXTE HISTORIQUE: ${historyContext}
    CHAOS: ${chaosLevel}
  `;

  try {
      const response = await withRetry(async () => {
          return await ai.models.generateContent({
              model: "gemini-3-flash-preview",
              contents: prompt,
              config: {
                  systemInstruction: SYSTEM_INSTRUCTION,
                  responseMimeType: "application/json",
                  responseSchema: GEMINI_SCHEMA,
                  temperature: chaosLevel === 'chaos' ? 0.95 : 0.8,
              }
          });
      });
      return JSON.parse(response.text || "{}") as SimulationResponse;
  } catch (error) {
      console.error("Gemini Error:", error);
      return getFallbackResponse();
  }
};

export const sendDiplomaticMessage = async (
    playerCountry: string,
    responder: string,
    groupParticipants: string[],
    message: string,
    history: ChatMessage[],
    context: { militaryPower: number; economyHealth: number; globalTension: number; hasNuclear: boolean; }
): Promise<string | null> => {
    const conversationContext = history
        .filter(msg => msg.targets.includes(responder) || groupParticipants.includes(msg.senderName))
        .slice(-6)
        .map(msg => `${msg.sender === 'player' ? playerCountry : msg.senderName}: ${msg.text}`)
        .join('\n');

    const prompt = `
    Incarne le dirigeant de : ${responder}. Parle avec : ${playerCountry}.
    CONTEXTE: ${conversationContext}
    DERNIER MESSAGE: "${message}"
    Réponds en tant que Chef d'État (1-2 phrases). Si sans intérêt, réponds "NO_RESPONSE".
  `;

    try {
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: prompt,
            config: { temperature: 0.7 }
        });
        const text = response.text?.trim();
        return text === "NO_RESPONSE" ? null : text || "Reçu.";
    } catch (e) {
        return "Message reçu.";
    }
}

export const getStrategicSuggestions = async (
    playerCountry: string,
    recentHistory: GameEvent[]
): Promise<string[]> => {
    const historyContext = recentHistory.slice(-5).map(e => e.headline).join('\n');
    const prompt = `Suggère 3 actions stratégiques pour ${playerCountry} (Historique: ${historyContext}). Format JSON: ["action 1", "action 2", "action 3"]`;

    try {
        const response = await ai.models.generateContent({
             model: "gemini-3-flash-preview",
             contents: prompt,
             config: {
                 responseMimeType: "application/json", 
                 responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } },
                 temperature: 0.8
             }
        });
        return JSON.parse(response.text || "[]") as string[];
    } catch (e) { return ["Renforcer l'armée", "Négocier une alliance", "Développer l'économie"]; }
}

const getFallbackResponse = (): SimulationResponse => ({
    timeIncrement: 'day',
    events: [{ type: "world", headline: "Silence Radio", description: "Surcharge des systèmes de communication." }],
    globalTensionChange: 0,
    economyHealthChange: 0,
    militaryPowerChange: 0,
    popularityChange: 0,
    corruptionChange: 0
});

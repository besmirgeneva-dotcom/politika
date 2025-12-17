import { GoogleGenAI, Schema, Type } from "@google/genai";
import { GameEvent, SimulationResponse, ChatMessage, ChaosLevel } from "../types";

// --- CONFIGURATION ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Utilisation des variables d'environnement UNIQUEMENT.
const GROQ_API_KEY = process.env.VITE_GROQ_API_KEY || "";

export type AIProvider = 'gemini' | 'groq';

// --- RETRY LOGIC (Exponential Backoff) ---
const withRetry = async <T>(fn: () => Promise<T>, retries = 3, delay = 2000): Promise<T> => {
    try {
        return await fn();
    } catch (error: any) {
        let isRateLimit = false;
        let isServerOverload = false;
        
        const errString = JSON.stringify(error);
        const errMsg = error?.message || "";
        
        // Check for 429
        if (
            error?.status === 429 || 
            error?.code === 429 ||
            errString.includes("429") || 
            errMsg.includes("429") || 
            errMsg.toLowerCase().includes("quota") || 
            errString.includes("RESOURCE_EXHAUSTED")
        ) {
            isRateLimit = true;
        }

        // Check for 503
        if (
            error?.status === 503 || 
            error?.code === 503 ||
            errString.includes("503") || 
            errMsg.includes("503") || 
            errMsg.toLowerCase().includes("overloaded") ||
            errMsg.toLowerCase().includes("unavailable")
        ) {
            isServerOverload = true;
        }

        if (retries > 0 && (isRateLimit || isServerOverload)) {
            console.warn(`Gemini API Busy/Overloaded. Retrying in ${delay}ms... (${retries} attempts left)`);
            // Add jitter
            const jitter = Math.random() * 500;
            await new Promise(r => setTimeout(r, delay + jitter));
            return withRetry(fn, retries - 1, delay * 2);
        }
        throw error;
    }
};

// --- HELPER: ROBUST GENERATION WITH MODEL FALLBACK ---
const generateRobustContent = async (
    prompt: string, 
    config: any
): Promise<any> => {
    // 1. Try Primary Model (Flash 2.5)
    try {
        return await withRetry(async () => {
            return await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt,
                config: config
            });
        }, 3, 2000);
    } catch (error) {
        console.warn("Primary model (Flash 2.5) failed. Switching to fallback (Flash Lite)...", error);
        
        // 2. Try Fallback Model (Flash Lite)
        try {
            return await withRetry(async () => {
                return await ai.models.generateContent({
                    model: "gemini-2.5-flash-lite-latest",
                    contents: prompt,
                    config: config
                });
            }, 2, 3000);
        } catch (fallbackError) {
            console.error("All models failed.", fallbackError);
            throw fallbackError;
        }
    }
};

// --- INSTRUCTIONS UNIFIÉES ---
const SYSTEM_INSTRUCTION = `
Tu es le "Game Master" d'un jeu de stratégie géopolitique (GeoSim).
Ton but est de générer une simulation RÉALISTE, IMPRÉVISIBLE et COHÉRENTE avec l'année 2000.

### 1. PHILOSOPHIE "REALPOLITIK"
- **LOI DU PLUS FORT** : Si le joueur envahit un petit pays isolé sans alliés, l'annexion RÉUSSIT.
- **LE PRIX DU SANG** : Une annexion réussie augmente la Tension, baisse la Popularité, et augmente la Corruption.
- **GUERRE SYMÉTRIQUE** : Guerre d'usure si forces équilibrées.

### 2. GESTION DU TEMPS
- 'day' : Guerre active.
- 'month' : Tensions.
- 'year' : Paix.

### 3. DIPLOMATIE
- Réactions logiques aux actes du joueur.
- Messages brefs.
- Noms français exacts.

Format réponse : JSON uniquement.
`;

// Schema definition for Groq (JSON)
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
      spaceProgramActive: { type: "boolean" },
      mapUpdates: {
        type: "array",
        items: {
            type: "object",
            properties: {
                type: { type: "string", enum: ['annexation', 'build_factory', 'build_port', 'build_airport', 'build_airbase', 'build_defense'] },
                targetCountry: { type: "string" },
                newOwner: { type: "string" },
                lat: { type: "number" },
                lng: { type: "number" },
                label: { type: "string" }
            },
            required: ['type', 'targetCountry']
        }
      },
      incomingMessages: {
          type: "array",
          items: {
              type: "object",
              properties: {
                  sender: { type: "string" },
                  text: { type: "string" },
                  targets: { type: "array", items: { type: "string" } }
              },
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
      required: ["timeIncrement", "events", "globalTensionChange", "economyHealthChange", "militaryPowerChange", "popularityChange", "corruptionChange"],
};

// --- GROQ HELPER ---
const callGroq = async (prompt: string, system: string, jsonMode: boolean = true, schema: any = null): Promise<string> => {
    try {
        if (!GROQ_API_KEY) {
            throw new Error("Clé API Groq manquante.");
        }

        let systemContent = system;
        if (jsonMode) {
             const schemaToUse = schema || RESPONSE_SCHEMA_JSON;
             systemContent += "\n\nIMPORTANT: Tu DOIS répondre UNIQUEMENT avec un JSON valide respectant strictement ce schéma:\n" + JSON.stringify(schemaToUse);
        }

        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${GROQ_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                messages: [
                    { role: "system", content: systemContent },
                    { role: "user", content: prompt }
                ],
                model: "llama-3.3-70b-versatile",
                temperature: 0.7,
                response_format: jsonMode ? { type: "json_object" } : undefined
            })
        });
        
        if (!response.ok) throw new Error(`Groq API Error: ${response.status}`);
        const data = await response.json();
        return data.choices[0]?.message?.content || "";
    } catch (e) {
        console.error("Groq execution failed:", e);
        throw e;
    }
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
  provider: AIProvider = 'gemini'
): Promise<SimulationResponse> => {
  
  const historyContext = recentHistory.slice(-15).map(e => `[${e.date}] ${e.type.toUpperCase()}: ${e.headline}`).join('\n');
  const infrastructureContext = existingEntities.length > 0 ? existingEntities.join('\n- ') : "Aucune infrastructure majeure.";

  let chaosInstruction = "";
  if (chaosLevel === 'peaceful') chaosInstruction = "MODE PACIFIQUE: Guerre interdite.";
  if (chaosLevel === 'normal') chaosInstruction = "MODE STANDARD: Équilibre réaliste.";
  if (chaosLevel === 'high') chaosInstruction = "MODE HAUTE TENSION: Crises fréquentes.";
  if (chaosLevel === 'chaos') chaosInstruction = "MODE APOCALYPSE: Guerre totale.";

  const prompt = `
    --- ETAT DU MONDE (${currentDate}) ---
    NATION JOUEUR: ${playerCountry}
    POSSESSIONS: ${ownedTerritories.join(', ')}
    CHAOS: ${chaosInstruction}
    ORDRES: "${playerAction || "Gouvernance standard."}"
    DIPLOMATIE: ${diplomaticContext}
    HISTORIQUE: ${historyContext}

    TÂCHES:
    1. Analyse les ordres et DÉCIDE du 'timeIncrement'.
    2. Simule le tour avec réalisme (conséquences annexion).
    3. Gère stats (Tension, Eco, Pop, Corruption).
    4. Messages diplo si nécessaire.
  `;

  // Gemini Schema
  const geminiSchema: Schema = {
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

  if (provider === 'groq') {
      if (GROQ_API_KEY) {
          try {
              const jsonStr = await callGroq(prompt, SYSTEM_INSTRUCTION, true, RESPONSE_SCHEMA_JSON);
              return JSON.parse(jsonStr) as SimulationResponse;
          } catch (error) {
              console.warn("Groq failed, fallback to Gemini.", error);
          }
      }
  } 
  
  try {
      const response = await generateRobustContent(prompt, {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          responseSchema: geminiSchema,
          temperature: chaosLevel === 'chaos' ? 0.9 : 0.7,
      });
      const text = response.text;
      if (!text) throw new Error("No AI response");
      return JSON.parse(text) as SimulationResponse;
  } catch (error) {
      console.error("Gemini Critical Error:", error);
      return getFallbackResponse();
  }
};

export const sendDiplomaticMessage = async (
    playerCountry: string,
    responder: string,
    groupParticipants: string[],
    message: string,
    history: ChatMessage[],
    context: { militaryPower: number; economyHealth: number; globalTension: number; hasNuclear: boolean; },
    provider: AIProvider = 'gemini'
): Promise<string | null> => {
    
    const conversationContext = history
        .filter(msg => msg.targets.includes(responder) || groupParticipants.includes(msg.senderName))
        .slice(-6)
        .map(msg => `${msg.sender === 'player' ? playerCountry : msg.senderName}: ${msg.text}`)
        .join('\n');

    const prompt = `
    Tu incarnes : ${responder}.
    Interlocuteur : ${playerCountry}.
    Contexte : ${conversationContext}
    Message Joueur : "${message}"
    Réponds de manière réaliste (Realpolitik). Si non concerné: "NO_RESPONSE".
    Une seule phrase.
    `;

    if (provider === 'groq' && GROQ_API_KEY) {
        try {
            const text = await callGroq(prompt, "Tu es un chef d'état.", false);
            return text.trim() === "NO_RESPONSE" ? null : text;
        } catch (e) { console.warn("Groq failed, fallback to Gemini."); }
    }
    
    try {
        const response = await generateRobustContent(prompt, {});
        const text = response.text?.trim();
        return text === "NO_RESPONSE" ? null : text || "Reçu.";
    } catch (e) {
        return "Message reçu (Transmission faible).";
    }
}

const getFallbackResponse = (): SimulationResponse => ({
    timeIncrement: 'day',
    events: [{ 
        type: "world", 
        headline: "Silence Radio (Surcharge Réseau)", 
        description: "Les satellites ne répondent plus (Erreur 503). Les canaux diplomatiques sont saturés. Réessayez dans quelques instants." 
    }],
    globalTensionChange: 0,
    economyHealthChange: 0,
    militaryPowerChange: 0,
    popularityChange: 0,
    corruptionChange: 0
});

export const getStrategicSuggestions = async (
    playerCountry: string,
    recentHistory: GameEvent[],
    provider: AIProvider = 'gemini'
): Promise<string[]> => {
    
    const historyContext = recentHistory.slice(-5).map(e => e.headline).join('\n');
    const prompt = `Pays: ${playerCountry}. Historique: ${historyContext}. 3 actions stratégiques courtes (JSON array).`;

    if (provider === 'groq' && GROQ_API_KEY) {
        try {
            const json = await callGroq(prompt, "Conseiller stratégique", true, { type: "object", properties: { suggestions: { type: "array", items: { type: "string" } } } });
            const p = JSON.parse(json);
            return p.suggestions || p;
        } catch (e) { console.warn("Groq failed, fallback to Gemini."); }
    }

    try {
        const schema: Schema = { type: Type.ARRAY, items: { type: Type.STRING } };
        const response = await generateRobustContent(prompt, {
             responseMimeType: "application/json", 
             responseSchema: schema 
        });
        return JSON.parse(response.text || "[]") as string[];
    } catch (e) { return ["Renforcer l'armée", "Développer l'industrie", "Accords commerciaux"]; }
}

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
            console.warn(`API Busy/Overloaded. Retrying in ${delay}ms... (${retries} attempts left)`);
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
    try {
        return await withRetry(async () => {
            return await ai.models.generateContent({
                model: "gemini-3-flash-preview",
                contents: prompt,
                config: config
            });
        }, 3, 2000);
    } catch (error) {
        console.warn("Primary model failed. Switching to fallback...", error);
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

// --- INSTRUCTIONS UNIFIÉES ET RENFORCÉES ---
const SYSTEM_INSTRUCTION = `
ROLE: Tu es le "Moteur de Réalité" de GeoSim, une simulation géopolitique sans complaisance.

RÈGLES DE COMPORTEMENT (CRITIQUE) :
1. **RÉALISME BRUTAL** : Ne sois pas un simple exécutant des ordres du joueur. Si un ordre est donné, simule sa mise en œuvre RÉELLE. Il y a des imprévus, des trahisons, des échecs logistiques ou des succès inattendus.
2. **ASYMÉTRIE DE PUISSANCE** : 
   - Si une nation puissante (Militaire > 70) attaque ou annexe une nation faible, l'annexion militaire doit être FACILE et RAPIDE mais avec des conséquences politiques.
3. **CARTOGRAPHIE MILITAIRE** : 
   - Types de marqueurs autorisés UNIQUEMENT : 'build_factory' (usine d'armement/avions), 'build_port' (port militaire), 'build_airport' (base militaire terrestre), 'build_airbase' (base aérienne), 'build_defense' (radar, missiles).
   - PRÉCISION DU PLACEMENT : Tu dois t'assurer que les coordonnées (lat, lng) fournies sont STRICTEMENT à l'intérieur des frontières du pays concerné. Ne place jamais un point chez un voisin. Vérifie la géographie.
   - SUPPRESSION : Si le joueur demande de supprimer ou retirer une installation, ou si elle est détruite, utilise 'remove_entity' avec l'ID ou le label concerné.
4. **AUTONOMIE MONDIALE** : Les autres pays (IA) agissent selon la Realpolitik.
5. **STYLE ÉDITORIAL** : Rapports de renseignement (AFP, Reuters).
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
      spaceProgramActive: { type: "boolean" },
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

const callGroq = async (prompt: string, system: string, jsonMode: boolean = true, schema: any = null): Promise<string> => {
    try {
        if (!GROQ_API_KEY) throw new Error("Clé API Groq manquante.");
        let systemContent = system;
        if (jsonMode) {
             const schemaToUse = schema || RESPONSE_SCHEMA_JSON;
             systemContent += "\n\nCRITIQUE: REPONDS UNIQUEMENT EN JSON VALIDE. SCHEMA:\n" + JSON.stringify(schemaToUse);
        }
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
        if (!response.ok) throw new Error(`Groq API Error ${response.status}`);
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
  existingEntities: string[] = [],
  isLandlocked: boolean = false,
  hasNuclear: boolean = false,
  diplomaticContext: string = "",
  chaosLevel: ChaosLevel = 'normal',
  provider: AIProvider = 'gemini',
  playerPower: number = 50 // Ajouté pour le calcul d'asymétrie
): Promise<SimulationResponse> => {
  
  const historyContext = recentHistory.slice(-15).map(e => `[${e.date}] ${e.type.toUpperCase()}: ${e.headline}`).join('\n');
  
  const prompt = `
    --- ETAT DE LA SIMULATION ---
    DATE: ${currentDate}
    PAYS JOUEUR: ${playerCountry} (Puissance Militaire: ${playerPower}/100)
    POSSESSIONS: ${ownedTerritories.join(', ')}
    CHAOS: ${chaosLevel}
    
    ACTION DU JOUEUR (A TRAITER): "${playerAction || "Maintien de l'ordre."}"
    
    HISTORIQUE RECENT:
    ${historyContext}

    INSTALLATIONS ACTUELLES: ${existingEntities.join(', ')}

    DIPLOMATIE ACTUELLE: ${diplomaticContext}

    CONSIGNES DE SIMULATION :
    1. Traite l'ordre du joueur avec nuance.
    2. Respecte les types d'entités demandés. Pour les suppressions, utilise 'remove_entity'.
    3. ASSURE-TOI QUE LES COORDONNÉES DES NOUVELLES INSTALLATIONS SONT BIEN DANS LE PAYS CIBLE. Ne place rien chez le voisin.
    4. Le monde continue de tourner : produis au moins 2 événements majeurs.
  `;

  if (provider === 'groq' && GROQ_API_KEY) {
      try {
          const jsonStr = await callGroq(prompt, SYSTEM_INSTRUCTION, true, RESPONSE_SCHEMA_JSON);
          return JSON.parse(jsonStr) as SimulationResponse;
      } catch (error) { console.warn("Groq failed, fallback to Gemini."); }
  } 
  
  try {
      const response = await generateRobustContent(prompt, {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA_JSON as any,
          temperature: 0.85,
      });
      return JSON.parse(response.text) as SimulationResponse;
  } catch (error) { return getFallbackResponse(); }
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

    const prompt = `Tu es le dirigeant de ${responder}. ${playerCountry} te dit : "${message}". Contexte : ${conversationContext}. Réponds de manière stratégique et concise. Si tu es offensé ou menacé, réagis en conséquence selon ta puissance par rapport à eux (Puissance Joueur: ${context.militaryPower}).`;

    if (provider === 'groq' && GROQ_API_KEY) {
        try {
            const text = await callGroq(prompt, "Tu es un chef d'état réaliste. Réponds directement.", false);
            return text.trim() === "NO_RESPONSE" ? null : text;
        } catch (e) { console.warn("Groq failed, fallback to Gemini."); }
    }
    
    try {
        const response = await generateRobustContent(prompt, { temperature: 0.7 });
        const text = response.text?.trim();
        return text === "NO_RESPONSE" ? null : text || "Reçu.";
    } catch (e) { return "Transmission diplomatique reçue."; }
}

const getFallbackResponse = (): SimulationResponse => ({
    timeIncrement: 'day',
    events: [{ type: "world", headline: "Instabilité des communications", description: "Le flux d'informations mondial est perturbé." }],
    globalTensionChange: 0, economyHealthChange: 0, militaryPowerChange: 0, popularityChange: 0, corruptionChange: 0
});

export const getStrategicSuggestions = async (
    playerCountry: string,
    recentHistory: GameEvent[],
    provider: AIProvider = 'gemini'
): Promise<string[]> => {
    const historyContext = recentHistory.slice(-5).map(e => e.headline).join('\n');
    const prompt = `Suggère 3 actions machiavéliques ou diplomatiques pour ${playerCountry} sachant que : ${historyContext}. Format JSON: {"suggestions": ["..."]}`;
    try {
        if (provider === 'groq' && GROQ_API_KEY) {
            const json = await callGroq(prompt, "Conseiller stratégique cynique. JSON uniquement.", true, { type: "object", properties: { suggestions: { type: "array", items: { type: "string" } } } });
            return JSON.parse(json).suggestions;
        }
        const response = await generateRobustContent(prompt, { responseMimeType: "application/json", temperature: 0.8 });
        return JSON.parse(response.text).suggestions || JSON.parse(response.text);
    } catch (e) { return ["Moderniser l'industrie", "Réprimer l'opposition", "Proposer un traité"]; }
}

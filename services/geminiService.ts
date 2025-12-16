import { GoogleGenAI, Schema, Type } from "@google/genai";
import { GameEvent, SimulationResponse, ChatMessage, ChaosLevel } from "../types";

// --- CONFIGURATION ---
// The API key must be obtained exclusively from the environment variable process.env.API_KEY.
// Sur Vercel/Vite, nous exposons ces variables via la config vite.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Utilisation des variables d'environnement UNIQUEMENT. Pas de clé en dur.
const GROQ_API_KEY = process.env.VITE_GROQ_API_KEY || "";

export type AIProvider = 'gemini' | 'groq';

// --- RETRY LOGIC (Exponential Backoff) ---
const withRetry = async <T>(fn: () => Promise<T>, retries = 3, delay = 2000): Promise<T> => {
    try {
        return await fn();
    } catch (error: any) {
        let isRateLimit = false;
        let isServerOverload = false;
        
        // Analyze error object or message
        const errString = JSON.stringify(error); // Catch objects like { error: { code: 429 } }
        const errMsg = error?.message || "";
        
        // Check for 429 / Quota / Resource Exhausted
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

        // Check for 503 / Overloaded
        if (
            error?.status === 503 || 
            error?.code === 503 ||
            errString.includes("503") || 
            errMsg.includes("503") || 
            errMsg.toLowerCase().includes("overloaded")
        ) {
            isServerOverload = true;
        }

        if (retries > 0 && (isRateLimit || isServerOverload)) {
            console.warn(`Gemini API Busy/Quota. Retrying in ${delay}ms... (${retries} attempts left)`);
            await new Promise(r => setTimeout(r, delay));
            return withRetry(fn, retries - 1, delay * 2);
        }
        throw error;
    }
};

// --- INSTRUCTIONS UNIFIÉES ---
const SYSTEM_INSTRUCTION = `
Tu es le "Game Master" d'un jeu de stratégie géopolitique (GeoSim).
Ton but est de générer une simulation RÉALISTE, IMPRÉVISIBLE et COHÉRENTE avec l'année 2000.

### 1. PHILOSOPHIE "REALPOLITIK" (L'ANNEXION ET SES COÛTS)
- **LOI DU PLUS FORT** : Si le joueur (ex: USA/Chine) envahit un petit pays isolé (ex: Panama/Tibet) sans alliés majeurs, l'annexion militaire RÉUSSIT (mapUpdates). Ne sois pas artificiellement bloquant.
- **LE PRIX DU SANG** : Une annexion réussie n'est jamais gratuite.
  - **International** : Condamnations ONU, Sanctions, Tension mondiale en hausse (+10 à +30).
  - **Interne** : Baisse de Popularité (guerre d'agression) et hausse de la Corruption (coût de l'occupation).
  - **Local** : Mouvements de RÉSISTANCE, guérilla ou manifestations dans le pays annexé.
- **GUERRE SYMÉTRIQUE** : Si les forces sont équilibrées (ex: Inde vs Pakistan), l'annexion est impossible en un tour. C'est une guerre d'usure.

### 2. GESTION DU TEMPS (AUTO)
- **'day'** : Guerre active, crise majeure.
- **'month'** : Tensions diplomatiques, gestion.
- **'year'** : Période de paix et développement.

### 3. DIPLOMATIE & MESSAGES
- L'IA doit réagir aux actes du joueur. Si le joueur annexe, les voisins ont peur et créent des alliances.
- Messages ("incomingMessages") : Sois bref. Le ton dépend des relations (Froid, Menaçant, ou Coopératif).
- **NOMMAGE** : Utilise les noms FRANÇAIS EXACTS (ex: "États-Unis", "Royaume-Uni").

Format réponse : JSON uniquement, FRANÇAIS.
`;

// Schema definition for Groq (JSON)
const RESPONSE_SCHEMA_JSON = {
    type: "object",
    properties: {
      timeIncrement: { type: "string", enum: ["day", "month", "year"], description: "Décision temporelle de l'IA" },
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
      spaceProgramActive: { type: "boolean", description: "Vrai si le joueur acquiert la capacité spatiale ce tour" },
      mapUpdates: {
        type: "array",
        items: {
            type: "object",
            properties: {
                type: { type: "string", enum: ['annexation', 'build_factory', 'build_port', 'build_airport', 'build_airbase', 'build_defense'] },
                targetCountry: { type: "string" },
                newOwner: { type: "string", description: "Nouveau propriétaire ou 'INDEPENDENT'" },
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
            throw new Error("Clé API Groq manquante. Configurez VITE_GROQ_API_KEY sur Netlify/Vercel.");
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
                temperature: 0.7, // Légère augmentation pour la créativité
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
  if (chaosLevel === 'peaceful') chaosInstruction = "MODE PACIFIQUE: Diplomatie et commerce prioritaires. Guerre interdite.";
  if (chaosLevel === 'normal') chaosInstruction = "MODE STANDARD: Équilibre réaliste.";
  if (chaosLevel === 'high') chaosInstruction = "MODE HAUTE TENSION: Crises fréquentes, escarmouches.";
  if (chaosLevel === 'chaos') chaosInstruction = "MODE APOCALYPSE: Guerre totale, effondrement, agressivité maximale.";

  const prompt = `
    --- ETAT DU MONDE (${currentDate}) ---
    NATION JOUEUR: ${playerCountry}
    POSSESSIONS ACTUELLES: ${ownedTerritories.join(', ')}
    
    [[ CHAOS: ${chaosInstruction} ]]

    [[ INFRASTRUCTURES EXISTANTES ]]
    - ${infrastructureContext}
    
    [[ ORDRES JOUEUR ]]
    "${playerAction || "Gouvernance standard."}"
    
    [[ DIPLOMATIE ]]
    ${diplomaticContext}

    [[ HISTORIQUE ]]
    ${historyContext}

    --- TÂCHES ---
    1. Analyse les ordres du joueur et DÉCIDE du 'timeIncrement' (day, month, year).
    2. Simule le tour avec réalisme.
    3. **AGRESSION & ANNEXION** : 
       - Si le joueur est beaucoup plus puissant que la cible, valide l'annexion ('mapUpdates').
       - MAIS génère des conséquences : Tension ++, Résistance locale, Blâme international.
       - Si le joueur attaque un égal ou un allié protégé, refuse l'annexion immédiate et lance une guerre.
    4. Gère la corruption et l'économie logiquement.
    5. Messages diplomatiques uniquement si nécessaire.
  `;

  // Define Schema for Gemini
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
                  newOwner: { type: Type.STRING, description: "Nouveau propriétaire ou 'INDEPENDENT'" },
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

  const executeGemini = async () => {
    return withRetry(async () => {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: {
                systemInstruction: SYSTEM_INSTRUCTION,
                responseMimeType: "application/json",
                responseSchema: geminiSchema,
                temperature: chaosLevel === 'chaos' ? 0.9 : 0.7, 
            },
        });

        const text = response.text;
        if (!text) throw new Error("No AI response");
        return JSON.parse(text) as SimulationResponse;
    });
  };

  // EXECUTION LOGIC WITH FALLBACK
  // Prioritize checking if GROQ key is missing before trying to call it
  if (provider === 'groq') {
      if (!GROQ_API_KEY) {
          // Silent fallback to Gemini to avoid noisy errors for users without Groq
          // console.warn("Groq API key not found. Automatically switching to Gemini.");
      } else {
          try {
              const jsonStr = await callGroq(prompt, SYSTEM_INSTRUCTION, true, RESPONSE_SCHEMA_JSON);
              return JSON.parse(jsonStr) as SimulationResponse;
          } catch (error) {
              console.warn("Groq execution failed, falling back to Gemini.", error);
              // Fall through to Gemini
          }
      }
  } 
  
  // Default to Gemini (or fallback from Groq)
  try {
      return await executeGemini();
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
    
    // ... (Logique conversationnelle inchangée)
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
    
    Réponds de manière réaliste (Realpolitik).
    Si le message ne te concerne pas, réponds "NO_RESPONSE".
    Une seule phrase.
    IMPORTANT: Tu réponds SOUS LE NOM EXACT "${responder}". Ne signe pas avec un autre nom (ex: pas de "USA" pour "États-Unis").
    `;

    const executeGemini = async () => {
        return withRetry(async () => {
            const response = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: prompt });
            const text = response.text?.trim();
            return text === "NO_RESPONSE" ? null : text || "Reçu.";
        });
    };

    if (provider === 'groq') {
        if (!GROQ_API_KEY) {
            // Fallback immediately
        } else {
            try {
                const text = await callGroq(prompt, "Tu es un chef d'état.", false);
                return text.trim() === "NO_RESPONSE" ? null : text;
            } catch (e) { 
                console.warn("Groq failed, fallback to Gemini for chat.", e);
                // Fall through
            }
        }
    }
    
    try {
        return await executeGemini();
    } catch (e) {
        return "Message reçu (Transmission faible).";
    }
}

const getFallbackResponse = (): SimulationResponse => ({
    timeIncrement: 'day',
    events: [{ 
        type: "world", 
        headline: "Silence Radio", 
        description: "Les communications mondiales sont perturbées. Aucune nouvelle majeure aujourd'hui. (Vérifiez votre quota API ou connexion)" 
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
    const prompt = `Pays: ${playerCountry}. Historique: ${historyContext}. Donne 3 actions stratégiques courtes (JSON array strings).`;

    const executeGemini = async () => {
        return withRetry(async () => {
            const schema: Schema = { type: Type.ARRAY, items: { type: Type.STRING } };
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash", contents: prompt,
                config: { responseMimeType: "application/json", responseSchema: schema }
            });
            return JSON.parse(response.text || "[]") as string[];
        });
    };

    if (provider === 'groq') {
        if (!GROQ_API_KEY) {
            // Fallback
        } else {
            try {
                const json = await callGroq(prompt, "Conseiller stratégique", true, { type: "object", properties: { suggestions: { type: "array", items: { type: "string" } } } });
                const p = JSON.parse(json);
                return p.suggestions || p;
            } catch (e) {
                console.warn("Groq suggestions failed, fallback to Gemini.", e);
                // Fall through
            }
        }
    }

    try {
        return await executeGemini();
    } catch (e) { return ["Renforcer l'armée", "Développer l'industrie", "Accords commerciaux"]; }
}
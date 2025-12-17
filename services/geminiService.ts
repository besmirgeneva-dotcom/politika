import { GoogleGenAI, Schema, Type } from "@google/genai";
import { GameEvent, SimulationResponse, ChatMessage, ChaosLevel } from "../types";

// --- CONFIGURATION ---
const DEFAULT_API_KEY = process.env.API_KEY;
const GROQ_API_KEY_ENV = process.env.VITE_GROQ_API_KEY || "";

// On étend le type pour inclure openai
export type AIProvider = 'gemini' | 'groq' | 'openai' | 'custom';

// Helper pour obtenir l'instance Gemini avec la bonne clé
const getAIClient = (customKey?: string) => {
    return new GoogleGenAI({ apiKey: customKey || DEFAULT_API_KEY });
};

// --- RETRY LOGIC (Exponential Backoff) ---
const withRetry = async <T>(fn: () => Promise<T>, retries = 3, delay = 2000): Promise<T> => {
    try {
        return await fn();
    } catch (error: any) {
        let isRateLimit = false;
        let isServerOverload = false;
        
        const errString = JSON.stringify(error);
        const errMsg = error?.message || "";
        
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

// --- HELPER: ROBUST GEMINI GENERATION ---
const generateRobustContent = async (
    prompt: string, 
    config: any,
    apiKey?: string
): Promise<any> => {
    const aiClient = getAIClient(apiKey);
    try {
        return await withRetry(async () => {
            return await aiClient.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt,
                config: config
            });
        }, 3, 2000);
    } catch (error) {
        console.warn("Primary model (Flash 2.5) failed. Switching to fallback...", error);
        try {
            return await withRetry(async () => {
                return await aiClient.models.generateContent({
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
ROLE: Tu es le "Moteur de Réalité" d'une simulation géopolitique complexe (GeoSim).
CONTEXTE: Jeu vidéo de stratégie "Grand Strategy".
OBJECTIF: Simuler un monde VIVANT, AUTONOME et COHÉRENT.

RÈGLES D'OR POUR L'IA (CRITIQUE):
1. **PRIORITÉ ABSOLUE À L'ACTION DU JOUEUR**:
   - Tu DOIS traiter l'ordre du joueur ("playerAction").
   - Tu DOIS générer un événement de type "player" qui décrit explicitement le résultat de cet ordre (Succès, Échec, Début de construction, etc.).
   - Si le joueur construit quelque chose (radar, base, usine), tu DOIS générer un "mapUpdate".

2. **AUTONOMIE DES PNJs**:
   - Tu contrôles les 195 autres pays. Ils ont leurs propres intérêts.
   - ILS N'ATTENDENT PAS LE JOUEUR. Ils signent des traités, déclenchent des guerres et des crises économiques ENTRE EUX.

3. **LE JOUEUR N'EST PAS DIEU**:
   - Si le joueur ordonne une action irréaliste (ex: Le Luxembourg annexe la Chine), l'action DOIT ÉCHOUER avec des conséquences désastreuses.
   - Ne sois pas complaisant. Oppose une résistance diplomatique et militaire logique.

4. **TON ET STYLE**:
   - Style journalistique ou dépêche diplomatique. Précis, froid, impactant.
   - Utilise les noms français exacts des pays.

Format de réponse attendu : JSON UNIQUEMENT.
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
            type: { type: "string", enum: ["player", "world", "crisis", "economy", "war", "alliance"] },
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

// --- OPENAI HELPER ---
const callOpenAI = async (prompt: string, system: string, apiKey: string, jsonMode: boolean = true): Promise<string> => {
    try {
        let systemContent = system;
        if (jsonMode) {
             systemContent += "\n\nCRITIQUE: REPONDS UNIQUEMENT EN JSON VALIDE. SCHEMA:\n" + JSON.stringify(RESPONSE_SCHEMA_JSON);
        }

        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                messages: [
                    { role: "system", content: systemContent },
                    { role: "user", content: prompt }
                ],
                model: "gpt-4o", // Utilisation de GPT-4o par défaut pour meilleure qualité
                temperature: 0.8,
                max_tokens: 2048,
                response_format: jsonMode ? { type: "json_object" } : undefined
            })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(`OpenAI Error: ${JSON.stringify(err)}`);
        }

        const data = await response.json();
        return data.choices[0]?.message?.content || "";
    } catch (e) {
        console.error("OpenAI Call Failed:", e);
        throw e;
    }
};

// --- GROQ HELPER ---
const callGroq = async (prompt: string, system: string, jsonMode: boolean = true, apiKey?: string): Promise<string> => {
    try {
        const keyToUse = apiKey || GROQ_API_KEY_ENV;
        if (!keyToUse) throw new Error("Clé API Groq manquante.");

        let systemContent = system;
        if (jsonMode) {
             systemContent += "\n\nCRITIQUE: TU DOIS REPONDRE UNIQUEMENT AVEC UN JSON VALIDE. PAS DE MARKDOWN. SCHEMA OBLIGATOIRE:\n" + JSON.stringify(RESPONSE_SCHEMA_JSON);
        }

        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${keyToUse}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                messages: [
                    { role: "system", content: systemContent },
                    { role: "user", content: prompt }
                ],
                model: "llama-3.3-70b-versatile",
                temperature: 0.75,
                max_tokens: 2048,
                response_format: jsonMode ? { type: "json_object" } : undefined
            })
        });
        
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(`Groq API Error ${response.status}: ${JSON.stringify(errData)}`);
        }
        
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
  provider: string = 'gemini', // Changed type to string to support custom values
  customApiKey?: string
): Promise<SimulationResponse> => {
  
  const historyContext = recentHistory.slice(-15).map(e => `[${e.date}] ${e.type.toUpperCase()}: ${e.headline}`).join('\n');
  
  let chaosInstruction = "";
  if (chaosLevel === 'peaceful') chaosInstruction = "MODE PACIFIQUE: Guerre interdite.";
  if (chaosLevel === 'normal') chaosInstruction = "MODE STANDARD: Équilibre réaliste.";
  if (chaosLevel === 'high') chaosInstruction = "MODE HAUTE TENSION: Crises fréquentes.";
  if (chaosLevel === 'chaos') chaosInstruction = "MODE APOCALYPSE: Guerre totale.";

  const prompt = `
    CONTEXTE SIMULATION (FICTION):
    DATE ACTUELLE: ${currentDate}
    PAYS DU JOUEUR: ${playerCountry}
    POSSESSIONS: ${ownedTerritories.join(', ')}
    NIVEAU DE CHAOS: ${chaosInstruction}
    
    ACTION DU JOUEUR (ORDRES): "${playerAction || "Gouvernance standard. Maintien du statu quo."}"
    
    CONTEXTE HISTORIQUE RÉCENT:
    ${historyContext}

    TES MISSIONS POUR CE TOUR:
    1. **OBLIGATOIRE: Juger l'action du joueur**:
       - Tu DOIS inclure un événement de type "player" en première position.
       - Cet événement doit décrire le résultat de l'ordre "${playerAction}".
       - Si le joueur veut construire quelque chose (ex: Radar, Base), tu DOIS ajouter un élément dans "mapUpdates" avec type 'build_defense', 'build_airbase', etc. et le label approprié.
    
    2. **Simuler le Reste du Monde**: Génère ensuite des événements qui n'impliquent PAS le joueur.
    3. **Définir le Temps**: Choisis 'day' si urgence/guerre, 'month' si tensions, 'year' si calme.
    4. **Conséquences**: Mets à jour les stats (Tension, Économie, Corruption).
    
    Sois créatif. Surprends le joueur. Ne sois pas passif.
  `;

  // --- OPENAI ROUTING ---
  if (provider === 'openai' && customApiKey) {
      try {
          const jsonStr = await callOpenAI(prompt, SYSTEM_INSTRUCTION, customApiKey, true);
          return JSON.parse(jsonStr) as SimulationResponse;
      } catch (error) {
          console.error("OpenAI error", error);
          // Fallback handled below
      }
  }

  // --- GROQ ROUTING ---
  if (provider === 'groq') {
      try {
          const jsonStr = await callGroq(prompt, SYSTEM_INSTRUCTION, true, customApiKey);
          return JSON.parse(jsonStr) as SimulationResponse;
      } catch (error) {
          console.warn("Groq failed, fallback to Gemini.", error);
      }
  } 
  
  // --- GEMINI (DEFAULT) ---
  const geminiSchema: Schema = {
      type: Type.OBJECT,
      properties: {
      timeIncrement: { type: Type.STRING, enum: ["day", "month", "year"] },
      events: {
          type: Type.ARRAY,
          items: {
          type: Type.OBJECT,
          properties: {
              type: { type: Type.STRING, enum: ["player", "world", "crisis", "economy", "war", "alliance"] },
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

  try {
      const response = await generateRobustContent(prompt, {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          responseSchema: geminiSchema,
          temperature: chaosLevel === 'chaos' ? 0.95 : 0.8,
      }, customApiKey); // Use custom key if provider is 'gemini' and key provided (or fallback logic in App.tsx)
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
    provider: string = 'gemini',
    customApiKey?: string
): Promise<string | null> => {
    
    const conversationContext = history
        .filter(msg => msg.targets.includes(responder) || groupParticipants.includes(msg.senderName))
        .slice(-6)
        .map(msg => `${msg.sender === 'player' ? playerCountry : msg.senderName}: ${msg.text}`)
        .join('\n');

    const prompt = `
    JEU DE ROLE GEOPOLITIQUE.
    Tu incarnes le dirigeant de : ${responder}.
    Tu parles avec : ${playerCountry}.
    
    CONTEXTE DE LA DISCUSSION:
    ${conversationContext}
    
    DERNIER MESSAGE REÇU: "${message}"
    
    INSTRUCTIONS:
    - Réponds en tant que Chef d'État (bref, stratégique, parfois menaçant ou amical selon les intérêts).
    - Si l'offre est mauvaise, refuse sèchement.
    - Si tu n'es pas directement concerné ou si le message est du bruit, réponds "NO_RESPONSE".
    
    Réponse (1-2 phrases max) :
    `;

    if (provider === 'openai' && customApiKey) {
        try {
            const text = await callOpenAI(prompt, "Tu es un chef d'état. Réponds directement.", customApiKey, false);
            return text.trim() === "NO_RESPONSE" ? null : text;
        } catch (e) { console.warn("OpenAI failed."); }
    }

    if (provider === 'groq') {
        try {
            const text = await callGroq(prompt, "Tu es un chef d'état réaliste. Réponds directement. Pas de préambule.", false, customApiKey);
            return text.trim() === "NO_RESPONSE" ? null : text;
        } catch (e) { console.warn("Groq failed, fallback to Gemini."); }
    }
    
    try {
        const response = await generateRobustContent(prompt, {
            temperature: 0.7
        }, provider === 'gemini' ? customApiKey : undefined);
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
        description: "Les canaux diplomatiques sont saturés (Erreur API). Nos services de renseignement redémarrent les systèmes." 
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
    provider: string = 'gemini',
    customApiKey?: string
): Promise<string[]> => {
    
    const historyContext = recentHistory.slice(-5).map(e => e.headline).join('\n');
    const prompt = `
    Pays: ${playerCountry}.
    Historique récent: ${historyContext}
    
    Suggère 3 actions stratégiques intelligentes, machiavéliques ou diplomatiques pour ce tour.
    Format JSON: {"suggestions": ["action 1", "action 2", "action 3"]}
    `;

    if (provider === 'openai' && customApiKey) {
        try {
            const json = await callOpenAI(prompt, "Conseiller stratégique. JSON uniquement.", customApiKey, true);
            const p = JSON.parse(json);
            return p.suggestions || p;
        } catch (e) { console.warn("OpenAI failed."); }
    }

    if (provider === 'groq') {
        try {
            const json = await callGroq(prompt, "Conseiller stratégique (Realpolitik). JSON uniquement.", true, customApiKey);
            const p = JSON.parse(json);
            return p.suggestions || p;
        } catch (e) { console.warn("Groq failed, fallback to Gemini."); }
    }

    try {
        const schema: Schema = { type: Type.ARRAY, items: { type: Type.STRING } };
        const response = await generateRobustContent(prompt, {
             responseMimeType: "application/json", 
             responseSchema: schema,
             temperature: 0.8
        }, provider === 'gemini' ? customApiKey : undefined);
        return JSON.parse(response.text || "[]") as string[];
    } catch (e) { return ["Renforcer l'armée", "Négocier une alliance", "Développer l'économie"]; }
}
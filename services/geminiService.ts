import { GoogleGenAI, Schema, Type } from "@google/genai";
import { GameEvent, SimulationResponse, ChatMessage, ChaosLevel } from "../types";

// --- CONFIGURATION ---
const DEFAULT_API_KEY = process.env.API_KEY;
const GROQ_API_KEY_ENV = process.env.VITE_GROQ_API_KEY || "";

// On étend le type pour inclure huggingface
export type AIProvider = 'gemini' | 'groq' | 'openai' | 'huggingface' | 'custom';

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
        
        // Detection 429 (Rate Limit)
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

        // Detection 503 (Service Unavailable / Model Loading)
        if (
            error?.status === 503 || 
            error?.code === 503 ||
            errString.includes("503") || 
            errMsg.includes("503") || 
            errMsg.toLowerCase().includes("overloaded") ||
            errMsg.toLowerCase().includes("unavailable") ||
            errMsg.toLowerCase().includes("loading") // Pour Hugging Face "Model is loading"
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
   - Si le joueur construit ou déploie, utilise "mapUpdates".

2. **GÉOGRAPHIE & DÉPLOIEMENT MILITAIRE (CRITIQUE - ZÉRO ERREUR)**:
   - **Déploiement Général**: Si le joueur ne précise pas de ville/lieu exact (ex: "Armée en Pologne"), METS IMPÉRATIVEMENT \`lat: 0\` et \`lng: 0\`. Le moteur de jeu placera alors automatiquement le point au centre géométrique exact du pays. C'est la seule façon d'éviter les erreurs.
   - **Déploiement Frontalier**: Si le joueur vise une frontière (ex: "Frontière France-Espagne"), place le point LÉGÈREMENT à l'intérieur du pays propriétaire de l'unité (ex: France). Ne le place JAMAIS pile sur la ligne ou chez le voisin (Espagne), pour éviter les confusions visuelles. Reste prudent.
   - **Déploiement Précis (Ville)**: Si une ville est citée, sois précis mais vérifie que les coordonnées sont bien DANS le pays.

3. **SUPPRESSION / RETRAIT (IMPORTANT)**:
   - Si le joueur demande de retirer, démanteler, rappeler ou supprimer des unités/structures (ex: "Retire les radars au Kosovo").
   - Utilise \`mapUpdates\` avec \`type: "remove_entity"\`.
   - Dans le champ \`label\`, mets le mot-clé de ce qu'il faut supprimer (ex: "radar", "base", "troupes"). Si vide, le moteur risque de ne rien supprimer.

4. **ANNEXION ET EXPANSION (FACILITÉ)**:
   - **Alliés & Faibles**: Si le joueur tente d'annexer un pays allié, un vassal, ou un pays beaucoup plus faible (ex: France annexe Monaco, USA annexe Panama), SOIS TRÈS PERMISSIF.
   - **Validation**: Valide l'annexion via \`mapUpdates\` -> \`type: "annexation"\` immédiatement si la force militaire ou l'influence politique est suffisante. Ne crée pas de résistance artificielle inutile pour ces cas "faciles".
   - **Résistance**: Réserve la résistance acharnée pour les invasions de grandes puissances ou de rivaux directs.

5. **PRÉCISION DES POSSESSIONS**:
   - Ne place jamais une base du joueur dans un pays qu'il ne contrôle pas (sauf invasion explicite).

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
        }
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
                type: { type: "string", enum: ["annexation", "build_factory", "build_port", "build_airport", "build_airbase", "build_defense", "build_base", "troop_deployment", "remove_entity"] },
                targetCountry: { type: "string" },
                newOwner: { type: "string" },
                lat: { type: "number" },
                lng: { type: "number" },
                label: { type: "string" }
            },
            required: ["type", "targetCountry"]
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
    required: ["timeIncrement", "events", "globalTensionChange", "economyHealthChange", "militaryPowerChange", "popularityChange", "corruptionChange"]
};

// --- GENERIC OPENAI-COMPATIBLE HELPER (OpenAI, Groq, Hugging Face) ---
const callOpenAICompatible = async (
    url: string,
    model: string,
    prompt: string, 
    system: string, 
    apiKey: string, 
    jsonMode: boolean = true
): Promise<string> => {
    try {
        let systemContent = system;
        if (jsonMode) {
             systemContent += "\n\nCRITIQUE: TU DOIS REPONDRE UNIQUEMENT AVEC UN JSON VALIDE. PAS DE MARKDOWN. SCHEMA OBLIGATOIRE:\n" + JSON.stringify(RESPONSE_SCHEMA_JSON);
        }

        const response = await fetch(url, {
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
                model: model,
                temperature: 0.75,
                max_tokens: 2048,
                response_format: jsonMode ? { type: "json_object" } : undefined
            })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({ error: response.statusText }));
            throw new Error(`API Error ${response.status}: ${JSON.stringify(errData)}`);
        }

        const data = await response.json();
        return data.choices[0]?.message?.content || "";
    } catch (e) {
        console.error(`Call to ${url} failed:`, e);
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
  provider: string = 'gemini', 
  customApiKey?: string,
  customModel?: string // Paramètre optionnel pour le modèle
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
       - Si le joueur construit ou déploie des troupes, tu DOIS ajouter un élément dans "mapUpdates" avec type adapté (ex: troop_deployment).
       - Si le joueur retire ou supprime des unités, tu DOIS ajouter un élément dans "mapUpdates" avec type "remove_entity" et préciser le "label".
       - Si le joueur annexe un pays (surtout faible/allié), valide l'annexion via "mapUpdates" -> "annexation" si c'est plausible.
       - **RAPPEL GEO CRITIQUE**: Utilise TOUJOURS \`lat: 0, lng: 0\` pour un déploiement général (centre du pays).
    
    2. **Simuler le Reste du Monde**: Génère ensuite des événements qui n'impliquent PAS le joueur.
    3. **Définir le Temps**: Choisis 'day' si urgence/guerre, 'month' si tensions, 'year' si calme.
    4. **Conséquences**: Mets à jour les stats (Tension, Économie, Corruption).
    
    Sois créatif. Surprends le joueur. Ne sois pas passif.
  `;

  // --- HUGGING FACE ROUTING ---
  if (provider === 'huggingface' && customApiKey) {
      try {
          // Utilisation d'un modèle par défaut solide si aucun n'est spécifié
          // "mistralai/Mistral-7B-Instruct-v0.3" est un bon compromis gratuit/logique
          const modelToUse = customModel || "mistralai/Mistral-7B-Instruct-v0.3";
          // Endpoint compatible OpenAI pour HF
          const url = `https://api-inference.huggingface.co/models/${modelToUse}/v1/chat/completions`;
          const jsonStr = await withRetry(() => callOpenAICompatible(url, modelToUse, prompt, SYSTEM_INSTRUCTION, customApiKey, true));
          return JSON.parse(jsonStr) as SimulationResponse;
      } catch (error) {
          console.error("Hugging Face error", error);
      }
  }

  // --- OPENAI ROUTING ---
  if (provider === 'openai' && customApiKey) {
      try {
          const modelToUse = customModel || "gpt-4o";
          const jsonStr = await callOpenAICompatible("https://api.openai.com/v1/chat/completions", modelToUse, prompt, SYSTEM_INSTRUCTION, customApiKey, true);
          return JSON.parse(jsonStr) as SimulationResponse;
      } catch (error) {
          console.error("OpenAI error", error);
      }
  }

  // --- GROQ ROUTING ---
  if (provider === 'groq') {
      try {
          const keyToUse = customApiKey || GROQ_API_KEY_ENV;
          if (!keyToUse) throw new Error("Clé API Groq manquante.");
          const modelToUse = customModel || "llama-3.3-70b-versatile";
          const jsonStr = await callOpenAICompatible("https://api.groq.com/openai/v1/chat/completions", modelToUse, prompt, SYSTEM_INSTRUCTION, keyToUse, true);
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
          }
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
                  type: { type: Type.STRING, enum: ["annexation", "build_factory", "build_port", "build_airport", "build_airbase", "build_defense", "build_base", "troop_deployment", "remove_entity"] },
                  targetCountry: { type: Type.STRING },
                  newOwner: { type: Type.STRING },
                  lat: { type: Type.NUMBER },
                  lng: { type: Type.NUMBER },
                  label: { type: Type.STRING }
              },
              required: ["type", "targetCountry"]
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
      required: ["timeIncrement", "events", "globalTensionChange", "economyHealthChange", "militaryPowerChange", "popularityChange", "corruptionChange"]
  };

  try {
      const response = await generateRobustContent(prompt, {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          responseSchema: geminiSchema,
          temperature: chaosLevel === 'chaos' ? 0.95 : 0.8
      }, customApiKey); 
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
    customApiKey?: string,
    customModel?: string
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

    // Hugging Face
    if (provider === 'huggingface' && customApiKey) {
        try {
            const modelToUse = customModel || "mistralai/Mistral-7B-Instruct-v0.3";
            const url = `https://api-inference.huggingface.co/models/${modelToUse}/v1/chat/completions`;
            const text = await withRetry(() => callOpenAICompatible(url, modelToUse, prompt, "Tu es un chef d'état. Réponds directement.", customApiKey, false));
            return text.trim() === "NO_RESPONSE" ? null : text;
        } catch (e) { console.warn("Hugging Face failed."); }
    }

    // OpenAI
    if (provider === 'openai' && customApiKey) {
        try {
            const modelToUse = customModel || "gpt-4o";
            const text = await callOpenAICompatible("https://api.openai.com/v1/chat/completions", modelToUse, prompt, "Tu es un chef d'état. Réponds directement.", customApiKey, false);
            return text.trim() === "NO_RESPONSE" ? null : text;
        } catch (e) { console.warn("OpenAI failed."); }
    }

    // Groq
    if (provider === 'groq') {
        try {
            const modelToUse = customModel || "llama-3.3-70b-versatile";
            const text = await callOpenAICompatible("https://api.groq.com/openai/v1/chat/completions", modelToUse, prompt, "Tu es un chef d'état réaliste.", customApiKey || GROQ_API_KEY_ENV, false);
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
    customApiKey?: string,
    customModel?: string
): Promise<string[]> => {
    
    const historyContext = recentHistory.slice(-5).map(e => e.headline).join('\n');
    const prompt = `
    Pays: ${playerCountry}.
    Historique récent: ${historyContext}
    
    Suggère 3 actions stratégiques intelligentes, machiavéliques ou diplomatiques pour ce tour.
    Format JSON: {"suggestions": ["action 1", "action 2", "action 3"]}
    `;

    // Hugging Face
    if (provider === 'huggingface' && customApiKey) {
        try {
            const modelToUse = customModel || "mistralai/Mistral-7B-Instruct-v0.3";
            const url = `https://api-inference.huggingface.co/models/${modelToUse}/v1/chat/completions`;
            const json = await withRetry(() => callOpenAICompatible(url, modelToUse, prompt, "Conseiller stratégique. JSON.", customApiKey, true));
            const p = JSON.parse(json);
            return p.suggestions || p;
        } catch (e) { console.warn("Hugging Face failed."); }
    }

    if (provider === 'openai' && customApiKey) {
        try {
            const modelToUse = customModel || "gpt-4o";
            const json = await callOpenAICompatible("https://api.openai.com/v1/chat/completions", modelToUse, prompt, "Conseiller stratégique. JSON.", customApiKey, true);
            const p = JSON.parse(json);
            return p.suggestions || p;
        } catch (e) { console.warn("OpenAI failed."); }
    }

    if (provider === 'groq') {
        try {
            const modelToUse = customModel || "llama-3.3-70b-versatile";
            const json = await callOpenAICompatible("https://api.groq.com/openai/v1/chat/completions", modelToUse, prompt, "Conseiller stratégique. JSON.", customApiKey || GROQ_API_KEY_ENV, true);
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
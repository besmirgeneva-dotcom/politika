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
                // UTILISATION DU MODÈLE STABLE 1.5 FLASH (Compatible toutes clés)
                model: "gemini-1.5-flash", 
                contents: prompt,
                config: config
            });
        }, 3, 2000);
    } catch (error) {
        console.warn("Primary model (Flash 1.5) failed. Switching to fallback...", error);
        try {
            return await withRetry(async () => {
                return await aiClient.models.generateContent({
                    // FALLBACK SUR FLASH-8B (Version légère et rapide)
                    model: "gemini-1.5-flash-8b",
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

// --- GENERIC OPENAI-COMPATIBLE HELPER (OpenAI, Groq) ---
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

const validateHFModel = (model: string | undefined): string => {
    if (!model) return "Qwen/Qwen2.5-72B-Instruct";
    const m = model.trim().toLowerCase();
    if (m === "hugging face" || m.includes(" ") || !m.includes("/")) {
        return "Qwen/Qwen2.5-72B-Instruct";
    }
    return model.trim();
};

const callHuggingFaceViaProxy = async (
    model: string,
    prompt: string,
    system: string,
    apiKey: string,
    jsonMode: boolean = true
): Promise<string> => {
    const endpoint = `https://api-inference.huggingface.co/models/${model}/v1/chat/completions`;
    let systemContent = system;
    if (jsonMode) {
         systemContent += "\n\nCRITIQUE: TU DOIS REPONDRE UNIQUEMENT AVEC UN JSON VALIDE. PAS DE MARKDOWN. SCHEMA OBLIGATOIRE:\n" + JSON.stringify(RESPONSE_SCHEMA_JSON);
    }

    const body = {
        messages: [
            { role: "system", content: systemContent },
            { role: "user", content: prompt }
        ],
        model: model,
        temperature: 0.75,
        max_tokens: 2048,
        response_format: jsonMode ? { type: "json_object" } : undefined
    };

    try {
        const response = await fetch('/api/proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                endpoint: endpoint,
                apiKey: apiKey,
                body: body
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`HF Proxy Error: ${response.status} - ${errText}`);
        }

        const data = await response.json();
        return data.choices[0]?.message?.content || "";
    } catch (e) {
        console.error("HF Proxy Call Failed:", e);
        throw e;
    }
};

// --- SIMULATION DU TOUR OPTIMISÉE ---
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
  customModel?: string,
  historySummary: string = "" // NOUVEAU: Résumé du passé
): Promise<SimulationResponse> => {
  
  // OPTIMISATION CONTEXTE: Si on a un résumé, on n'envoie que les 4 derniers événements + le résumé
  let historyContext = "";
  if (historySummary && recentHistory.length > 4) {
      const lastEvents = recentHistory.slice(-4).map(e => `[${e.date}] ${e.type.toUpperCase()}: ${e.headline}`).join('\n');
      historyContext = `RÉSUMÉ HISTORIQUE PRÉCÉDENT:\n${historySummary}\n\nÉVÉNEMENTS RÉCENTS (4 derniers tours):\n${lastEvents}`;
  } else {
      // Fallback: ancien comportement si pas de résumé (début de partie)
      historyContext = recentHistory.slice(-10).map(e => `[${e.date}] ${e.type.toUpperCase()}: ${e.headline}`).join('\n');
  }
  
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
    
    CONTEXTE HISTORIQUE:
    ${historyContext}

    TES MISSIONS POUR CE TOUR:
    1. **OBLIGATOIRE: Juger l'action du joueur**:
       - Tu DOIS inclure un événement de type "player" en première position.
       - Cet événement doit décrire le résultat de l'ordre "${playerAction}".
       - Si le joueur construit ou déploie des troupes, tu DOIS ajouter un élément dans "mapUpdates" avec type adapté (ex: troop_deployment).
       - Si le joueur retire ou supprime des unités, tu DOIS ajouter un élément dans "mapUpdates" avec type "remove_entity" et préciser le "label".
       - Si le joueur annexe un pays (surtout faible/allié), valide l'annexion via "mapUpdates" -> "annexation" si c'est plausible.
    
    2. **Simuler le Reste du Monde**: Génère ensuite des événements qui n'impliquent PAS le joueur.
    3. **Définir le Temps**: Choisis 'day' si urgence/guerre, 'month' si tensions, 'year' si calme.
    4. **Conséquences**: Mets à jour les stats (Tension, Économie, Corruption).
  `;

  // ... (Routing providers inchangé - Code abrégé pour lisibilité, le bloc reste le même que précedemment mais utilise le prompt optimisé)
  // --- HUGGING FACE ROUTING VIA PROXY ---
  if (provider === 'huggingface' && customApiKey) {
      try {
          const modelToUse = validateHFModel(customModel);
          const jsonStr = await withRetry(() => callHuggingFaceViaProxy(modelToUse, prompt, SYSTEM_INSTRUCTION, customApiKey, true));
          return JSON.parse(jsonStr) as SimulationResponse;
      } catch (error) { console.error("Hugging Face error", error); }
  }

  // --- OPENAI ROUTING ---
  if (provider === 'openai' && customApiKey) {
      try {
          const modelToUse = customModel || "gpt-4o";
          const jsonStr = await callOpenAICompatible("https://api.openai.com/v1/chat/completions", modelToUse, prompt, SYSTEM_INSTRUCTION, customApiKey, true);
          return JSON.parse(jsonStr) as SimulationResponse;
      } catch (error) { console.error("OpenAI error", error); }
  }

  // --- GROQ ROUTING ---
  if (provider === 'groq') {
      try {
          const keyToUse = customApiKey || GROQ_API_KEY_ENV;
          if (!keyToUse) throw new Error("Clé API Groq manquante.");
          const modelToUse = customModel || "llama-3.3-70b-versatile";
          const jsonStr = await callOpenAICompatible("https://api.groq.com/openai/v1/chat/completions", modelToUse, prompt, SYSTEM_INSTRUCTION, keyToUse, true);
          return JSON.parse(jsonStr) as SimulationResponse;
      } catch (error) { console.warn("Groq failed, fallback to Gemini.", error); }
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

// --- BATCH DIPLOMACY (1 Request for all targets) ---
export const sendBatchDiplomaticMessage = async (
    playerCountry: string,
    targets: string[],
    message: string,
    history: ChatMessage[],
    provider: string = 'gemini',
    customApiKey?: string,
    customModel?: string
): Promise<Record<string, string>> => {
    
    // Filtrer l'historique pertinent pour cette conversation de groupe
    const conversationContext = history
        .filter(msg => msg.targets.some(t => targets.includes(t)) || targets.includes(msg.senderName))
        .slice(-8)
        .map(msg => `${msg.sender === 'player' ? playerCountry : msg.senderName}: ${msg.text}`)
        .join('\n');

    const prompt = `
    JEU DE ROLE GEOPOLITIQUE.
    Le joueur (${playerCountry}) envoie ce message : "${message}"
    Destinataires : ${targets.join(', ')}.
    
    CONTEXTE DISCUSSION:
    ${conversationContext}
    
    MISSION:
    Génère la réponse de CHAQUE pays destinataire.
    - Réponds en tant que Chef d'État (bref, stratégique).
    - Si un pays n'a rien à dire ou n'est pas concerné, mets "NO_RESPONSE" comme valeur.
    
    FORMAT JSON ATTENDU (Clé = Pays, Valeur = Réponse):
    {
      "France": "Nous acceptons.",
      "Allemagne": "C'est inacceptable.",
      "Italie": "NO_RESPONSE"
    }
    `;

    const handleResponse = (jsonStr: string) => {
        try {
            return JSON.parse(jsonStr);
        } catch (e) {
            console.error("Batch JSON parse error", e);
            return {};
        }
    };

    // Routing simplifié pour le Batch
    let jsonResult = "";

    try {
        if (provider === 'huggingface' && customApiKey) {
            const modelToUse = validateHFModel(customModel);
            jsonResult = await withRetry(() => callHuggingFaceViaProxy(modelToUse, prompt, "Tu es un moteur de diplomatie. JSON uniquement.", customApiKey, true));
        } else if (provider === 'openai' && customApiKey) {
            const modelToUse = customModel || "gpt-4o";
            jsonResult = await callOpenAICompatible("https://api.openai.com/v1/chat/completions", modelToUse, prompt, "Tu es un moteur de diplomatie. JSON uniquement.", customApiKey, true);
        } else if (provider === 'groq') {
             const keyToUse = customApiKey || GROQ_API_KEY_ENV;
             if (!keyToUse) throw new Error("Groq key missing");
             const modelToUse = customModel || "llama-3.3-70b-versatile";
             jsonResult = await callOpenAICompatible("https://api.groq.com/openai/v1/chat/completions", modelToUse, prompt, "Tu es un moteur de diplomatie. JSON uniquement.", keyToUse, true);
        } else {
            // Gemini Default
            const schema: Schema = {
                type: Type.OBJECT,
                properties: targets.reduce((acc, t) => ({ ...acc, [t]: { type: Type.STRING } }), {})
            };
            const response = await generateRobustContent(prompt, {
                responseMimeType: "application/json",
                responseSchema: schema,
                temperature: 0.7
            }, customApiKey);
            jsonResult = response.text || "{}";
        }
        
        return handleResponse(jsonResult);

    } catch (e) {
        console.error("Batch Diplomacy Failed", e);
        return {};
    }
};

// --- GÉNÉRATION DE RÉSUMÉ HISTORIQUE ---
export const generateHistorySummary = async (
    playerCountry: string,
    fullHistory: GameEvent[],
    currentSummary: string,
    provider: string = 'gemini',
    customApiKey?: string,
    customModel?: string
): Promise<string> => {
    // On prend les 20 derniers événements ou tout si moins
    const recentEvents = fullHistory.slice(-20).map(e => `[${e.date}] ${e.headline}`).join('\n');
    
    const prompt = `
    Rôle: Archiviste Historique.
    Pays Joueur: ${playerCountry}.
    
    Ancien Résumé: "${currentSummary}"
    Nouveaux Événements:
    ${recentEvents}
    
    Mission: Mets à jour le résumé historique en intégrant les nouveaux événements.
    Le résumé final doit faire entre 3 et 6 phrases maximum.
    Concentre-toi sur les guerres, alliances majeures, et l'état économique global.
    Ignore les détails mineurs.
    `;
    
    try {
        if (provider === 'huggingface' && customApiKey) {
             const modelToUse = validateHFModel(customModel);
             return await withRetry(() => callHuggingFaceViaProxy(modelToUse, prompt, "Tu es un archiviste concis.", customApiKey, false));
        }
        if (provider === 'openai' && customApiKey) {
             const modelToUse = customModel || "gpt-4o";
             return await callOpenAICompatible("https://api.openai.com/v1/chat/completions", modelToUse, prompt, "Tu es un archiviste concis.", customApiKey, false);
        }
        if (provider === 'groq') {
             const keyToUse = customApiKey || GROQ_API_KEY_ENV;
             const modelToUse = customModel || "llama-3.3-70b-versatile";
             return await callOpenAICompatible("https://api.groq.com/openai/v1/chat/completions", modelToUse, prompt, "Tu es un archiviste concis.", keyToUse, false);
        }

        // Gemini
        const response = await generateRobustContent(prompt, { temperature: 0.5 }, customApiKey);
        return response.text || currentSummary;

    } catch (e) {
        console.error("Summary generation failed", e);
        return currentSummary; // On garde l'ancien en cas d'échec
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
    // Cette fonction reste pour la rétro-compatibilité ou appels unitaires, 
    // mais le Batch est maintenant préféré.
    return "DEPRECATED_USE_BATCH"; 
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

    // Hugging Face via Proxy
    if (provider === 'huggingface' && customApiKey) {
        try {
            const modelToUse = validateHFModel(customModel);
            const json = await withRetry(() => callHuggingFaceViaProxy(modelToUse, prompt, "Conseiller stratégique. JSON.", customApiKey, true));
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
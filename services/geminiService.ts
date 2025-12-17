import { GoogleGenAI, Schema, Type } from "@google/genai";
import { GameEvent, SimulationResponse, ChatMessage, ChaosLevel } from "../types";

// --- CONFIGURATION ---
const DEFAULT_API_KEY = process.env.API_KEY;
const GROQ_API_KEY_ENV = process.env.VITE_GROQ_API_KEY || "";

// Liste de priorité des modèles Gemini à tester automatiquement
// Le système essaiera le premier, puis passera au suivant en cas d'erreur.
const GEMINI_MODELS_PRIORITY = [
    "gemini-1.5-flash",        // 1. Standard actuel (Rapide & Efficace)
    "gemini-1.5-flash-latest", // 2. Alias vers la dernière version flash
    "gemini-1.5-pro",          // 3. Version plus intelligente (si la clé le permet)
    "gemini-pro",              // 4. Ancien standard (Compatibilité maximale)
    "gemini-1.0-pro"           // 5. Version legacy
];

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

// --- HELPER: ROBUST GEMINI GENERATION WITH MODEL CASCADE ---
// Cette fonction parcourt la liste des modèles jusqu'à ce qu'un fonctionne
const generateRobustContent = async (
    prompt: string, 
    config: any,
    apiKey?: string,
    specificModel?: string
): Promise<any> => {
    const aiClient = getAIClient(apiKey);
    let lastError: any = null;

    // CAS 1: Si un modèle spécifique est demandé (ex: configuration manuelle), on n'essaie que celui-là
    if (specificModel && specificModel.trim() !== "") {
         try {
            return await withRetry(async () => {
                return await aiClient.models.generateContent({
                    model: specificModel, 
                    contents: prompt,
                    config: config
                });
            }, 1, 1000);
         } catch (e) {
             throw e; // Pas de fallback si l'utilisateur a exigé un modèle précis
         }
    }

    // CAS 2: Mode Robustesse (Cascade)
    // On boucle sur la liste des modèles disponibles (flash -> pro -> legacy)
    for (const modelName of GEMINI_MODELS_PRIORITY) {
        try {
            return await withRetry(async () => {
                return await aiClient.models.generateContent({
                    model: modelName, 
                    contents: prompt,
                    config: config
                });
            }, 1, 1000); // 1 retry par modèle pour aller vite si 404
        } catch (error: any) {
            console.warn(`Model ${modelName} failed. Trying next...`, error.message);
            lastError = error;
            
            // Si c'est une erreur de clé API (401/403), inutile de continuer, ça plantera partout
            if (error?.status === 401 || error?.status === 403) {
                 throw error;
            }
            // Sinon (404 Not Found, 503 Overloaded...), on continue vers le prochain modèle de la liste
        }
    }

    console.error("All Gemini models failed.");
    throw lastError;
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

// --- SIMULATION DU TOUR ---
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
  historySummary: string = ""
): Promise<SimulationResponse> => {
  
  let historyContext = "";
  if (historySummary && recentHistory.length > 4) {
      const lastEvents = recentHistory.slice(-4).map(e => `[${e.date}] ${e.type.toUpperCase()}: ${e.headline}`).join('\n');
      historyContext = `RÉSUMÉ HISTORIQUE PRÉCÉDENT:\n${historySummary}\n\nÉVÉNEMENTS RÉCENTS (4 derniers tours):\n${lastEvents}`;
  } else {
      historyContext = recentHistory.slice(-10).map(e => `[${e.date}] ${e.type.toUpperCase()}: ${e.headline}`).join('\n');
  }
  
  let chaosInstruction = "";
  if (chaosLevel === 'peaceful') chaosInstruction = "MODE PACIFIQUE: Guerre interdite.";
  if (chaosLevel === 'high') chaosInstruction = "MODE TENSION: Crises fréquentes.";
  if (chaosLevel === 'chaos') chaosInstruction = "MODE CHAOS: Guerres, effondrements et catastrophes probables.";

  const prompt = `
    DATE ACTUELLE: ${currentDate}
    PAYS DU JOUEUR: ${playerCountry}
    TERRITOIRES CONTRÔLÉS: ${ownedTerritories.join(', ')}
    FORCES/BASES ACTUELLES: ${existingEntities.join(' | ')}
    CONTEXTE GÉO: ${isLandlocked ? "PAYS ENCLAVÉ (Pas de marine possible)" : "Accès à la mer"}
    NUCLÉAIRE: ${hasNuclear ? "OUI" : "NON"}
    
    DERNIERS MESSAGES DIPLOMATIQUES:
    ${diplomaticContext || "Aucun"}

    HISTORIQUE RÉCENT:
    ${historyContext}

    ${chaosInstruction}

    ORDRES DU JOUEUR (CE TOUR):
    "${playerAction}"

    TÂCHE:
    1. Analyse les ordres du joueur. S'ils sont valides, intègre-les dans le résultat (mapUpdates, events).
    2. Simule la réaction du reste du monde (IA) pour ce tour.
    3. Décide du saut temporel (day/month/year).
    4. Mets à jour les indicateurs (Tension, Éco, Militaire, Pop, Corruption).
    5. Génère des événements intéressants.
  `;

  let jsonString = "";

  if (provider === 'gemini') {
      const config = {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA_JSON,
          systemInstruction: SYSTEM_INSTRUCTION
      };
      // Utilisation de la fonction ROBUSTE qui essaie plusieurs modèles
      const response = await generateRobustContent(prompt, config, customApiKey, customModel);
      jsonString = response.text || "{}"; // Utilisation de .text property
  } else if (provider === 'groq') {
       const key = customApiKey || GROQ_API_KEY_ENV;
       const model = customModel || "llama-3.3-70b-versatile";
       jsonString = await callOpenAICompatible("https://api.groq.com/openai/v1/chat/completions", model, prompt, SYSTEM_INSTRUCTION, key);
  } else if (provider === 'openai') {
       const key = customApiKey || "";
       const model = customModel || "gpt-4o";
       jsonString = await callOpenAICompatible("https://api.openai.com/v1/chat/completions", model, prompt, SYSTEM_INSTRUCTION, key);
  } else if (provider === 'huggingface') {
       const key = customApiKey || "";
       const model = validateHFModel(customModel);
       jsonString = await callHuggingFaceViaProxy(model, prompt, SYSTEM_INSTRUCTION, key);
  } else if (provider === 'custom') {
       // Si "custom" est sélectionné sans provider spécifique détecté, on assume OpenAI compatible
       const key = customApiKey || "";
       // On essaie de deviner l'URL ou on utilise OpenAI par défaut si l'utilisateur met juste une clé
       // Ici pour simplifier on traite comme OpenAI générique si non spécifié ailleurs
       jsonString = await callOpenAICompatible("https://api.openai.com/v1/chat/completions", customModel || "gpt-3.5-turbo", prompt, SYSTEM_INSTRUCTION, key);
  }

  // Nettoyage Markdown
  const cleanJson = jsonString.replace(/```json/g, '').replace(/```/g, '').trim();
  
  try {
      return JSON.parse(cleanJson);
  } catch (e) {
      console.error("JSON Parse Error", e, cleanJson);
      // Fallback de sécurité
      return {
          timeIncrement: "day",
          events: [{ type: "world", headline: "Erreur de Communication", description: "Le rapport des services de renseignement est illisible." }],
          globalTensionChange: 0, economyHealthChange: 0, militaryPowerChange: 0, popularityChange: 0, corruptionChange: 0
      };
  }
};

// --- SUGGESTIONS STRATÉGIQUES ---
export const getStrategicSuggestions = async (
    country: string, 
    history: GameEvent[],
    provider: string = 'gemini',
    apiKey?: string,
    model?: string
): Promise<string[]> => {
    const prompt = `Le joueur dirige ${country}. Basé sur l'historique récent (guerre, crise, paix), propose 3 actions stratégiques courtes et pertinentes (ex: "Construire base", "Alliance avec X", "Envahir Y"). Réponds uniquement par une liste JSON de strings.`;
    
    const histText = history.slice(-5).map(e => e.headline).join("; ");
    const fullPrompt = `${prompt} Historique: ${histText}`;

    try {
        let text = "";
        
        if (provider === 'gemini') {
            const config = {
                responseMimeType: "application/json",
                responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } }
            };
            const response = await generateRobustContent(fullPrompt, config, apiKey, model);
            text = response.text || "[]";
        } else {
             // Fallback simple pour les autres providers (sans schema strict JSON mode parfois complexe)
             text = await callOpenAICompatible(
                 provider === 'groq' ? "https://api.groq.com/openai/v1/chat/completions" : "https://api.openai.com/v1/chat/completions",
                 model || (provider === 'groq' ? "llama-3.3-70b-versatile" : "gpt-3.5-turbo"),
                 fullPrompt, 
                 "Tu es un conseiller stratégique. Réponds en JSON Array de strings uniquement.", 
                 apiKey || (provider === 'groq' ? GROQ_API_KEY_ENV : "")
             );
        }

        const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(clean);
    } catch (e) {
        return ["Renforcer les défenses", "Améliorer l'économie", "Chercher des alliés"];
    }
};

// --- DIPLOMATIE DE GROUPE ---
export const sendBatchDiplomaticMessage = async (
    senderCountry: string,
    targetCountries: string[],
    message: string,
    chatHistory: ChatMessage[],
    provider: string = 'gemini',
    apiKey?: string,
    model?: string
): Promise<Record<string, string>> => {
    
    // Filtrer l'historique pertinent pour ces pays
    const relevantHistory = chatHistory.filter(msg => 
        msg.senderName === senderCountry || 
        targetCountries.includes(msg.senderName) ||
        msg.targets.some(t => targetCountries.includes(t))
    ).slice(-10);

    const contextStr = relevantHistory.map(m => `${m.sender === 'player' ? senderCountry : m.senderName}: "${m.text}"`).join('\n');

    const prompt = `
        Tu joues le rôle des pays suivants : ${targetCountries.join(', ')}.
        Le pays "${senderCountry}" vous envoie ce message : "${message}".
        
        CONTEXTE DIPLOMATIQUE RÉCENT:
        ${contextStr}

        TÂCHE:
        Pour CHAQUE pays cible, génère une réponse courte et diplomatiquement cohérente (1-2 phrases).
        Si un pays ne veut pas répondre, mets "NO_RESPONSE".
        
        FORMAT ATTENDU: JSON Object où les clés sont les noms des pays et les valeurs sont les réponses.
        Exemple: {"France": "Nous acceptons.", "Allemagne": "Jamais !"}
    `;

    try {
        let jsonStr = "";
        
        if (provider === 'gemini') {
            const config = { responseMimeType: "application/json" }; // Schema libre (Map)
            const response = await generateRobustContent(prompt, config, apiKey, model);
            jsonStr = response.text || "{}";
        } else {
             // Fallback
             jsonStr = await callOpenAICompatible(
                 provider === 'groq' ? "https://api.groq.com/openai/v1/chat/completions" : "https://api.openai.com/v1/chat/completions",
                 model || (provider === 'groq' ? "llama-3.3-70b-versatile" : "gpt-3.5-turbo"),
                 prompt, 
                 "Tu es un moteur diplomatique. Réponds en JSON uniquement.", 
                 apiKey || (provider === 'groq' ? GROQ_API_KEY_ENV : "")
             );
        }

        const clean = jsonStr.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(clean);
    } catch (e) {
        console.error("Diplomacy Error", e);
        return {};
    }
};

// --- RÉSUMÉ HISTORIQUE ---
export const generateHistorySummary = async (
    country: string,
    historyEvents: GameEvent[],
    currentSummary: string,
    provider: string = 'gemini',
    apiKey?: string,
    model?: string
): Promise<string> => {
    if (historyEvents.length === 0) return currentSummary;

    const newEventsText = historyEvents.map(e => `[${e.date}] ${e.type}: ${e.headline}`).join('\n');
    const prompt = `
        Voici le résumé actuel de l'histoire du monde (point de vue ${country}):
        "${currentSummary}"

        Voici les nouveaux événements survenus récemment:
        ${newEventsText}

        TÂCHE:
        Fusionne ces informations pour créer un nouveau résumé concis (max 100 mots) qui capture l'état actuel du monde et les événements majeurs passés. Ce résumé servira de mémoire à long terme pour la simulation.
    `;

    try {
        if (provider === 'gemini') {
             const response = await generateRobustContent(prompt, {}, apiKey, model);
             return response.text || currentSummary;
        } else {
             return await callOpenAICompatible(
                 provider === 'groq' ? "https://api.groq.com/openai/v1/chat/completions" : "https://api.openai.com/v1/chat/completions",
                 model || (provider === 'groq' ? "llama-3.3-70b-versatile" : "gpt-3.5-turbo"),
                 prompt, 
                 "Tu es un historien synthétique.", 
                 apiKey || (provider === 'groq' ? GROQ_API_KEY_ENV : ""),
                 false // Pas de JSON mode
             );
        }
    } catch (e) {
        return currentSummary + " ...";
    }
};

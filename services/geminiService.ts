import { GoogleGenAI, Type } from "@google/genai";
import { GameEvent, SimulationResponse, ChatMessage, ChaosLevel } from "../types";

// --- CONFIGURATION ---
const DEFAULT_API_KEY = process.env.API_KEY;

// Instance globale par défaut (Stabilité)
const defaultAi = new GoogleGenAI({ apiKey: DEFAULT_API_KEY });

// Clé de secours Groq (Doit être dans le .env ou entrée par l'utilisateur)
const GROQ_API_KEY_ENV = process.env.VITE_GROQ_API_KEY || "";

export type AIProvider = 'gemini' | 'groq' | 'openai' | 'huggingface' | 'custom';

// Helper pour obtenir l'instance Gemini (Custom ou Défaut)
const getAIClient = (customKey?: string) => {
    if (customKey && customKey.trim() !== "") {
        return new GoogleGenAI({ apiKey: customKey });
    }
    return defaultAi;
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
        
        if (error?.status === 429 || errMsg.includes("429") || errMsg.toLowerCase().includes("quota")) isRateLimit = true;
        if (error?.status === 503 || errMsg.includes("503") || errMsg.toLowerCase().includes("overloaded")) isServerOverload = true;

        if (retries > 0 && (isRateLimit || isServerOverload)) {
            console.warn(`API Busy. Retrying in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
            return withRetry(fn, retries - 1, delay * 2);
        }
        throw error;
    }
};

// --- HELPER: SIMPLIFIED GEMINI GENERATION ---
const generateRobustContent = async (
    prompt: string, 
    config: any,
    apiKey?: string,
    specificModel?: string
): Promise<any> => {
    const aiClient = getAIClient(apiKey);
    
<<<<<<< HEAD
    // MISE À JOUR : Utilisation de gemini-3-flash-preview (Standard Or)
    const modelName = (specificModel && specificModel.trim() !== "") ? specificModel : "gemini-3-flash-preview";
=======
    // MISE À JOUR : Utilisation de gemini-2.5-flash par défaut (1.5 est déprécié)
    const modelName = (specificModel && specificModel.trim() !== "") ? specificModel : "gemini-2.5-flash";
>>>>>>> a04885da5dfee789ee0824969a7e7dd0d764f34f

    try {
        return await withRetry(async () => {
            return await aiClient.models.generateContent({
                model: modelName, 
                contents: prompt,
                config: config
            });
        });
    } catch (error: any) {
        console.error(`Gemini Error on model ${modelName}:`, error);
        throw error;
    }
};

const SYSTEM_INSTRUCTION = `
ROLE: Moteur de Réalité GeoSim.
<<<<<<< HEAD
OBJECTIF: Simuler un monde vivant et cohérent.
RÈGLES:
1. PRIORITÉ JOUEUR: Traite "playerAction" en priorité absolue.
2. GÉOGRAPHIE: Si pas de ville précise, utilise lat:0, lng:0 (Centre pays).
3. OFFENSIVE: Autorise les annexions si le rapport de force est réaliste.
=======
OBJECTIF: Simuler un monde vivant.
RÈGLES:
1. PRIORITÉ JOUEUR: Traite "playerAction" en priorité.
2. GÉOGRAPHIE: Si pas de ville précise, utilise lat:0, lng:0 (Centre pays).
3. OFFENSIVE: Autorise les annexions si le rapport de force est bon.
>>>>>>> a04885da5dfee789ee0824969a7e7dd0d764f34f
4. RETRAIT: Utilise 'remove_entity' pour supprimer des troupes.
Format: JSON UNIQUEMENT.
`;

const RESPONSE_SCHEMA_JSON = {
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

// --- GENERIC OPENAI-COMPATIBLE HELPER ---
const callOpenAICompatible = async (url: string, model: string, prompt: string, system: string, apiKey: string, jsonMode: boolean = true): Promise<string> => {
    try {
        let systemContent = system;
        if (jsonMode) systemContent += "\n\nREPONDRE EN JSON VALIDE UNIQUEMENT. SCHEMA:\n" + JSON.stringify(RESPONSE_SCHEMA_JSON);

        const response = await fetch(url, {
            method: "POST",
            headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                messages: [{ role: "system", content: systemContent }, { role: "user", content: prompt }],
                model: model, temperature: 0.75, max_tokens: 2048,
                response_format: jsonMode ? { type: "json_object" } : undefined
            })
        });

        if (!response.ok) throw new Error(`API Error ${response.status}`);
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
    if (m === "hugging face" || m.includes(" ") || !m.includes("/")) return "Qwen/Qwen2.5-72B-Instruct";
    return model.trim();
};

const callHuggingFaceViaProxy = async (model: string, prompt: string, system: string, apiKey: string, jsonMode: boolean = true): Promise<string> => {
    const endpoint = `https://api-inference.huggingface.co/models/${model}/v1/chat/completions`;
    let systemContent = system;
    if (jsonMode) systemContent += "\n\nREPONDRE EN JSON VALIDE UNIQUEMENT. SCHEMA:\n" + JSON.stringify(RESPONSE_SCHEMA_JSON);

    try {
        const response = await fetch('/api/proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: endpoint, apiKey: apiKey, body: {
                messages: [{ role: "system", content: systemContent }, { role: "user", content: prompt }],
                model: model, temperature: 0.75, max_tokens: 2048, response_format: jsonMode ? { type: "json_object" } : undefined
            }})
        });
        if (!response.ok) throw new Error(`HF Proxy Error: ${response.status}`);
        const data = await response.json();
        return data.choices[0]?.message?.content || "";
    } catch (e) { throw e; }
};

// --- SIMULATION DU TOUR (SÉCURISÉE) ---
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
  
<<<<<<< HEAD
=======
  // FIX: TRY/CATCH GLOBAL pour empêcher le jeu de bloquer si l'IA échoue totalement
>>>>>>> a04885da5dfee789ee0824969a7e7dd0d764f34f
  try {
      let historyContext = "";
      if (historySummary && recentHistory.length > 4) {
          const lastEvents = recentHistory.slice(-4).map(e => `[${e.date}] ${e.type}: ${e.headline}`).join('\n');
          historyContext = `RÉSUMÉ HISTORIQUE:\n${historySummary}\n\nRÉCENT:\n${lastEvents}`;
      } else {
          historyContext = recentHistory.slice(-10).map(e => `[${e.date}] ${e.type}: ${e.headline}`).join('\n');
      }
      
      let chaosInstruction = "";
<<<<<<< HEAD
      if (chaosLevel === 'peaceful') chaosInstruction = "MODE PACIFIQUE: Guerre interdite. Focus sur diplomatie et économie.";
      if (chaosLevel === 'high') chaosInstruction = "MODE TENSION: Instabilité politique et crises fréquentes.";
      if (chaosLevel === 'chaos') chaosInstruction = "MODE CHAOS: Risque majeur de guerre mondiale et catastrophes.";

      const prompt = `
        DATE ACTUELLE: ${currentDate}
        PAYS DU JOUEUR: ${playerCountry}
        GÉOGRAPHIE: ${isLandlocked ? "Enclavé (pas d'accès mer)" : "Accès maritime disponible"}
        TERRITOIRES SOUS CONTRÔLE: ${ownedTerritories.join(', ')}
        FORCES DÉPLOYÉES: ${existingEntities.join(' | ')}
        DISSUASION NUCLÉAIRE: ${hasNuclear ? "OUI" : "NON"}
        CONTEXTE DIPLOMATIQUE: ${diplomaticContext || "Neutre"}
        CONTEXTE HISTORIQUE: ${historyContext}
        DIRECTIVE SPÉCIALE: ${chaosInstruction}
        ORDRES DU JOUEUR POUR CE TOUR: "${playerAction}"
        TÂCHE: Simuler le tour suivant. Réagir aux ordres du joueur. Faire évoluer le monde. Générer JSON valide.
=======
      if (chaosLevel === 'peaceful') chaosInstruction = "MODE PACIFIQUE: Guerre interdite.";
      if (chaosLevel === 'high') chaosInstruction = "MODE TENSION: Crises fréquentes.";
      if (chaosLevel === 'chaos') chaosInstruction = "MODE CHAOS: Guerres et catastrophes probables.";

      const prompt = `
        DATE: ${currentDate}
        PAYS JOUEUR: ${playerCountry}
        ACCÈS MER: ${isLandlocked ? "NON (Enclavé)" : "OUI"}
        POSSESSIONS: ${ownedTerritories.join(', ')}
        FORCES: ${existingEntities.join(' | ')}
        NUCLÉAIRE: ${hasNuclear ? "OUI" : "NON"}
        DIPLOMATIE: ${diplomaticContext || "Aucune"}
        HISTORIQUE: ${historyContext}
        ${chaosInstruction}
        ORDRES: "${playerAction}"
        TÂCHE: Simuler le tour. Réagir aux ordres. Générer JSON.
>>>>>>> a04885da5dfee789ee0824969a7e7dd0d764f34f
      `;

      let jsonString = "";

      if (provider === 'gemini') {
          const config = {
              responseMimeType: "application/json",
              responseSchema: RESPONSE_SCHEMA_JSON,
              systemInstruction: SYSTEM_INSTRUCTION
          };
          const response = await generateRobustContent(prompt, config, customApiKey, customModel);
          jsonString = response.text || "{}";
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
           const key = customApiKey || "";
           jsonString = await callOpenAICompatible("https://api.openai.com/v1/chat/completions", customModel || "gpt-3.5-turbo", prompt, SYSTEM_INSTRUCTION, key);
      }

      const cleanJson = jsonString.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(cleanJson);

  } catch (e: any) {
      console.error("CRITICAL SIMULATION ERROR:", e);
<<<<<<< HEAD
=======
      // FALLBACK DE SÉCURITÉ POUR DÉBLOQUER LE JEU
>>>>>>> a04885da5dfee789ee0824969a7e7dd0d764f34f
      return {
          timeIncrement: "day",
          events: [{ 
              type: "world", 
<<<<<<< HEAD
              headline: "Incident de Communication", 
              description: `Le réseau de renseignement est temporairement indisponible. Le tour a progressé mais aucun rapport détaillé n'a pu être établi.` 
=======
              headline: "Interruption des Communications", 
              description: `Une panne des systèmes de renseignement empêche la réception des rapports. Le tour a passé. (Erreur: ${e.message || "Inconnue"})` 
>>>>>>> a04885da5dfee789ee0824969a7e7dd0d764f34f
          }],
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
    try {
<<<<<<< HEAD
        const prompt = `Pays: ${country}. Derniers événements: ${history.slice(-3).map(e=>e.headline).join(';')}. Propose 3 actions stratégiques courtes et variées (économique, militaire, diplomatique). Format: JSON array strings.`;
=======
        const prompt = `Joueur: ${country}. Historique: ${history.slice(-3).map(e=>e.headline).join(';')}. Propose 3 actions courtes JSON array strings.`;
>>>>>>> a04885da5dfee789ee0824969a7e7dd0d764f34f
        let text = "";
        
        if (provider === 'gemini') {
            const config = { responseMimeType: "application/json", responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } } };
            const response = await generateRobustContent(prompt, config, apiKey, model);
            text = response.text || "[]";
        } else {
             text = await callOpenAICompatible(
                 provider === 'groq' ? "https://api.groq.com/openai/v1/chat/completions" : "https://api.openai.com/v1/chat/completions",
                 model || (provider === 'groq' ? "llama-3.3-70b-versatile" : "gpt-3.5-turbo"),
<<<<<<< HEAD
                 prompt, "Conseiller stratégique. Répond uniquement par un tableau JSON.", apiKey || (provider === 'groq' ? GROQ_API_KEY_ENV : "")
=======
                 prompt, "Conseiller. JSON Array only.", apiKey || (provider === 'groq' ? GROQ_API_KEY_ENV : "")
>>>>>>> a04885da5dfee789ee0824969a7e7dd0d764f34f
             );
        }
        return JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim());
    } catch (e) {
<<<<<<< HEAD
        return ["Investir dans les infrastructures", "Lancer un programme spatial", "Négocier un pacte commercial"];
=======
        return ["Renforcer les défenses", "Développer l'économie", "Chercher des alliés"];
>>>>>>> a04885da5dfee789ee0824969a7e7dd0d764f34f
    }
};

// --- DIPLOMATIE ---
export const sendBatchDiplomaticMessage = async (
    senderCountry: string,
    targetCountries: string[],
    message: string,
    chatHistory: ChatMessage[],
    provider: string = 'gemini',
    apiKey?: string,
    model?: string
): Promise<Record<string, string>> => {
    try {
<<<<<<< HEAD
        const prompt = `Destinataires: ${targetCountries.join(', ')}. Message de ${senderCountry}: "${message}". Réponds individuellement pour chaque pays selon sa personnalité géopolitique. Format JSON: { "NomPays": "Réponse" }. Si un pays ne souhaite pas répondre, utilise "NO_RESPONSE".`;
=======
        const prompt = `Pays: ${targetCountries.join(', ')}. Message de ${senderCountry}: "${message}". Réponds pour chaque pays en JSON (Key=Pays, Value=Réponse). Si refus de répondre, value="NO_RESPONSE".`;
>>>>>>> a04885da5dfee789ee0824969a7e7dd0d764f34f
        let jsonStr = "";
        
        if (provider === 'gemini') {
            const config = { responseMimeType: "application/json" };
            const response = await generateRobustContent(prompt, config, apiKey, model);
            jsonStr = response.text || "{}";
        } else {
             jsonStr = await callOpenAICompatible(
                 provider === 'groq' ? "https://api.groq.com/openai/v1/chat/completions" : "https://api.openai.com/v1/chat/completions",
                 model || (provider === 'groq' ? "llama-3.3-70b-versatile" : "gpt-3.5-turbo"),
<<<<<<< HEAD
                 prompt, "Corps Diplomatique Mondial. JSON pur uniquement.", apiKey || (provider === 'groq' ? GROQ_API_KEY_ENV : "")
=======
                 prompt, "Diplomate. JSON only.", apiKey || (provider === 'groq' ? GROQ_API_KEY_ENV : "")
>>>>>>> a04885da5dfee789ee0824969a7e7dd0d764f34f
             );
        }
        return JSON.parse(jsonStr.replace(/```json/g, '').replace(/```/g, '').trim());
    } catch (e) {
        return {};
    }
};

// --- RÉSUMÉ ---
export const generateHistorySummary = async (
    country: string,
    historyEvents: GameEvent[],
    currentSummary: string,
    provider: string = 'gemini',
    apiKey?: string,
    model?: string
): Promise<string> => {
    try {
        if (historyEvents.length === 0) return currentSummary;
<<<<<<< HEAD
        const prompt = `Résumé existant: "${currentSummary}". Nouveaux faits: ${historyEvents.map(e=>e.headline).join(';')}. Synthétise l'histoire globale de ${country} en restant sous les 100 mots.`;
=======
        const prompt = `Resumés: "${currentSummary}". Nouveaux: ${historyEvents.map(e=>e.headline).join(';')}. Synthétise en 100 mots max pour ${country}.`;
>>>>>>> a04885da5dfee789ee0824969a7e7dd0d764f34f
        if (provider === 'gemini') {
             const response = await generateRobustContent(prompt, {}, apiKey, model);
             return response.text || currentSummary;
        } else {
             return await callOpenAICompatible(
                 provider === 'groq' ? "https://api.groq.com/openai/v1/chat/completions" : "https://api.openai.com/v1/chat/completions",
                 model || (provider === 'groq' ? "llama-3.3-70b-versatile" : "gpt-3.5-turbo"),
<<<<<<< HEAD
                 prompt, "Archiviste National.", apiKey || (provider === 'groq' ? GROQ_API_KEY_ENV : ""), false
=======
                 prompt, "Historien.", apiKey || (provider === 'groq' ? GROQ_API_KEY_ENV : ""), false
>>>>>>> a04885da5dfee789ee0824969a7e7dd0d764f34f
             );
        }
    } catch (e) { return currentSummary; }
};
import { GoogleGenAI, Type } from "@google/genai";
import { GameEvent, SimulationResponse, ChatMessage, ChaosLevel } from "../types";

const DEFAULT_API_KEY = process.env.API_KEY;
const defaultAi = new GoogleGenAI({ apiKey: DEFAULT_API_KEY });
const GROQ_API_KEY_ENV = process.env.VITE_GROQ_API_KEY || "";

export type AIProvider = 'gemini' | 'groq' | 'openai' | 'huggingface' | 'custom';

const getAIClient = (customKey?: string) => {
    if (customKey && customKey.trim() !== "") {
        return new GoogleGenAI({ apiKey: customKey });
    }
    return defaultAi;
};

const withRetry = async <T>(fn: () => Promise<T>, retries = 3, delay = 2000): Promise<T> => {
    try {
        return await fn();
    } catch (error: any) {
        let isRateLimit = false;
        let isServerOverload = false;
        const errMsg = error?.message || "";
        if (error?.status === 429 || errMsg.includes("429")) isRateLimit = true;
        if (error?.status === 503 || errMsg.includes("503")) isServerOverload = true;

        if (retries > 0 && (isRateLimit || isServerOverload)) {
            await new Promise(r => setTimeout(r, delay));
            return withRetry(fn, retries - 1, delay * 2);
        }
        throw error;
    }
};

const generateRobustContent = async (
    prompt: string, 
    config: any,
    apiKey?: string,
    specificModel?: string
): Promise<any> => {
    const aiClient = getAIClient(apiKey);
    const modelName = (specificModel && specificModel.trim() !== "") ? specificModel : "gemini-3-flash-preview";
    return await withRetry(async () => {
        return await aiClient.models.generateContent({
            model: modelName, 
            contents: prompt,
            config: config
        });
    });
};

const SYSTEM_INSTRUCTION = `ROLE: Moteur GeoSim. Format: JSON UNIQUEMENT.`;

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

const callOpenAICompatible = async (url: string, model: string, prompt: string, system: string, apiKey: string, jsonMode: boolean = true): Promise<string> => {
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                messages: [{ role: "system", content: system + (jsonMode ? " JSON format required." : "") }, { role: "user", content: prompt }],
                model: model, temperature: 0.7,
                response_format: jsonMode ? { type: "json_object" } : undefined
            })
        });
        const data = await response.json();
        return data.choices[0]?.message?.content || "";
    } catch (e) { throw e; }
};

export const simulateTurn = async (
  playerCountry: string, currentDate: string, playerAction: string, recentHistory: GameEvent[],
  ownedTerritories: string[] = [], existingEntities: string[] = [], isLandlocked: boolean = false,
  hasNuclear: boolean = false, diplomaticContext: string = "", chaosLevel: ChaosLevel = 'normal',
  provider: string = 'gemini', customApiKey?: string, customModel?: string, historySummary: string = ""
): Promise<SimulationResponse> => {
  try {
      const prompt = `DATE: ${currentDate}. PAYS: ${playerCountry}. ORDRES: "${playerAction}".`;
      let jsonString = "";
      if (provider === 'gemini') {
          const response = await generateRobustContent(prompt, { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA_JSON, systemInstruction: SYSTEM_INSTRUCTION }, customApiKey, customModel);
          jsonString = response.text || "{}";
      } else {
          const key = customApiKey || (provider === 'groq' ? GROQ_API_KEY_ENV : "");
          const url = provider === 'groq' ? "https://api.groq.com/openai/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
          jsonString = await callOpenAICompatible(url, customModel || "gpt-3.5-turbo", prompt, SYSTEM_INSTRUCTION, key);
      }
      return JSON.parse(jsonString.replace(/```json/g, '').replace(/```/g, '').trim());
  } catch (e: any) {
      return { timeIncrement: "day", events: [{ type: "world", headline: "Rapport partiel", description: "Problème de synchronisation satellite." }], globalTensionChange: 0, economyHealthChange: 0, militaryPowerChange: 0, popularityChange: 0, corruptionChange: 0 };
  }
};

export const getStrategicSuggestions = async (country: string, history: GameEvent[], provider: string = 'gemini', apiKey?: string, model?: string): Promise<string[]> => {
    try {
        const prompt = `Propose 3 actions pour ${country}.`;
        let text = "";
        if (provider === 'gemini') {
            const response = await generateRobustContent(prompt, { responseMimeType: "application/json", responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } } }, apiKey, model);
            text = response.text || "[]";
        }
        return JSON.parse(text);
    } catch (e) { return ["Développement", "Défense", "Diplomatie"]; }
};

export const sendBatchDiplomaticMessage = async (sender: string, targets: string[], message: string, history: ChatMessage[], provider: string = 'gemini', apiKey?: string, model?: string): Promise<Record<string, string>> => {
    try {
        const prompt = `${sender} dit: "${message}" à ${targets.join(', ')}.`;
        const response = await generateRobustContent(prompt, { responseMimeType: "application/json" }, apiKey, model);
        return JSON.parse(response.text || "{}");
    } catch (e) { return {}; }
};

export const generateHistorySummary = async (country: string, events: GameEvent[], current: string, provider: string = 'gemini', apiKey?: string, model?: string): Promise<string> => {
    try {
        const response = await generateRobustContent(`Résumé pour ${country}: ${events.map(e=>e.headline).join(',')}`, {}, apiKey, model);
        return response.text || current;
    } catch (e) { return current; }
};

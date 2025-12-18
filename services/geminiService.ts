
import { GoogleGenAI, Schema, Type } from "@google/genai";
import { GameEvent, SimulationResponse, ChatMessage, ChaosLevel, Alliance } from "../types";

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

// --- INSTRUCTIONS UNIFIÉES ET SIMPLIFIÉES (ARCADE) ---
const SYSTEM_INSTRUCTION = `
ROLE: Tu es le "Moteur de Réalité" de GeoSim, une simulation géopolitique orientée action/stratégie.

RÈGLES DE COMPORTEMENT (MODIFIÉES "ARCADE") :
1. **GAMEPLAY AVANT RÉALISME** : Si le joueur demande une construction (usine, port, base), **ACCORDE-LA**. Ne cherche pas de prétextes complexes ("manque de fonderies", "problèmes de main d'œuvre"). Si le joueur a le budget (implicite), ça se construit.
2. **PUISSANCE CLAIRE** : Si une nation puissante (Militaire > 60) attaque une faible, elle GAGNE rapidement. Pas de guerres d'usure inutiles contre des petits pays.
3. **SIMPLIFICATION CARTE (CRITIQUE)** :
   - Il n'y a que 2 types de bâtiments sur la carte :
     A) 'build_base' : Représente TOUT ce qui est offensif ou logistique (Base militaire, Usine, Aéroport, Port).
     B) 'build_defense' : Représente la défense (Radar, Batterie missiles, Bunker).
   - Si le joueur demande une "Usine d'avions", génère un 'build_base' avec le label "Usine Aéro".
   - PRÉCISION : Coordonnées STRICTEMENT à l'intérieur des frontières du pays concerné.
   - SUPPRESSION : Utilise 'remove_entity'.
4. **MESSAGERIE** : Silence diplomatique par défaut. Seulement des messages vitaux des Alliés ou des Superpuissances.
5. **STYLE** : Rapports de renseignement concis (AFP, Reuters).

RÉSUMÉ : SOIS PERMISSIF SUR LA CONSTRUCTION, MAIS STRATÉGIQUE SUR LES CONSÉQUENCES DIPLOMATIQUES.
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
                type: { type: "string", enum: ['annexation', 'build_base', 'build_defense', 'remove_entity'] },
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
  entitiesSummary: string = "", // CHANGEMENT: Reçoit une string résumée au lieu d'un tableau
  isLandlocked: boolean = false,
  hasNuclear: boolean = false,
  diplomaticContext: string = "",
  chaosLevel: ChaosLevel = 'normal',
  provider: AIProvider = 'gemini',
  playerPower: number = 50,
  alliance: Alliance | null = null
): Promise<SimulationResponse> => {
  
  // STRATEGIE 3 : COMPRESSION HISTORIQUE
  // On ne garde que les dates et les titres, on supprime les descriptions
  const historyContext = recentHistory.slice(-15).map(e => `[${e.date}] ${e.type.toUpperCase()}: ${e.headline}`).join('\n');
  
  const allianceContext = alliance ? `MEMBRE DE: ${alliance.name} (Leader: ${alliance.leader}). ALLIÉS: ${alliance.members.join(', ')}` : "NON-ALIGNÉ";
  
  const prompt = `
    --- ETAT DE LA SIMULATION ---
    DATE: ${currentDate}
    PAYS JOUEUR: ${playerCountry} (Puissance Militaire: ${playerPower}/100)
    POSSESSIONS: ${ownedTerritories.join(', ')}
    CHAOS: ${chaosLevel}
    ALLIANCE: ${allianceContext}
    
    ACTION DU JOUEUR (A TRAITER): "${playerAction || "Maintien de l'ordre."}"
    
    HISTORIQUE RECENT (Titres uniquement):
    ${historyContext}

    INSTALLATIONS ACTUELLES (Résumé): 
    ${entitiesSummary || "Aucune infrastructure majeure."}

    DIPLOMATIE ACTUELLE: ${diplomaticContext}

    CONSIGNES DE SIMULATION :
    1. Si le joueur demande une construction, sois permissif. Convertis usines/ports en 'build_base'.
    2. Respecte les types d'entités limités : 'build_base' (tout complexe militaire/indus) ou 'build_defense' (défensif).
    3. COORDONNÉES: STRICTEMENT dans le pays cible.
    4. MESSAGES: TRES RAREMENT. Seulement si CRITIQUE.
    5. Produis au moins 2 événements majeurs.
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

// --- NOUVEAU: BATCHING POUR LE CHAT DIPLOMATIQUE ---
export const sendDiplomaticMessage = async (
    playerCountry: string,
    targets: string[], // On reçoit maintenant un tableau
    message: string,
    history: ChatMessage[],
    context: { 
        militaryPower: number; 
        economyHealth: number; 
        globalTension: number; 
        hasNuclear: boolean; 
        playerAllies: string[]; // Ajout de la liste des alliés pour la logique d'annexion
    },
    provider: AIProvider = 'gemini'
): Promise<{ sender: string, text: string }[]> => { // Retourne un tableau de réponses
    
    // Compression du contexte de conversation (Derniers messages pertinents)
    const conversationContext = history
        .filter(msg => targets.includes(msg.senderName) || (msg.sender === 'player' && msg.targets.some(t => targets.includes(t))))
        .slice(-6)
        .map(msg => `${msg.sender === 'player' ? playerCountry : msg.senderName}: ${msg.text}`)
        .join('\n');

    const prompt = `
    Tu incarnes les dirigeants de ces pays : ${targets.join(', ')}.
    
    CONTEXTE :
    - Expéditeur : ${playerCountry} (Puissance: ${context.militaryPower}/100, Nucléaire: ${context.hasNuclear ? "OUI" : "NON"}).
    - Tes Alliés : ${context.playerAllies.join(', ')}.
    - Historique Conversation : 
    ${conversationContext}
    
    MESSAGE REÇU : "${message}"

    CONSIGNES DE RÉPONSE :
    1. Chaque pays ciblé doit décider s'il répond ou reste silencieux (pour éviter le spam).
    2. Si le message ne concerne pas directement un pays ou n'est pas intéressant, NE RÉPONDS PAS pour ce pays.
    
    RÈGLE SPÉCIALE ANNEXION (CRITIQUE) :
    - Si le joueur demande l'annexion ("annexation", "rejoindre", "fusionner") à un pays qui est son ALLIÉ et qui est plus FAIBLE :
      NE REFUSE PAS DIRECTEMENT. Montre de l'intérêt mais EXIGE des conditions : "Quelles garanties pour notre peuple ?", "Nous voulons préserver notre culture", "Quel statut aurons-nous ?".
    - Si le pays n'est PAS allié ou est PUISSANT : Refuse fermement ("Jamais !", "C'est une déclaration de guerre ?").

    FORMAT DE SORTIE JSON UNIQUEMENT :
    [
      { "sender": "NomDuPays", "text": "Sa réponse..." },
      ...
    ]
    Si personne ne répond, renvoie [].
    `;

    const CHAT_SCHEMA = {
        type: "array",
        items: {
            type: "object",
            properties: {
                sender: { type: "string" },
                text: { type: "string" }
            },
            required: ["sender", "text"]
        }
    };

    if (provider === 'groq' && GROQ_API_KEY) {
        try {
            const jsonStr = await callGroq(prompt, "Tu es un collectif de chefs d'états. JSON Only.", true, CHAT_SCHEMA);
            return JSON.parse(jsonStr);
        } catch (e) { console.warn("Groq failed, fallback to Gemini."); }
    }
    
    try {
        const response = await generateRobustContent(prompt, { 
            responseMimeType: "application/json",
            responseSchema: CHAT_SCHEMA as any,
            temperature: 0.7 
        });
        return JSON.parse(response.text) || [];
    } catch (e) { 
        return [{ sender: targets[0], text: "Transmission reçue. Analyse en cours." }]; 
    }
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
    // Compression historique ici aussi
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

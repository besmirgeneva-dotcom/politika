
export interface GameEvent {
  id: string;
  date: string;
  type: 'player' | 'world' | 'crisis' | 'economy' | 'war' | 'alliance';
  headline: string;
  description: string;
  relatedCountry?: string; // Pour centrer la caméra
}

// Types restreints pour nettoyer la map et simplifier le jeu
export type MapEntityType = 'military_base' | 'defense_system';

export interface MapEntity {
  id: string;
  type: MapEntityType;
  country: string;
  lat: number;
  lng: number;
  label?: string; 
}

export interface ChatMessage {
  id: string;
  sender: 'player' | 'ai';
  senderName: string;
  targets: string[];
  text: string;
  timestamp: number;
  isRead?: boolean; // Indicateur de lecture
}

export type ChaosLevel = 'peaceful' | 'normal' | 'high' | 'chaos';

export interface Alliance {
  name: string;
  type: string; // Ex: "Militaire", "Économique", "Totale"
  members: string[];
  leader: string;
}

export interface GameState {
  gameId: string;
  currentDate: Date;
  playerCountry: string | null;
  ownedTerritories: string[];
  mapEntities: MapEntity[];
  infrastructure: Record<string, Record<string, number>>; 
  worldSummary: string; // NOUVEAU: Pour la compression du contexte
  strategicSuggestions: string[]; // NOUVEAU: Pour éviter l'appel API séparé
  turn: number;
  events: GameEvent[];
  isProcessing: boolean;
  globalTension: number;
  economyHealth: number;
  militaryPower: number;
  popularity: number;
  corruption: number;
  hasNuclear: boolean;
  hasSpaceProgram: boolean;
  militaryRank: number;
  chatHistory: ChatMessage[];
  chaosLevel: ChaosLevel;
  alliance: Alliance | null;
  isGameOver: boolean;
  gameOverReason: string | null;
}

export interface SimulationResponse {
  timeIncrement: 'day' | 'month' | 'year';
  worldSummary: string; // NOUVEAU: L'IA résume la situation actuelle
  strategicSuggestions: string[]; // NOUVEAU: Suggestions pour le tour suivant
  events: {
    type: 'world' | 'crisis' | 'economy' | 'war' | 'alliance';
    headline: string;
    description: string;
    relatedCountry?: string;
  }[];
  globalTensionChange: number;
  economyHealthChange: number;
  militaryPowerChange: number;
  popularityChange: number;
  corruptionChange: number;
  spaceProgramActive?: boolean;
  mapUpdates?: {
    type: 'annexation' | 'build_base' | 'build_defense' | 'remove_entity';
    targetCountry: string;
    newOwner?: string;
    lat?: number;
    lng?: number;
    label?: string;
    entityId?: string;
  }[];
  infrastructureUpdates?: {
      country: string;
      type: string;
      change: number;
  }[];
  incomingMessages?: {
      sender: string;
      text: string;
      targets: string[];
  }[];
  allianceUpdate?: {
    action: 'create' | 'update' | 'dissolve';
    name?: string;
    type?: string;
    members?: string[];
    leader?: string;
  };
}

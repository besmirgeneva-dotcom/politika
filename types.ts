

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
  neutralTerritories: string[]; // NOUVEAU: Pays détruits / non revendiqués
  mapEntities: MapEntity[];
  infrastructure: Record<string, Record<string, number>>;
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
  tokenUsage?: number; // Usage estimé des tokens pour cette simulation
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
  nuclearAcquired?: boolean; // NOUVEAU: L'IA valide l'obtention de la bombe
  // Mises à jour visuelles (Carte)
  mapUpdates?: {
    type: 'annexation' | 'build_base' | 'build_defense' | 'remove_entity' | 'dissolve'; // NOUVEAU: dissolve
    targetCountry: string;
    newOwner?: string;
    lat?: number;
    lng?: number;
    label?: string;
    entityId?: string;
  }[];
  // Mises à jour invisibles (Mémoire / Stats)
  infrastructureUpdates?: {
      country: string;
      type: string; // ex: "usine_munitions", "port_civil"
      change: number; // +1 ou -1
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
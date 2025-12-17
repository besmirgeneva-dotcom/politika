export interface GameEvent {
  id: string;
  date: string;
  type: 'player' | 'world' | 'crisis' | 'economy' | 'war' | 'alliance';
  headline: string;
  description: string;
  relatedCountry?: string; // Pour centrer la caméra
}

// Types restreints aux demandes militaires + logistique
export type MapEntityType = 'factory' | 'port' | 'military_airport' | 'airbase' | 'defense' | 'military_base' | 'troops';

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
  turn: number;
  events: GameEvent[];
  isProcessing: boolean;
  globalTension: number;
  economyHealth: number;
  militaryPower: number;
  popularity: number; // Nouvelle stat: Popularité (0-100)
  corruption: number; // Nouvelle stat: Corruption (0-100, 0 = intègre, 100 = état failli)
  hasNuclear: boolean;
  hasSpaceProgram: boolean; // Nouvelle stat: Capacité spatiale
  militaryRank: number; // Nouvelle stat: Classement mondial (1-195)
  chatHistory: ChatMessage[];
  chaosLevel: ChaosLevel;
  alliance: Alliance | null;
  isGameOver: boolean; // État de défaite
  gameOverReason: string | null;
}

export interface SimulationResponse {
  timeIncrement: 'day' | 'month' | 'year'; // L'IA décide du saut temporel
  events: {
    type: 'world' | 'crisis' | 'economy' | 'war' | 'alliance';
    headline: string;
    description: string;
    relatedCountry?: string;
  }[];
  globalTensionChange: number;
  economyHealthChange: number;
  militaryPowerChange: number;
  popularityChange: number; // Changement de popularité
  corruptionChange: number; // Changement de corruption
  spaceProgramActive?: boolean; // Mise à jour explicite du programme spatial
  mapUpdates?: {
    type: 'annexation' | 'build_factory' | 'build_port' | 'build_airport' | 'build_airbase' | 'build_defense' | 'build_base' | 'troop_deployment' | 'remove_entity';
    targetCountry: string;
    newOwner?: string; // Le pays qui prend le contrôle (ou "INDEPENDENT" pour libération)
    lat?: number;
    lng?: number;
    label?: string; // Pour remove_entity, sert de filtre (ex: "radar")
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
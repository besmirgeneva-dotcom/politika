import React, { useEffect, useState, useRef, useMemo } from 'react';
import { MapContainer, GeoJSON, Marker, Popup, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import * as turf from '@turf/turf';
import { MapEntity, MapEntityType } from '../types';
import { getFrenchName } from '../constants';

// --- ALGORITHME POINT-IN-POLYGON (Ray Casting) ---
const isPointInPolygon = (point: [number, number], vs: [number, number][]) => {
    const x = point[0], y = point[1];
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        const xi = vs[i][0], yi = vs[i][1];
        const xj = vs[j][0], yj = vs[j][1];
        const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
};

const isPointInFeature = (point: [number, number], feature: any): boolean => {
    const geometry = feature.geometry;
    if (!geometry) return false;
    
    if (geometry.type === 'Polygon') {
        const polygon = geometry.coordinates[0].map((p: number[]) => [p[1], p[0]] as [number, number]);
        return isPointInPolygon(point, polygon);
    } else if (geometry.type === 'MultiPolygon') {
        for (const poly of geometry.coordinates) {
            const polygon = poly[0].map((p: number[]) => [p[1], p[0]] as [number, number]);
            if (isPointInPolygon(point, polygon)) return true;
        }
    }
    return false;
};

// Algorithme pour trouver un point visuel intérieur par échantillonnage (Fallback ultime)
const findVisualCenter = (feature: any): [number, number] | null => {
    try {
        const layer = L.geoJSON(feature);
        const bounds = layer.getBounds();
        const southWest = bounds.getSouthWest();
        const northEast = bounds.getNorthEast();
        
        // 1. Essayer le centre géométrique
        const center = bounds.getCenter();
        if (isPointInFeature([center.lat, center.lng], feature)) {
            return [center.lat, center.lng];
        }

        // 2. Si échec, échantillonnage aléatoire (50 essais)
        for (let i = 0; i < 50; i++) {
            const lat = southWest.lat + Math.random() * (northEast.lat - southWest.lat);
            const lng = southWest.lng + Math.random() * (northEast.lng - southWest.lng);
            if (isPointInFeature([lat, lng], feature)) {
                return [lat, lng];
            }
        }
        
        // 3. Retourner le centre géométrique même si imparfait (mieux que rien)
        return [center.lat, center.lng];
    } catch (e) {
        return null;
    }
};

// --- CUSTOM MARKERS ---
const createDotIcon = (color: string, labels: string[], type: string, showLabel: boolean) => {
  const labelHtml = labels.length > 0 ? labels.map(l => `<div>${l}</div>`).join('') : getEntityLabel(type as MapEntityType);

  return L.divIcon({
    className: 'custom-dot-marker',
    html: `
      <div style="position: relative; width: 0; height: 0;">
        <div style="
          position: absolute;
          left: -4px; top: -4px;
          width: 8px; height: 8px; 
          background-color: ${color}; 
          border-radius: 50%; 
          border: 1.5px solid white; 
          box-shadow: 0 1px 2px rgba(0,0,0,0.8);
        "></div>
        
        ${showLabel ? `
        <div style="
          position: absolute; 
          left: 10px; top: -6px; 
          white-space: nowrap; 
          font-size: 10px;
          font-weight: bold; 
          color: white; 
          text-shadow: 0px 0px 3px black, 0px 0px 5px black;
          pointer-events: none;
          z-index: 10;
          display: flex;
          flex-direction: column;
        ">${labelHtml}</div>
        ` : ''}
      </div>
    `,
    iconSize: [0, 0],
    iconAnchor: [0, 0]
  });
};

const getEntityLabel = (type: MapEntityType) => {
    switch(type) {
        case 'military_base': return 'Base';
        case 'defense_system': return 'Défense';
        default: return 'Site';
    }
}

const getEntityColor = (type: MapEntityType) => {
    switch(type) {
        case 'military_base': return '#3b82f6';
        case 'defense_system': return '#f97316';
        default: return '#64748b';
    }
};

const ALL_CAPITALS_URL = "https://raw.githubusercontent.com/hyperknot/country-capitals/master/data/country-capitals.json";

// --- LABEL OVERRIDES (180+ PAYS POUR COUVERTURE TOTALE) ---
const LABEL_OVERRIDES: Record<string, [number, number]> = {
    // --- AMÉRIQUE DU NORD & CARAÏBES ---
    "Canada": [56.0, -106.0], "États-Unis": [39.0, -98.0], "Mexique": [23.5, -102.0],
    "Guatemala": [15.5, -90.2], "Belize": [17.0, -88.5], "Salvador": [13.7, -88.9],
    "Honduras": [14.8, -86.5], "Nicaragua": [12.8, -85.0], "Costa Rica": [10.0, -84.0],
    "Panama": [8.5, -80.0], "Cuba": [21.5, -79.0], "Haïti": [19.0, -72.5],
    "République dominicaine": [19.0, -70.0], "Jamaïque": [18.1, -77.3],
    "Bahamas": [24.0, -76.0], "Trinité-et-Tobago": [10.4, -61.2],

    // --- AMÉRIQUE DU SUD ---
    "Colombie": [4.0, -73.0], "Venezuela": [7.0, -66.0], "Guyana": [5.0, -59.0],
    "Suriname": [4.0, -56.0], "Équateur": [-1.5, -78.0], "Pérou": [-9.0, -75.0],
    "Brésil": [-12.0, -53.0], "Bolivie": [-17.0, -64.0], "Paraguay": [-23.5, -58.0],
    "Chili": [-32.0, -71.0], "Argentine": [-36.0, -65.0], "Uruguay": [-33.0, -56.0],

    // --- EUROPE ---
    "Islande": [65.0, -19.0], "Norvège": [62.0, 9.0], "Suède": [62.0, 15.0], "Finlande": [64.0, 26.0],
    "Royaume-Uni": [54.0, -2.5], "Irlande": [53.2, -8.0], "Danemark": [56.0, 10.0],
    "Pays-Bas": [52.2, 5.5], "Belgique": [50.6, 4.6], "Allemagne": [51.0, 10.0],
    "Pologne": [52.0, 19.0], "France": [46.8, 2.5], "Suisse": [46.8, 8.2],
    "Autriche": [47.5, 14.0], "Tchéquie": [49.8, 15.5], "Slovaquie": [48.7, 19.5],
    "Hongrie": [47.2, 19.3], "Espagne": [40.0, -3.5], "Portugal": [39.5, -8.0],
    "Italie": [42.5, 12.8], "Slovénie": [46.1, 15.0], "Croatie": [45.1, 16.5],
    "Bosnie-Herzégovine": [44.2, 17.8], "Serbie": [44.2, 20.8], "Monténégro": [42.7, 19.3],
    "Kosovo": [42.6, 20.9], "Albanie": [41.1, 20.0], "Macédoine du Nord": [41.6, 21.7],
    "Grèce": [39.5, 22.0], "Bulgarie": [42.7, 25.2], "Roumanie": [46.0, 25.0],
    "Moldavie": [47.2, 28.5], "Ukraine": [49.0, 31.0], "Biélorussie": [53.5, 28.0],
    "Lituanie": [55.3, 24.0], "Lettonie": [56.9, 26.0], "Estonie": [58.8, 25.5],
    "Russie": [58.0, 80.0], "Luxembourg": [49.8, 6.1], "Chypre": [35.1, 33.4],

    // --- AFRIQUE ---
    "Maroc": [31.0, -6.0], "Algérie": [28.0, 2.5], "Tunisie": [34.5, 9.5],
    "Libye": [27.0, 17.0], "Égypte": [26.5, 30.0], "Mauritanie": [20.0, -10.0],
    "Mali": [17.5, -3.0], "Niger": [17.0, 9.0], "Tchad": [15.5, 18.5],
    "Soudan": [14.0, 30.0], "Soudan du Sud": [7.0, 30.0], "Érythrée": [15.5, 38.5],
    "Éthiopie": [8.5, 39.5], "Somalie": [5.0, 46.0], "Djibouti": [11.7, 42.5],
    "Sénégal": [14.5, -14.5], "Gambie": [13.4, -15.5], "Guinée-Bissau": [12.0, -15.0],
    "Guinée": [10.5, -11.0], "Sierra Leone": [8.5, -11.8], "Liberia": [6.5, -9.5],
    "Côte d'Ivoire": [7.5, -5.5], "Ghana": [7.8, -1.0], "Burkina Faso": [12.2, -1.7],
    "Togo": [8.5, 1.1], "Bénin": [9.5, 2.3], "Nigéria": [9.5, 8.0],
    "Cameroun": [5.5, 12.5], "République centrafricaine": [6.5, 20.5],
    "Guinée équatoriale": [1.6, 10.5], "Gabon": [-0.5, 11.5], "Congo": [-1.0, 15.5],
    "République démocratique du Congo": [-3.0, 23.5], "Ouganda": [1.2, 32.2],
    "Kenya": [0.5, 38.0], "Tanzanie": [-6.0, 35.0], "Rwanda": [-2.0, 30.0], "Burundi": [-3.4, 30.0],
    "Angola": [-12.0, 17.5], "Zambie": [-13.5, 28.0], "Malawi": [-13.5, 34.0],
    "Mozambique": [-18.5, 35.0], "Zimbabwe": [-19.0, 29.8], "Botswana": [-22.0, 24.0],
    "Namibie": [-22.0, 17.0], "Afrique du Sud": [-29.0, 25.0], "Lesotho": [-29.5, 28.2],
    "Eswatini": [-26.5, 31.5], "Madagascar": [-19.0, 46.5],

    // --- MOYEN-ORIENT & ASIE CENTRALE ---
    "Turquie": [39.0, 35.0], "Syrie": [35.0, 38.5], "Liban": [33.9, 35.8],
    "Israël": [31.4, 35.0], "Palestine": [31.9, 35.3], "Jordanie": [31.0, 36.5],
    "Irak": [33.0, 43.5], "Koweït": [29.3, 47.6], "Arabie saoudite": [24.0, 45.0],
    "Bahreïn": [26.0, 50.5], "Qatar": [25.3, 51.2], "Émirats arabes unis": [23.8, 54.0],
    "Oman": [21.0, 57.0], "Yémen": [15.5, 48.0], "Iran": [32.5, 54.0],
    "Afghanistan": [34.0, 66.0], "Pakistan": [30.0, 70.0], "Turkménistan": [39.0, 59.5],
    "Ouzbékistan": [41.5, 64.0], "Kazakhstan": [48.0, 67.0], "Kirghizistan": [41.5, 74.5],
    "Tadjikistan": [38.5, 71.0], "Azerbaïdjan": [40.4, 47.5], "Arménie": [40.2, 45.0], "Géorgie": [42.0, 43.5],

    // --- ASIE DU SUD & EST ---
    "Inde": [22.0, 78.0], "Sri Lanka": [7.8, 80.7], "Népal": [28.2, 84.0], "Bhoutan": [27.5, 90.5],
    "Bangladesh": [24.0, 90.2], "Birmanie": [21.0, 96.0], "Thaïlande": [15.0, 101.0],
    "Laos": [19.0, 102.5], "Cambodge": [12.5, 105.0], "Vietnam": [16.5, 108.0],
    "Chine": [35.5, 104.0], "Mongolie": [46.8, 103.5], "Corée du Nord": [40.0, 127.0],
    "Corée du Sud": [36.3, 127.8], "Japon": [36.5, 138.0], "Taïwan": [23.7, 121.0],
    "Philippines": [12.0, 123.0], "Malaisie": [4.0, 102.0], "Singapour": [1.35, 103.8],
    "Brunei": [4.5, 114.7], "Indonésie": [-4.0, 118.0], "Timor oriental": [-8.8, 125.6],

    // --- OCÉANIE ---
    "Australie": [-25.0, 134.0], "Papouasie-Nouvelle-Guinée": [-6.0, 144.0],
    "Nouvelle-Zélande": [-41.0, 173.0], "Fidji": [-17.8, 178.0], "Îles Salomon": [-9.6, 160.0],
    "Vanuatu": [-15.4, 166.9], "Nouvelle-Calédonie": [-21.3, 165.5]
};

// --- MAP LABELS COMPONENT ---
const MapLabels = ({ zoom, visibleCountries, playerCountry, ownedTerritories, neutralTerritories }: { zoom: number, visibleCountries: any[], playerCountry: string | null, ownedTerritories: string[], neutralTerritories: string[] }) => {
    // Définition de "Grand Pays"
    const MAJOR_POWERS = ["États-Unis", "Russie", "Chine", "Brésil", "Australie", "Canada", "Inde", "Algérie", "Congo", "Argentine"];

    return (
        <>
            {visibleCountries.map((c, idx) => {
                const name = c.name;
                const center = c.center; // Center is now guaranteed inside
                if (!center) return null;

                const isPlayer = name === playerCountry;
                const isOwned = ownedTerritories.includes(name);
                const isNeutral = neutralTerritories.includes(name);
                
                // MASQUAGE DU NOM SI ANNEXÉ MAIS PAS LE COEUR DU PAYS JOUEUR
                // C'est ici que le nom du pays disparait lors d'une annexion, laissant la place à la capitale (via CapitalMarkers)
                if (isOwned && !isPlayer) return null;

                const displayName = isNeutral ? "PAYS VIDE" : name;
                const displayColor = isNeutral ? '#b91c1c' : (isPlayer ? '#15803d' : '#374151');
                
                const isMajor = MAJOR_POWERS.includes(name);

                // LOGIQUE D'AFFICHAGE (Zoom)
                if (zoom < 3 && !isMajor) return null; 

                const fontSize = zoom < 4 ? '9px' : '11px';
                
                return (
                    <Marker 
                        key={`label-${name}-${idx}`}
                        position={center} 
                        zIndexOffset={900}
                        icon={L.divIcon({
                            className: 'bg-transparent',
                            html: `<div style="
                                color: ${displayColor};
                                text-shadow: 0 0 3px rgba(255,255,255,0.9); 
                                font-weight: ${isPlayer || isNeutral ? '900' : 'bold'}; 
                                font-size: ${fontSize};
                                text-transform: uppercase;
                                text-align: center;
                                width: 160px;
                                margin-left: -80px;
                                pointer-events: none;
                                font-family: 'Segoe UI', sans-serif;
                                opacity: 0.95;
                                letter-spacing: 0.5px;
                            ">${displayName}</div>`
                        })}
                    />
                );
            })}
        </>
    );
};

const CapitalMarkers = ({ zoom, ownedTerritories, playerCountry }: { zoom: number, ownedTerritories: string[], playerCountry: string | null }) => {
    const [capitals, setCapitals] = useState<any[]>([]);

    useEffect(() => {
        const fetchCapitals = async () => {
            try {
                const res = await fetch(ALL_CAPITALS_URL);
                if (!res.ok) throw new Error("Failed to fetch capitals");
                const data = await res.json();
                
                const formatted = data
                    .filter((item: any) => item.CapitalLatitude && item.CapitalLongitude)
                    .map((item: any) => ({
                        country: getFrenchName(item.CountryName),
                        city: item.CapitalName,
                        coords: [parseFloat(item.CapitalLatitude), parseFloat(item.CapitalLongitude)]
                    }));
                
                setCapitals(formatted);
            } catch (e) {
                console.warn("Erreur chargement capitales", e);
            }
        };
        fetchCapitals();
    }, []);

    // Affichage amélioré :
    // On affiche les capitales à partir de zoom 4 en général.
    // MAIS, si c'est un territoire annexé (appartient au joueur mais n'est pas son pays d'origine),
    // on l'affiche même à zoom 3 pour servir d'étiquette principale (puisque le nom du pays est masqué).
    
    if (zoom < 3) return null;

    return (
        <>
            {capitals.map((info, idx) => {
                const isAnnexed = playerCountry && ownedTerritories.includes(info.country) && info.country !== playerCountry;
                
                // Si zoom < 4, on n'affiche QUE les capitales des territoires annexés pour qu'ils aient une étiquette
                if (zoom < 4 && !isAnnexed) return null;

                return (
                    <Marker 
                        key={`cap-${info.country}-${idx}`}
                        position={info.coords}
                        zIndexOffset={1000}
                        icon={L.divIcon({
                            className: 'bg-transparent',
                            html: `<div style="display: flex; flex-direction: column; align-items: center; pointer-events: none;">
                                <div style="width: ${isAnnexed ? '6px' : '5px'}; height: ${isAnnexed ? '6px' : '5px'}; background: ${isAnnexed ? '#15803d' : '#1f2937'}; border: 1px solid white; border-radius: 50%; box-shadow: 0 1px 2px rgba(0,0,0,0.5);"></div>
                                ${zoom > 4 || isAnnexed ? `
                                <div style="
                                    color: ${isAnnexed ? '#064e3b' : '#4b5563'}; 
                                    text-shadow: 1px 1px 0 rgba(255,255,255,0.9); 
                                    font-size: ${isAnnexed ? '10px' : '8px'}; 
                                    font-weight: ${isAnnexed ? 'bold' : 'normal'};
                                    margin-top: 1px; 
                                    white-space: nowrap; 
                                    background: rgba(255,255,255,0.6); 
                                    padding: 0 2px; 
                                    border-radius: 2px;
                                ">${info.city}</div>` : ''}
                            </div>`
                        })}
                    />
                );
            })}
        </>
    );
}

const MapController = ({ onZoomChange }: { onZoomChange: (z: number) => void }) => {
    const map = useMapEvents({
        zoomend: () => onZoomChange(map.getZoom())
    });
    return null;
};

const FlyToCountry = ({ targetCountry, centers }: { targetCountry: string | null, centers: {name: string, center: [number, number]}[] }) => {
    const map = useMap();
    useEffect(() => {
        if (targetCountry) {
            const countryName = targetCountry.split(':')[0];
            const centerObj = centers.find(c => c.name === countryName);
            if (centerObj) {
                map.flyTo(centerObj.center, 5, { duration: 1.5 });
            }
        }
    }, [targetCountry, centers, map]);
    return null;
};

interface WorldMapProps {
  onRegionClick: (region: string) => void;
  playerCountry: string | null;
  ownedTerritories: string[];
  neutralTerritories?: string[];
  mapEntities: MapEntity[];
  focusCountry: string | null;
}

const CACHE_KEY = 'GEOSIM_MAP_DATA';
const GEOJSON_URL = "https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson";

const WorldMap: React.FC<WorldMapProps> = ({ onRegionClick, playerCountry, ownedTerritories, neutralTerritories = [], mapEntities, focusCountry }) => {
  const [geoData, setGeoData] = useState<any>(null);
  const [zoom, setZoom] = useState(3);
  const [centers, setCenters] = useState<{name: string, center: [number, number]}[]>([]);
  const featureMap = useRef<Record<string, any>>({});

  // 1. Load Data
  const processGeoData = (data: any) => {
      const newCenters: {name: string, center: [number, number]}[] = [];
      
      data.features.forEach((feature: any) => {
          const name = getFrenchName(feature.properties.name);
          feature.properties.name = name;
          featureMap.current[name] = feature;
          
          let center: [number, number] | null = null;
          if (LABEL_OVERRIDES[name]) {
              center = LABEL_OVERRIDES[name];
          } else {
              center = findVisualCenter(feature);
          }

          if (center) {
              newCenters.push({ name, center });
          }
      });
      setCenters(newCenters);
      setGeoData(data);
  };

  useEffect(() => {
    const loadData = async () => {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
            try {
                const data = JSON.parse(cached);
                processGeoData(data);
                return;
            } catch (e) {
                localStorage.removeItem(CACHE_KEY);
            }
        }
        try {
            const response = await fetch(GEOJSON_URL);
            const data = await response.json();
            localStorage.setItem(CACHE_KEY, JSON.stringify(data));
            processGeoData(data);
        } catch (error) {
            console.error("Failed to load map data", error);
        }
    };
    loadData();
  }, []);

  // 2. Compute Merged Geometry (Union of Owned Territories)
  const displayGeoData = useMemo(() => {
      if (!geoData) return null;
      
      // If we don't own more than 1 territory, or no player country, just return original data
      // We also check if we have enough territories to possibly share a border
      if (!playerCountry || ownedTerritories.length <= 1) return geoData;

      const ownedFeatures: any[] = [];
      const otherFeatures: any[] = [];

      for (const feature of geoData.features) {
          if (ownedTerritories.includes(feature.properties.name)) {
              ownedFeatures.push(feature);
          } else {
              otherFeatures.push(feature);
          }
      }

      if (ownedFeatures.length === 0) return geoData;

      try {
          // Attempt to merge all owned features into one
          let merged = ownedFeatures[0];
          // We iterate and union them progressively
          for (let i = 1; i < ownedFeatures.length; i++) {
              const u = turf.union(merged, ownedFeatures[i]);
              if (u) merged = u;
          }
          
          // Force the name of the merged feature to be the Player Country
          // This ensures styles apply correctly as "Player" color
          if (merged && merged.properties) {
              merged.properties = { ...merged.properties, name: playerCountry };
          } else if (merged) {
              merged.properties = { name: playerCountry };
          }

          return {
              type: "FeatureCollection",
              features: [...otherFeatures, merged]
          };
      } catch (e) {
          console.warn("Turf union failed, fallback to standard map", e);
          return geoData;
      }

  }, [geoData, ownedTerritories, playerCountry]);

  const style = (feature: any) => {
    const countryName = feature.properties.name;
    let fillColor = "#d1d5db"; // Gris neutre
    
    if (playerCountry === countryName) {
        fillColor = "#22c55e"; // Vert joueur (inclut désormais les annexés fusionnés)
    } else if (ownedTerritories.includes(countryName)) {
        fillColor = "#4ade80"; // Vert annexe (cas fallback si fusion échoue)
    } else if (neutralTerritories.includes(countryName)) {
        fillColor = "#7f1d1d"; // Rouge foncé
    }

    return {
      fillColor,
      weight: 1,
      opacity: 1,
      color: '#ffffff',
      dashArray: '',
      fillOpacity: 1
    };
  };
  
  const onEachFeature = (feature: any, layer: L.Layer) => {
    const name = feature.properties.name;
    layer.on({
      click: () => {
        onRegionClick(name);
      },
      mouseover: (e) => {
        e.target.setStyle({ weight: 2, color: '#3b82f6', fillOpacity: 0.9 });
      },
      mouseout: (e) => {
        e.target.setStyle({ weight: 1, color: '#ffffff', fillOpacity: 1 });
      }
    });
  };

  const [cachedPositions, setCachedPositions] = useState<Record<string, [number, number]>>({});

  const getMarkerPosition = (entity: MapEntity): [number, number] | null => {
      if (entity.lat !== 0 || entity.lng !== 0) return [entity.lat, entity.lng];
      if (cachedPositions[entity.id]) return cachedPositions[entity.id];

      const countryName = entity.country;
      const feature = featureMap.current[countryName];
      
      if (feature) {
          try {
              const layer = L.geoJSON(feature);
              const bounds = layer.getBounds();
              const southWest = bounds.getSouthWest();
              const northEast = bounds.getNorthEast();
              
              let seed = entity.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
              const pseudoRandom = () => {
                  seed = (seed * 9301 + 49297) % 233280;
                  return seed / 233280;
              };

              for (let i = 0; i < 50; i++) {
                  const lat = southWest.lat + pseudoRandom() * (northEast.lat - southWest.lat);
                  const lng = southWest.lng + pseudoRandom() * (northEast.lng - southWest.lng);
                  if (isPointInFeature([lat, lng], feature)) return [lat, lng];
              }
              const backupCenter = centers.find(c => c.name === countryName);
              if (backupCenter) return backupCenter.center;
          } catch (e) {}
      }
      const manualCenter = centers.find(c => c.name === countryName);
      if (manualCenter) return manualCenter.center;
      return null;
  };

  if (!geoData) return <div className="text-stone-500 text-center mt-20 flex items-center justify-center h-full">Initialisation satellite...</div>;

  return (
    <MapContainer 
        zoomControl={false} 
        center={[20, 0]} 
        zoom={3} 
        style={{ height: '100%', width: '100%', background: '#e0f2fe' }} 
        minZoom={2}
        maxZoom={10} 
        maxBounds={[[-90, -180], [90, 180]]}
    >
        <MapController onZoomChange={setZoom} />
        <FlyToCountry targetCountry={focusCountry} centers={centers} />
        
        {/* IMPORTANT: Key is essential to force re-render when territories merge */}
        <GeoJSON 
            key={`map-${ownedTerritories.length}-${neutralTerritories.length}`} 
            data={displayGeoData || geoData} 
            style={style} 
            onEachFeature={onEachFeature} 
        />

        <MapLabels 
            zoom={zoom} 
            visibleCountries={centers} 
            playerCountry={playerCountry}
            ownedTerritories={ownedTerritories}
            neutralTerritories={neutralTerritories}
        />
        
        <CapitalMarkers 
            zoom={zoom} 
            ownedTerritories={ownedTerritories}
            playerCountry={playerCountry}
        />

        {mapEntities.map((entity) => {
             if (zoom < 6) return null;
             const position = getMarkerPosition(entity);
             if (!position) return null;
             const showLabel = zoom >= 8;
             return (
                <Marker
                    key={entity.id}
                    position={position}
                    icon={createDotIcon(getEntityColor(entity.type), [], entity.type, showLabel)}
                >
                    <Popup>{entity.label || getEntityLabel(entity.type)}</Popup>
                </Marker>
             );
        })}

    </MapContainer>
  );
};

export default WorldMap;
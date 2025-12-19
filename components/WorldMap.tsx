
import React, { useEffect, useState, useRef } from 'react';
import { MapContainer, GeoJSON, Marker, Popup, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
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
          left: 8px; top: -6px; 
          white-space: nowrap; 
          font-size: 8px;
          font-weight: bold; 
          background-color: rgba(0,0,0,0.8); 
          color: white; 
          padding: 2px 4px; 
          border-radius: 3px;
          pointer-events: none;
          text-shadow: 0 0 2px black;
          z-index: 10;
          border: 1px solid ${color};
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
        default: return type;
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
const MapLabels = ({ zoom, visibleCountries, playerCountry }: { zoom: number, visibleCountries: any[], playerCountry: string | null }) => {
    // Affichage progressif selon le zoom pour éviter la surcharge
    // Zoom 2-3 : Uniquement les grands pays
    // Zoom 4+ : Tout le monde
    
    // Définition de "Grand Pays" (très approximatif via liste, ou simplement tout afficher si zoom assez grand)
    const MAJOR_POWERS = ["États-Unis", "Russie", "Chine", "Brésil", "Australie", "Canada", "Inde", "Algérie", "Congo", "Argentine"];

    return (
        <>
            {visibleCountries.map((c, idx) => {
                const name = c.name;
                const center = c.center; // Center is now guaranteed inside
                if (!center) return null;

                const isPlayer = name === playerCountry;
                const isMajor = MAJOR_POWERS.includes(name);

                // LOGIQUE D'AFFICHAGE
                // Zoom < 3 : Seulement les très grands
                // Zoom >= 3 : La plupart
                // Zoom >= 5 : Tous (y compris les petits états)
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
                                color: ${isPlayer ? '#15803d' : '#374151'};
                                text-shadow: 0 0 3px rgba(255,255,255,0.9); 
                                font-weight: ${isPlayer ? '900' : 'bold'}; 
                                font-size: ${fontSize};
                                text-transform: uppercase;
                                text-align: center;
                                width: 160px;
                                margin-left: -80px;
                                pointer-events: none;
                                font-family: 'Segoe UI', sans-serif;
                                opacity: 0.95;
                                letter-spacing: 0.5px;
                            ">${name}</div>`
                        })}
                    />
                );
            })}
        </>
    );
};

const CapitalMarkers = ({ zoom }: { zoom: number }) => {
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

    if (zoom < 4) return null;

    return (
        <>
            {capitals.map((info, idx) => {
                return (
                    <Marker 
                        key={`cap-${info.country}-${idx}`}
                        position={info.coords}
                        zIndexOffset={1000}
                        icon={L.divIcon({
                            className: 'bg-transparent',
                            html: `<div style="display: flex; flex-direction: column; align-items: center; pointer-events: none;">
                                <div style="width: 5px; height: 5px; background: #1f2937; border: 1px solid white; border-radius: 50%; box-shadow: 0 1px 2px rgba(0,0,0,0.5);"></div>
                                ${zoom > 4 ? `
                                <div style="
                                    color: #4b5563; 
                                    text-shadow: 1px 1px 0 rgba(255,255,255,0.9); 
                                    font-size: 8px; 
                                    margin-top: 1px; 
                                    white-space: nowrap; 
                                    background: rgba(255,255,255,0.4); 
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

  const processGeoData = (data: any) => {
      const newCenters: {name: string, center: [number, number]}[] = [];
      
      data.features.forEach((feature: any) => {
          const name = getFrenchName(feature.properties.name);
          feature.properties.name = name;
          featureMap.current[name] = feature;
          
          let center: [number, number] | null = null;

          // 1. Priorité ABSOLUE aux coordonnées manuelles (Liste de 180+ pays)
          if (LABEL_OVERRIDES[name]) {
              center = LABEL_OVERRIDES[name];
          } else {
              // 2. Si pas de manuel (ex: petite île oubliée), calcul d'un point INTÉRIEUR garanti
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

  const style = (feature: any) => {
    const countryName = feature.properties.name;
    let fillColor = "#d1d5db"; // Gris neutre
    
    if (playerCountry === countryName) {
        fillColor = "#22c55e"; // Vert joueur
    } else if (ownedTerritories.includes(countryName)) {
        fillColor = "#4ade80"; // Vert annexe
    } else if (neutralTerritories.includes(countryName)) {
        fillColor = "#ef4444"; // Rouge
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

  // --- LOGIC: MARKER POSITIONING (STRICTLY INSIDE BORDERS) ---
  const [cachedPositions, setCachedPositions] = useState<Record<string, [number, number]>>({});

  const getMarkerPosition = (entity: MapEntity): [number, number] | null => {
      // 1. Coordonnées explicites
      if (entity.lat !== 0 || entity.lng !== 0) {
          return [entity.lat, entity.lng];
      }

      // 2. Cache
      if (cachedPositions[entity.id]) return cachedPositions[entity.id];

      const countryName = entity.country;
      const feature = featureMap.current[countryName];
      
      // 3. Calcul d'une position aléatoire valide (Rejection Sampling amélioré)
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

              // On essaie 50 fois de placer le point DANS le polygone
              for (let i = 0; i < 50; i++) {
                  const lat = southWest.lat + pseudoRandom() * (northEast.lat - southWest.lat);
                  const lng = southWest.lng + pseudoRandom() * (northEast.lng - southWest.lng);
                  
                  if (isPointInFeature([lat, lng], feature)) {
                      return [lat, lng];
                  }
              }
              
              // 4. Si échec, on utilise le centre visuel calculé au chargement (Garantie de secours)
              const backupCenter = centers.find(c => c.name === countryName);
              if (backupCenter) return backupCenter.center;

          } catch (e) {}
      }

      // 5. Dernier recours (ne devrait jamais arriver si la liste centers est correcte)
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
        
        {/* Base Layer */}
        <GeoJSON data={geoData} style={style} onEachFeature={onEachFeature} />

        {/* Labels des Pays */}
        <MapLabels 
            zoom={zoom} 
            visibleCountries={centers} 
            playerCountry={playerCountry}
        />
        
        {/* Capitales */}
        <CapitalMarkers zoom={zoom} />

        {/* Entités de carte (Bases/Défenses) */}
        {mapEntities.map((entity) => {
             const position = getMarkerPosition(entity);
             if (!position) return null;
             
             return (
                <Marker
                    key={entity.id}
                    position={position}
                    icon={createDotIcon(getEntityColor(entity.type), [], entity.type, zoom > 4)}
                >
                    {zoom > 4 && <Popup>{entity.label || getEntityLabel(entity.type)}</Popup>}
                </Marker>
             );
        })}

    </MapContainer>
  );
};

export default WorldMap;

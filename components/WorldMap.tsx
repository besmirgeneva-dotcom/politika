
import React, { useEffect, useState, useMemo } from 'react';
import { MapContainer, GeoJSON, TileLayer, Marker, Popup, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import { MapEntity, MapEntityType } from '../types';
import { getFrenchName, normalizeCountryName } from '../constants';

// --- CUSTOM MARKERS ---
const createDotIcon = (color: string, labels: string[], type: string, showLabel: boolean) => {
  const labelHtml = labels.length > 0 ? labels.map(l => `<div>${l}</div>`).join('') : getEntityLabel(type as MapEntityType);

  return L.divIcon({
    className: 'custom-dot-marker',
    html: `
      <div style="position: relative; width: 0; height: 0;">
        <div style="
          position: absolute;
          left: -5px; top: -5px;
          width: 12px; height: 12px; 
          background-color: ${color}; 
          border-radius: 50%; 
          border: 2px solid white; 
          box-shadow: 0 1px 3px rgba(0,0,0,0.6);
        "></div>
        
        ${showLabel ? `
        <div style="
          position: absolute; 
          left: 10px; top: -8px; 
          white-space: nowrap; 
          font-size: 8px;
          font-weight: bold; 
          background-color: rgba(0,0,0,0.85); 
          color: white; 
          padding: 3px 6px; 
          border-radius: 4px;
          pointer-events: none;
          text-shadow: 0 0 2px black;
          z-index: 10;
          border: 1px solid ${color};
          display: flex;
          flex-direction: column;
          gap: 1px;
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
        case 'military_base': return '🏰 Base Militaire';
        case 'defense_system': return '🛡️ Défense';
        default: return type;
    }
}

const getEntityColor = (type: MapEntityType) => {
    switch(type) {
        case 'military_base': return '#4f46e5'; 
        case 'defense_system': return '#ea580c';
        default: return '#64748b';
    }
};

interface CapitalInfo {
    coords: [number, number];
    city: string;
}

// Données des capitales étendues
const CAPITAL_DATA: Record<string, CapitalInfo> = {
    "États-Unis": { coords: [38.9072, -77.0369], city: "Washington" },
    "France": { coords: [48.8566, 2.3522], city: "Paris" },
    "Chine": { coords: [39.9042, 116.4074], city: "Pékin" },
    "Russie": { coords: [55.7558, 37.6173], city: "Moscou" },
    "Royaume-Uni": { coords: [51.5074, -0.1278], city: "Londres" },
    "Allemagne": { coords: [52.5200, 13.4050], city: "Berlin" },
    "Japon": { coords: [35.6762, 139.6503], city: "Tokyo" },
    "Inde": { coords: [28.6139, 77.2090], city: "New Delhi" },
    "Brésil": { coords: [-15.8267, -47.9218], city: "Brasília" },
    "Canada": { coords: [45.4215, -75.6972], city: "Ottawa" },
    "Australie": { coords: [-35.2809, 149.1300], city: "Canberra" },
    "Italie": { coords: [41.9028, 12.4964], city: "Rome" },
    "Espagne": { coords: [40.4168, -3.7038], city: "Madrid" },
    "Égypte": { coords: [30.0444, 31.2357], city: "Le Caire" },
    "Afrique du Sud": { coords: [-25.7479, 28.2293], city: "Pretoria" },
    "Mexique": { coords: [19.4326, -99.1332], city: "Mexico" },
    "Argentine": { coords: [-34.6037, -58.3816], city: "Buenos Aires" },
    "Turquie": { coords: [39.9334, 32.8597], city: "Ankara" },
    "Iran": { coords: [35.6892, 51.3890], city: "Téhéran" },
    "Corée du Sud": { coords: [37.5665, 126.9780], city: "Séoul" },
    "Indonésie": { coords: [-6.2088, 106.8456], city: "Jakarta" },
    "Arabie saoudite": { coords: [24.7136, 46.6753], city: "Riyad" }
};

// Sources GeoJSON pour les provinces (Mapping Pays -> URL)
const PROVINCE_SOURCES: Record<string, string> = {
    "États-Unis": "https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json",
    "France": "https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/departements.geojson",
    "Chine": "https://raw.githubusercontent.com/deldersveld/topojson/master/countries/china/china-provinces.json", 
    "Allemagne": "https://raw.githubusercontent.com/isellsoap/deutschlandGeoJSON/main/2_bundeslaender/3_medium.geojson",
    "Canada": "https://raw.githubusercontent.com/codeforamerica/click_that_hood/master/public/data/canada.geojson",
    "Australie": "https://raw.githubusercontent.com/rowanhogan/australian-states/master/states_minified.geojson",
    "Brésil": "https://raw.githubusercontent.com/codeforamerica/click_that_hood/master/public/data/brazil-states.geojson",
    "Inde": "https://raw.githubusercontent.com/Subhash9325/GeoJson-Data-of-Indian-States/master/Indian_States", 
    "Russie": "https://raw.githubusercontent.com/codeforamerica/click_that_hood/master/public/data/russia.geojson"
};

// Positions manuelles pour les labels des pays (pour éviter le chevauchement)
const LABEL_OVERRIDES: Record<string, [number, number]> = {
    "États-Unis": [39.0, -100.0],
    "Canada": [55.0, -105.0],
    "Russie": [60.0, 90.0],
    "Chine": [35.0, 105.0],
    "Brésil": [-14.0, -55.0],
    "Australie": [-25.0, 135.0],
    "Inde": [22.0, 79.0],
    "Argentine": [-37.0, -65.0],
    "Algérie": [28.0, 2.0],
    "République démocratique du Congo": [-3.0, 23.0],
    "Arabie saoudite": [24.0, 45.0],
    "Mexique": [23.0, -102.0],
    "Indonésie": [-4.0, 118.0],
    "Mongolie": [46.0, 105.0],
    "Kazakhstan": [48.0, 68.0],
    "France": [46.5, 2.5],
    "Espagne": [40.0, -4.0],
    "Allemagne": [51.0, 10.0],
    "Pologne": [52.0, 19.0],
    "Ukraine": [49.0, 31.0],
    "Turquie": [39.0, 35.0],
    "Iran": [32.0, 53.0],
    "Soudan": [16.0, 30.0],
    "Libye": [27.0, 17.0],
    "Tchad": [15.0, 18.0],
    "Niger": [17.0, 8.0],
    "Mali": [17.0, -4.0],
    "Afrique du Sud": [-29.0, 24.0],
    "Colombie": [4.0, -73.0],
    "Pérou": [-9.0, -75.0]
};

// --- MAP LABELS COMPONENT (ALWAYS VISIBLE) ---
const MapLabels = ({ zoom, visibleCountries, ownedTerritories, playerCountry }: { zoom: number, visibleCountries: any[], ownedTerritories: string[], playerCountry: string | null }) => {
    return (
        <>
            {visibleCountries.map((c, idx) => {
                const name = c.name;
                const center = LABEL_OVERRIDES[name] || c.center;
                if (!center) return null;

                const isMajor = !!LABEL_OVERRIDES[name];
                if (zoom < 3 && !isMajor) return null; 
                if (zoom < 5 && !isMajor && name.length > 10) return null;

                const isPlayer = name === playerCountry;

                return (
                    <Marker 
                        key={`label-${name}-${idx}`}
                        position={center} 
                        zIndexOffset={900}
                        icon={L.divIcon({
                            className: 'bg-transparent',
                            html: `<div style="
                                color: ${isPlayer ? '#15803d' : '#374151'};
                                text-shadow: 0 0 3px rgba(255,255,255,0.8); 
                                font-weight: ${isPlayer ? '900' : 'bold'}; 
                                font-size: ${isMajor ? (zoom < 4 ? '10px' : '14px') : '10px'};
                                text-transform: uppercase;
                                text-align: center;
                                width: 150px;
                                margin-left: -75px;
                                pointer-events: none;
                                font-family: sans-serif;
                                opacity: 0.9;
                                letter-spacing: 0.5px;
                            ">${name}</div>`
                        })}
                    />
                );
            })}
        </>
    );
};

// --- CAPITAL MARKERS COMPONENT ---
const CapitalMarkers = ({ zoom, ownedTerritories }: { zoom: number, ownedTerritories: string[] }) => {
    if (zoom < 4) return null;

    return (
        <>
            {Object.entries(CAPITAL_DATA).map(([country, info]) => {
                return (
                    <Marker 
                        key={`cap-${country}`}
                        position={info.coords}
                        zIndexOffset={1000}
                        icon={L.divIcon({
                            className: 'bg-transparent',
                            html: `<div style="display: flex; flex-direction: column; align-items: center; pointer-events: none;">
                                <div style="width: 6px; height: 6px; background: #1f2937; border: 1.5px solid white; border-radius: 50%; box-shadow: 0 1px 2px rgba(0,0,0,0.5);"></div>
                                ${zoom >= 5 ? `<div style="color: #1f2937; text-shadow: 1px 1px 0 rgba(255,255,255,0.8); font-size: 9px; font-weight: bold; margin-top: 2px; white-space: nowrap; background: rgba(255,255,255,0.4); padding: 0 2px; border-radius: 2px;">${info.city}</div>` : ''}
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

            if (LABEL_OVERRIDES[countryName]) {
                map.flyTo(LABEL_OVERRIDES[countryName], 5, { duration: 1.5 });
                return;
            }
            const centerObj = centers.find(c => c.name === countryName);
            if (centerObj) {
                map.flyTo(centerObj.center, 5, { duration: 1.5 });
                return;
            }
            if (CAPITAL_DATA[countryName]) {
                map.flyTo(CAPITAL_DATA[countryName].coords, 5, { duration: 1.5 });
            }
        }
    }, [targetCountry, centers, map]);
    return null;
};

// --- PROVINCE DRILL-DOWN LAYER ---
const ProvinceLayer = ({ 
    focusCountry, 
    onProvinceClick, 
    ownedTerritories,
    playerCountry 
}: { 
    focusCountry: string | null, 
    onProvinceClick: (provName: string) => void,
    ownedTerritories: string[],
    playerCountry: string | null
}) => {
    const [provinceData, setProvinceData] = useState<any>(null);
    const map = useMap();

    useEffect(() => {
        setProvinceData(null);
        if (!focusCountry || focusCountry.includes(':')) return;

        const url = PROVINCE_SOURCES[focusCountry];
        if (url) {
            fetch(url)
                .then(r => r.json())
                .then(data => {
                    setProvinceData(data);
                })
                .catch(e => console.error("Province fetch error", e));
        }
    }, [focusCountry]);

    const style = (feature: any) => {
        const provName = feature.properties.name || feature.properties.NAME_1 || feature.properties.statename;
        const fullId = `${focusCountry}:${provName}`;
        
        const isOwned = ownedTerritories.includes(fullId);
        
        // Base fill color
        let fillColor = "#d1d5db"; // Gris
        if (ownedTerritories.includes(fullId)) fillColor = "#4ade80"; // Vert clair (annexé)
        else if (playerCountry === focusCountry) fillColor = "#22c55e"; // Vert joueur

        return {
            fillColor,
            weight: 1, // Ligne fine
            opacity: 1,
            color: '#6b7280', // Gris foncé pour la bordure (visible sur fond clair/vert)
            dashArray: '4, 4', // TRAITILLÉS (DASHED LINES)
            fillOpacity: 0.9
        };
    };

    if (!provinceData) return null;

    return (
        <GeoJSON 
            key={`prov-${focusCountry}`} 
            data={provinceData} 
            style={style} 
            onEachFeature={(feature, layer) => {
                const name = feature.properties.name || feature.properties.NAME_1 || feature.properties.statename;
                layer.on('click', (e) => {
                    L.DomEvent.stopPropagation(e);
                    if (name) onProvinceClick(`${focusCountry}:${name}`);
                });
                if (name) layer.bindTooltip(name, { sticky: true, className: 'province-tooltip' });
            }} 
        />
    );
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

  const processGeoData = (data: any) => {
      const newCenters: {name: string, center: [number, number]}[] = [];
      data.features.forEach((feature: any) => {
          const name = getFrenchName(feature.properties.name);
          feature.properties.name = name;
          
          if (CAPITAL_DATA[name]) {
              newCenters.push({ name, center: CAPITAL_DATA[name].coords });
          } else if (LABEL_OVERRIDES[name]) {
              newCenters.push({ name, center: LABEL_OVERRIDES[name] });
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
    let fillColor = "#d1d5db"; // Gris neutre (gray-300)
    
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
        
        {/* Drill-down Provinces (TRAITILLÉ) */}
        <ProvinceLayer 
            focusCountry={focusCountry} 
            onProvinceClick={onRegionClick}
            ownedTerritories={ownedTerritories}
            playerCountry={playerCountry}
        />

        {/* Labels & Markers */}
        <MapLabels 
            zoom={zoom} 
            visibleCountries={centers} 
            ownedTerritories={ownedTerritories}
            playerCountry={playerCountry}
        />
        
        <CapitalMarkers zoom={zoom} ownedTerritories={ownedTerritories} />

        {mapEntities.map((entity) => (
             <Marker
                key={entity.id}
                position={[entity.lat, entity.lng]}
                icon={createDotIcon(getEntityColor(entity.type), [], entity.type, zoom > 4)}
             >
                {zoom > 4 && <Popup>{entity.label || getEntityLabel(entity.type)}</Popup>}
             </Marker>
        ))}

    </MapContainer>
  );
};

export default WorldMap;


import React, { useEffect, useState, useMemo } from 'react';
import { MapContainer, GeoJSON, TileLayer, Marker, Popup, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import { MapEntity, MapEntityType } from '../types';
import { getFrenchName } from '../constants';

// --- CUSTOM DOT MARKERS ---
const createDotIcon = (color: string, labels: string[], isGrouped: boolean, showLabel: boolean) => L.divIcon({
  className: 'custom-dot-marker',
  html: `
    <div style="position: relative; width: 0; height: 0;">
      <!-- The Dot -->
      <div style="
        position: absolute;
        left: -6px; top: -6px;
        width: 12px; height: 12px; 
        background-color: ${color}; 
        border-radius: 50%; 
        border: 2px solid white; 
        box-shadow: 0 1px 3px rgba(0,0,0,0.6);
      "></div>
      
      <!-- The Label (Conditional: only zoom 9+) -->
      ${showLabel ? `
      <div style="
        position: absolute; 
        left: 12px; top: -10px; 
        white-space: nowrap; 
        font-size: ${isGrouped ? '8px' : '10px'}; 
        font-weight: bold; 
        background-color: rgba(0,0,0,0.85); 
        color: white; 
        padding: 2px 6px; 
        border-radius: 4px;
        pointer-events: none;
        text-shadow: 0 0 2px black;
        z-index: 10;
        border: 1px solid ${color};
        display: flex;
        flex-direction: column;
        gap: 1px;
      ">
        ${labels.map(l => `<span style="display:block">${l}</span>`).join('')}
      </div>
      ` : ''}
    </div>
  `,
  iconSize: [0, 0],
  iconAnchor: [0, 0]
});

const getEntityLabel = (type: MapEntityType) => {
    switch(type) {
        case 'military_factory': return 'Usine Armement';
        case 'military_port': return 'Port Militaire';
        case 'military_base': return 'Base Militaire';
        case 'airbase': return 'Base Aérienne';
        case 'defense_system': return 'Système de Défense';
        default: return type;
    }
}

const getEntityColor = (type: MapEntityType) => {
    switch(type) {
        case 'military_factory': return '#f59e0b';
        case 'military_port': return '#0ea5e9';
        case 'military_base': return '#6366f1';
        case 'airbase': return '#dc2626';
        case 'defense_system': return '#10b981';
        default: return '#64748b';
    }
};

// ... CAPITAL_DATA, LABEL_OVERRIDES restants ...
const CAPITAL_DATA: Record<string, {coords: [number, number], city: string}> = {
    "États-Unis": { coords: [38.9072, -77.0369], city: "Washington D.C." },
    "Canada": { coords: [45.4215, -75.6972], city: "Ottawa" },
    "Mexique": { coords: [19.4326, -99.1332], city: "Mexico" },
    "France": { coords: [48.8566, 2.3522], city: "Paris" },
    "Russie": { coords: [55.7558, 37.6173], city: "Moscou" },
    "Chine": { coords: [39.9042, 116.4074], city: "Pékin" },
    "Royaume-Uni": { coords: [51.5074, -0.1278], city: "Londres" },
    "Allemagne": { coords: [52.5200, 13.4050], city: "Berlin" },
    "Japon": { coords: [35.6762, 139.6503], city: "Tokyo" },
    "Inde": { coords: [28.6139, 77.2090], city: "New Delhi" }
};

const LABEL_OVERRIDES: Record<string, [number, number]> = {
    "Croatie": [44.6, 15.6], "Norvège": [62.5, 9.0], "Vietnam": [16.0, 107.5], 
    "Chili": [-32.0, -71.0], "Japon": [36.0, 138.0], "Israël": [31.3, 35.0],
    "Italie": [42.5, 12.8], "États-Unis": [39.5, -98.5], "France": [46.5, 2.5]
};

const MapLabels = ({ zoom, visibleCountries, ownedTerritories, playerCountry }: { zoom: number, visibleCountries: any[], ownedTerritories: string[], playerCountry: string | null }) => {
    if (zoom < 3) return null;
    return (
        <>
            {visibleCountries.map((c, idx) => {
                const name = c.name;
                if (ownedTerritories.includes(name) && name !== playerCountry) return null;
                const center = LABEL_OVERRIDES[name] || c.center;
                const capitalInfo = CAPITAL_DATA[name];
                if (!center) return null;
                return (
                    <React.Fragment key={`label-${name}-${idx}`}>
                        <Marker position={center} zIndexOffset={100} icon={L.divIcon({ className: 'bg-transparent', html: `<div style="color: rgba(255,255,255,0.9); text-shadow: 1px 1px 1px black; font-weight: bold; font-size: ${zoom < 4 ? '10px' : '13px'}; text-transform: uppercase; text-align: center; width: 200px; margin-left: -100px; pointer-events: none; letter-spacing: 1px; font-family: sans-serif;">${name}</div>` })} />
                        {capitalInfo && zoom >= 4 && (
                             <Marker position={capitalInfo.coords} zIndexOffset={1000} icon={L.divIcon({ className: 'bg-transparent', html: `<div style="display: flex; flex-direction: column; align-items: center; pointer-events: none;"><div style="width: 5px; height: 5px; background: black; border: 1px solid white; border-radius: 50%; box-shadow: 0 0 2px black;"></div><div style="color: #fcd34d; text-shadow: 1px 1px 0 #000, -1px -1px 0 #000; font-size: 8px; font-weight: bold; margin-top: 1px; white-space: nowrap;">${capitalInfo.city}</div></div>` })} />
                        )}
                    </React.Fragment>
                );
            })}
        </>
    );
};

const MapController = ({ onZoomChange }: { onZoomChange: (z: number) => void }) => {
    const map = useMapEvents({ zoomend: () => onZoomChange(map.getZoom()) });
    return null;
};

const FlyToCountry = ({ targetCountry, centers }: { targetCountry: string | null, centers: {name: string, center: [number, number]}[] }) => {
    const map = useMap();
    useEffect(() => {
        if (targetCountry) {
            const centerObj = centers.find(c => c.name === targetCountry) || { center: CAPITAL_DATA[targetCountry]?.coords };
            if (centerObj.center) map.flyTo(centerObj.center, 5, { duration: 2 });
        }
    }, [targetCountry, centers, map]);
    return null;
};

interface WorldMapProps {
  onRegionClick: (region: string) => void;
  playerCountry: string | null;
  ownedTerritories: string[];
  mapEntities: MapEntity[];
  focusCountry: string | null;
}

const WorldMap: React.FC<WorldMapProps> = ({ onRegionClick, playerCountry, ownedTerritories, mapEntities, focusCountry }) => {
  const [geoData, setGeoData] = useState<any>(null);
  const [zoom, setZoom] = useState(3);
  const [centers, setCenters] = useState<{name: string, center: [number, number]}[]>([]);

  useEffect(() => {
    const loadData = async () => {
        const response = await fetch('https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json');
        const data = await response.json();
        setGeoData(data);
        const newCenters: any[] = [];
        data.features.forEach((f: any) => {
            const name = getFrenchName(f.properties.name);
            newCenters.push({ name, center: [0, 0] }); // Simplifié pour l'exemple, calcul réel nécessaire
        });
        setCenters(newCenters);
    };
    loadData();
  }, []);

  const style = (feature: any) => {
    const name = getFrenchName(feature.properties.name);
    const isOwned = ownedTerritories.includes(name);
    return { fillColor: isOwned ? '#10b981' : 'transparent', fillOpacity: isOwned ? 0.3 : 0, weight: isOwned ? 0 : 1, color: isOwned ? '#34d399' : 'rgba(255, 255, 255, 0.4)', dashArray: isOwned ? '' : '4' };
  };

  const groupedEntities = useMemo(() => {
    const groups: Record<string, MapEntity[]> = {};
    mapEntities.forEach(ent => {
        const key = `${ent.lat.toFixed(4)}-${ent.lng.toFixed(4)}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(ent);
    });
    return Object.values(groups);
  }, [mapEntities]);

  return (
    <div className="w-full h-full absolute inset-0 z-0 bg-stone-900">
      <MapContainer center={[20, 0]} zoom={3} scrollWheelZoom={true} minZoom={2} maxZoom={10} maxBounds={[[-90, -180], [90, 180]]} zoomControl={false} attributionControl={false} className="leaflet-container">
        <MapController onZoomChange={setZoom} />
        <FlyToCountry targetCountry={focusCountry} centers={centers} />
        <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
        {geoData && <GeoJSON data={geoData} style={style} onEachFeature={(f, l) => l.on('click', () => onRegionClick(getFrenchName(f.properties.name)))} />}
        <MapLabels zoom={zoom} visibleCountries={centers} ownedTerritories={ownedTerritories} playerCountry={playerCountry} />
        
        {/* LOGIQUE DE MARQUEURS : ZOOM 8-10 */}
        {zoom >= 8 && groupedEntities.map((group, idx) => {
            const first = group[0];
            const isGrouped = group.length > 1;
            const showLabel = zoom >= 9;
            const labels = group.map(e => e.label || getEntityLabel(e.type));
            const color = getEntityColor(first.type);
            
            return (
                <Marker key={idx} position={[first.lat, first.lng]} icon={createDotIcon(color, labels, isGrouped, showLabel)} zIndexOffset={500} />
            );
        })}
      </MapContainer>
    </div>
  );
};

export default WorldMap;

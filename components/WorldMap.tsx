
import React, { useEffect, useState, useRef, useMemo } from 'react';
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
        const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) + xi); // Simplification mathématique correcte pour RayCasting
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

const findVisualCenter = (feature: any): [number, number] | null => {
    try {
        const layer = L.geoJSON(feature);
        const bounds = layer.getBounds();
        const center = bounds.getCenter();
        if (isPointInFeature([center.lat, center.lng], feature)) {
            return [center.lat, center.lng];
        }
        // Fallback: tentative aléatoire dans la bounding box pour trouver un point intérieur
        const southWest = bounds.getSouthWest();
        const northEast = bounds.getNorthEast();
        for (let i = 0; i < 50; i++) {
            const lat = southWest.lat + Math.random() * (northEast.lat - southWest.lat);
            const lng = southWest.lng + Math.random() * (northEast.lng - southWest.lng);
            if (isPointInFeature([lat, lng], feature)) return [lat, lng];
        }
        return [center.lat, center.lng];
    } catch (e) { return null; }
};

// --- CUSTOM MARKERS & GROUPING ---

const getEntityLabel = (type: MapEntityType, customLabel?: string) => {
    let typeName = "";
    switch(type) {
        case 'military_base': typeName = 'Base Militaire'; break;
        case 'air_base': typeName = 'Base Aérienne'; break;
        case 'defense_system': typeName = 'Système Défense'; break;
        default: typeName = 'Installation';
    }

    if (customLabel && !customLabel.toLowerCase().includes('build_') && customLabel !== typeName) {
        return customLabel;
    }
    return typeName;
}

const getEntityColor = (type: MapEntityType) => {
    switch(type) {
        case 'military_base': return '#3b82f6'; // Bleu
        case 'air_base': return '#0ea5e9'; // Cyan/Ciel
        case 'defense_system': return '#f97316'; // Orange
        default: return '#64748b';
    }
};

// Création d'une icône groupée affichant une liste
const createGroupedIcon = (entities: MapEntity[], zoom: number) => {
    // On prend la couleur du premier élément prioritaire (Défense > Air > Base)
    const priorityType = entities.find(e => e.type === 'defense_system') ? 'defense_system' 
                       : entities.find(e => e.type === 'air_base') ? 'air_base' 
                       : 'military_base';
    
    const color = getEntityColor(priorityType);
    const count = entities.length;
    
    // Génération de la liste HTML
    const listItems = entities.map(e => {
        const lbl = getEntityLabel(e.type, e.label);
        return `<div style="display:flex; align-items:center; gap:4px; margin-bottom:1px;">
            <div style="width:4px; height:4px; border-radius:50%; background-color:${getEntityColor(e.type)};"></div>
            <span>${lbl}</span>
        </div>`;
    }).join('');

    return L.divIcon({
        className: 'custom-grouped-marker',
        html: `
          <div style="position: relative; overflow: visible;">
            <!-- Le Point Principal -->
            <div style="
              width: 10px; height: 10px; 
              background-color: ${color}; 
              border-radius: 50%; 
              border: 2px solid white; 
              box-shadow: 0 2px 4px rgba(0,0,0,0.5);
              position: relative;
              z-index: 10;
            ">
                ${count > 1 ? `<div style="
                    position: absolute; top: -5px; right: -5px; 
                    background: red; color: white; border-radius: 50%; 
                    width: 10px; height: 10px; font-size: 7px; 
                    display: flex; align-items: center; justify-content: center; font-weight: bold;
                    border: 1px solid white;
                ">${count}</div>` : ''}
            </div>
            
            <!-- La Liste sur le côté -->
            ${zoom >= 5 ? `
            <div style="
              position: absolute; 
              left: 14px; top: -50%; transform: translateY(-25%);
              background-color: rgba(0, 0, 0, 0.75);
              backdrop-filter: blur(2px);
              padding: 4px 6px;
              border-radius: 4px;
              white-space: nowrap; 
              font-size: 9px;
              font-weight: 600; 
              color: white; 
              border-left: 2px solid ${color};
              pointer-events: none;
              z-index: 5;
              display: flex; flex-direction: column;
              box-shadow: 0 2px 5px rgba(0,0,0,0.3);
            ">
                ${listItems}
            </div>
            ` : ''}
          </div>
        `,
        iconSize: [0, 0],
        iconAnchor: [5, 5] // Centré sur le point
    });
};

const ALL_CAPITALS_URL = "https://raw.githubusercontent.com/hyperknot/country-capitals/master/data/country-capitals.json";

// --- LABEL OVERRIDES ---
const LABEL_OVERRIDES: Record<string, [number, number]> = {
    "Canada": [56.0, -106.0], "États-Unis": [39.0, -98.0], "Mexique": [23.5, -102.0],
    "Brésil": [-12.0, -53.0], "Argentine": [-36.0, -65.0], "Russie": [58.0, 80.0],
    "France": [46.8, 2.5], "Chine": [35.5, 104.0], "Australie": [-25.0, 134.0], "Inde": [22.0, 78.0]
};

const MapLabels = ({ zoom, visibleCountries, playerCountry, ownedTerritories, neutralTerritories }: { zoom: number, visibleCountries: any[], playerCountry: string | null, ownedTerritories: string[], neutralTerritories: string[] }) => {
    const MAJOR_POWERS = ["États-Unis", "Russie", "Chine", "Brésil", "Australie", "Canada", "Inde", "France"];
    return (
        <>
            {visibleCountries.map((c, idx) => {
                const name = c.name;
                const center = c.center;
                if (!center) return null;
                const isPlayer = name === playerCountry;
                const isOwned = ownedTerritories.includes(name);
                const isNeutral = neutralTerritories.includes(name);
                if (isOwned && !isPlayer) return null;
                const displayName = isNeutral ? "PAYS VIDE" : name;
                const displayColor = isNeutral ? '#b91c1c' : (isPlayer ? '#15803d' : '#374151');
                const isMajor = MAJOR_POWERS.includes(name);
                if (zoom < 3 && !isMajor) return null; 
                const fontSize = zoom < 4 ? '9px' : '11px';
                
                const opacity = zoom > 6 ? 0.4 : 0.8;

                return (
                    <Marker 
                        key={`label-${name}-${idx}`}
                        position={center} 
                        zIndexOffset={800}
                        icon={L.divIcon({
                            className: 'bg-transparent',
                            html: `
                                <div style="display: flex; flex-direction: column; align-items: center; width: 160px; margin-left: -80px; pointer-events: none;">
                                    <div style="color: ${displayColor}; text-shadow: 0 0 3px rgba(255,255,255,0.9); font-weight: bold; font-size: ${fontSize}; text-transform: uppercase; text-align: center; opacity: ${opacity}; transition: opacity 0.3s;">
                                        ${displayName}
                                    </div>
                                </div>
                            `
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
        fetch(ALL_CAPITALS_URL).then(res => res.json()).then(data => {
            setCapitals(data.filter((i: any) => i.CapitalLatitude).map((i: any) => ({
                country: getFrenchName(i.CountryName), city: i.CapitalName, coords: [parseFloat(i.CapitalLatitude), parseFloat(i.CapitalLongitude)]
            })));
        });
    }, []);
    if (zoom < 3) return null;
    return (
        <>
            {capitals.map((info, idx) => {
                const isAnnexed = playerCountry && ownedTerritories.includes(info.country) && info.country !== playerCountry;
                if (zoom < 4 && !isAnnexed) return null;
                return (
                    <Marker 
                        key={`cap-${info.country}-${idx}`}
                        position={info.coords}
                        zIndexOffset={900}
                        icon={L.divIcon({
                            className: 'bg-transparent',
                            html: `<div style="display: flex; flex-direction: column; align-items: center; pointer-events: none;">
                                <div style="width: 5px; height: 5px; background: ${isAnnexed ? '#15803d' : '#1f2937'}; border: 1px solid white; border-radius: 50%;"></div>
                                ${zoom > 4 || isAnnexed ? `<div style="color: ${isAnnexed ? '#064e3b' : '#4b5563'}; font-size: 8px; font-weight: ${isAnnexed ? 'bold' : 'normal'}; background: rgba(255,255,255,0.6); padding: 0 2px;">${info.city}</div>` : ''}
                            </div>`
                        })}
                    />
                );
            })}
        </>
    );
}

const MapController = ({ onZoomChange }: { onZoomChange: (z: number) => void }) => {
    const map = useMapEvents({ zoomend: () => onZoomChange(map.getZoom()) });
    return null;
};

const FlyToCountry = ({ targetCountry, centers }: { targetCountry: string | null, centers: {name: string, center: [number, number]}[] }) => {
    const map = useMap();
    useEffect(() => {
        if (targetCountry) {
            const centerObj = centers.find(c => c.name === targetCountry.split(':')[0]);
            if (centerObj) map.flyTo(centerObj.center, 5, { duration: 1.5 });
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

const WorldMap: React.FC<WorldMapProps> = ({ onRegionClick, playerCountry, ownedTerritories, neutralTerritories = [], mapEntities, focusCountry }) => {
  const [geoData, setGeoData] = useState<any>(null);
  const [zoom, setZoom] = useState(3);
  const [centers, setCenters] = useState<{name: string, center: [number, number]}[]>([]);
  const featureMap = useRef<Record<string, any>>({});

  useEffect(() => {
    fetch("https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson")
      .then(res => res.json())
      .then(data => {
          const newCenters: any[] = [];
          data.features.forEach((f: any) => {
              const name = getFrenchName(f.properties.name);
              f.properties.name = name;
              featureMap.current[name] = f;
              const center = LABEL_OVERRIDES[name] || findVisualCenter(f);
              if (center) newCenters.push({ name, center });
          });
          setCenters(newCenters);
          setGeoData(data);
      });
  }, []);

  const style = (f: any) => {
    const name = f.properties.name;
    const isPlayer = playerCountry === name;
    // Vérification simplifiée et robuste de l'appartenance
    const isOwned = ownedTerritories.includes(name);
    const isNeutral = neutralTerritories.includes(name);
    
    return {
      fillColor: isPlayer ? "#22c55e" : isOwned ? "#4ade80" : isNeutral ? "#7f1d1d" : "#d1d5db",
      weight: 1, opacity: 1, color: '#ffffff', fillOpacity: 1
    };
  };

  const getMarkerPosition = (entity: MapEntity): [number, number] | null => {
      if (entity.lat !== 0 || entity.lng !== 0) return [entity.lat, entity.lng];
      const f = featureMap.current[entity.country];
      if (f) {
          const center = centers.find(c => c.name === entity.country);
          if (center) return center.center;
      }
      return null;
  };

  // --- LOGIQUE DE REGROUPEMENT DES ENTITÉS ---
  const groupedEntities = useMemo(() => {
      const groups: Record<string, { pos: [number, number], entities: MapEntity[] }> = {};
      
      mapEntities.forEach(entity => {
          const pos = getMarkerPosition(entity);
          if (!pos) return;
          
          const key = `${pos[0].toFixed(3)},${pos[1].toFixed(3)}`;
          
          if (!groups[key]) {
              groups[key] = { pos, entities: [] };
          }
          groups[key].entities.push(entity);
      });
      
      return Object.values(groups);
  }, [mapEntities, centers, featureMap]);

  if (!geoData) return <div className="text-stone-500 text-center mt-20">Initialisation satellite...</div>;

  return (
    <MapContainer zoomControl={false} center={[20, 0]} zoom={3} style={{ height: '100%', width: '100%', background: '#e0f2fe' }} minZoom={2} maxZoom={10} maxBounds={[[-90, -180], [90, 180]]}>
        <MapController onZoomChange={setZoom} />
        <FlyToCountry targetCountry={focusCountry} centers={centers} />
        {/* On utilise directement geoData sans fusionner les géométries pour éviter les crashs de turf.union */}
        <GeoJSON key={`map-${ownedTerritories.length}-${neutralTerritories.length}`} data={geoData} style={style} onEachFeature={(f, l) => l.on('click', () => onRegionClick(f.properties.name))} />
        <MapLabels zoom={zoom} visibleCountries={centers} playerCountry={playerCountry} ownedTerritories={ownedTerritories} neutralTerritories={neutralTerritories} />
        <CapitalMarkers zoom={zoom} ownedTerritories={ownedTerritories} playerCountry={playerCountry} />
        
        {groupedEntities.map((group, idx) => {
             if (zoom < 5) return null;
             return (
                <Marker 
                    key={`group-${idx}`} 
                    position={group.pos} 
                    icon={createGroupedIcon(group.entities, zoom)} 
                    zIndexOffset={1100}
                >
                    <Popup>
                        <div className="text-xs font-bold">
                            {group.entities.map((e, i) => (
                                <div key={i}>{getEntityLabel(e.type, e.label)}</div>
                            ))}
                        </div>
                    </Popup>
                </Marker>
             );
        })}
    </MapContainer>
  );
};

export default WorldMap;

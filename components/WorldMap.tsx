
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

const findVisualCenter = (feature: any): [number, number] | null => {
    try {
        const layer = L.geoJSON(feature);
        const bounds = layer.getBounds();
        const center = bounds.getCenter();
        if (isPointInFeature([center.lat, center.lng], feature)) {
            return [center.lat, center.lng];
        }
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

// --- CUSTOM MARKERS ---
const getEntityLabel = (type: MapEntityType, customLabel?: string) => {
    // Si un label custom existe et n'est pas une commande technique
    if (customLabel && !customLabel.toLowerCase().includes('build_') && customLabel !== 'Base Militaire' && customLabel !== 'Système de Défense' && customLabel !== 'Base Aérienne') {
        let prefix = "";
        if (type === 'military_base') prefix = "Base Militaire: ";
        if (type === 'air_base') prefix = "Base Aérienne: ";
        if (type === 'defense_system') prefix = "Défense: ";
        return `${prefix}${customLabel}`;
    }

    switch(type) {
        case 'military_base': return 'Base Militaire';
        case 'air_base': return 'Base Aérienne';
        case 'defense_system': return 'Système de Défense';
        default: return 'Installation';
    }
}

const getEntityColor = (type: MapEntityType) => {
    switch(type) {
        case 'military_base': return '#3b82f6'; // Bleu
        case 'air_base': return '#0ea5e9'; // Cyan/Ciel
        case 'defense_system': return '#f97316'; // Orange
        default: return '#64748b';
    }
};

const createDotIcon = (color: string, type: MapEntityType, showLabel: boolean, label?: string) => {
  const labelText = getEntityLabel(type, label);

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
        ">${labelText}</div>
        ` : ''}
      </div>
    `,
    iconSize: [0, 0],
    iconAnchor: [0, 0]
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
                return (
                    <Marker 
                        key={`label-${name}-${idx}`}
                        position={center} 
                        zIndexOffset={900}
                        icon={L.divIcon({
                            className: 'bg-transparent',
                            html: `<div style="color: ${displayColor}; text-shadow: 0 0 3px rgba(255,255,255,0.9); font-weight: bold; font-size: ${fontSize}; text-transform: uppercase; text-align: center; width: 160px; margin-left: -80px; pointer-events: none;">${displayName}</div>`
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
                        zIndexOffset={1000}
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

  const displayGeoData = useMemo(() => {
      if (!geoData || !playerCountry || ownedTerritories.length <= 1) return geoData;
      const owned = geoData.features.filter((f: any) => ownedTerritories.includes(f.properties.name));
      const others = geoData.features.filter((f: any) => !ownedTerritories.includes(f.properties.name));
      try {
          let merged = owned[0];
          for (let i = 1; i < owned.length; i++) {
              const u = turf.union(merged, owned[i]);
              if (u) merged = u;
          }
          if (merged) merged.properties = { ...merged.properties, name: playerCountry };
          return { type: "FeatureCollection", features: [...others, merged] };
      } catch (e) { return geoData; }
  }, [geoData, ownedTerritories, playerCountry]);

  const style = (f: any) => {
    const name = f.properties.name;
    const isPlayer = playerCountry === name;
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

  if (!geoData) return <div className="text-stone-500 text-center mt-20">Initialisation satellite...</div>;

  return (
    <MapContainer zoomControl={false} center={[20, 0]} zoom={3} style={{ height: '100%', width: '100%', background: '#e0f2fe' }} minZoom={2} maxZoom={10} maxBounds={[[-90, -180], [90, 180]]}>
        <MapController onZoomChange={setZoom} />
        <FlyToCountry targetCountry={focusCountry} centers={centers} />
        <GeoJSON key={`map-${ownedTerritories.length}-${neutralTerritories.length}`} data={displayGeoData || geoData} style={style} onEachFeature={(f, l) => l.on('click', () => onRegionClick(f.properties.name))} />
        <MapLabels zoom={zoom} visibleCountries={centers} playerCountry={playerCountry} ownedTerritories={ownedTerritories} neutralTerritories={neutralTerritories} />
        <CapitalMarkers zoom={zoom} ownedTerritories={ownedTerritories} playerCountry={playerCountry} />
        {mapEntities.map((entity) => {
             if (zoom < 6) return null;
             const pos = getMarkerPosition(entity);
             if (!pos) return null;
             return (
                <Marker key={entity.id} position={pos} icon={createDotIcon(getEntityColor(entity.type), entity.type, zoom >= 8, entity.label)}>
                    <Popup>{getEntityLabel(entity.type, entity.label)}</Popup>
                </Marker>
             );
        })}
    </MapContainer>
  );
};

export default WorldMap;

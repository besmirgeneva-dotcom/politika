import React, { useEffect, useState } from 'react';
import { MapContainer, GeoJSON, TileLayer, Marker, Popup, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import { MapEntity } from '../types';
import { getFrenchName } from '../constants'; // Importation de la fonction centralisée

// --- CUSTOM DOT MARKERS ---
const createDotIcon = (color: string, label: string | undefined, type: string, showLabel: boolean) => L.divIcon({
  className: 'custom-dot-marker',
  html: `
    <div style="position: relative; width: 0; height: 0;">
      <!-- The Dot -->
      <div style="
        position: absolute;
        left: -5px; top: -5px;
        width: 12px; height: 12px; 
        background-color: ${color}; 
        border-radius: 50%; 
        border: 2px solid white; 
        box-shadow: 0 1px 3px rgba(0,0,0,0.6);
      "></div>
      
      <!-- Icon Inside Dot (Optional, simplified) -->
      
      <!-- The Label (Conditional) -->
      ${showLabel ? `
      <div style="
        position: absolute; 
        left: 10px; top: -8px; 
        white-space: nowrap; 
        font-size: 10px; 
        font-weight: bold; 
        background-color: rgba(0,0,0,0.8); 
        color: white; 
        padding: 2px 5px; 
        border-radius: 4px;
        pointer-events: none;
        text-shadow: 0 0 2px black;
        z-index: 10;
        border: 1px solid ${color};
      ">${label || getEntityLabel(type)}</div>
      ` : ''}
    </div>
  `,
  iconSize: [0, 0], // Logic handled in HTML
  iconAnchor: [0, 0]
});

const getEntityLabel = (type: string) => {
    switch(type) {
        case 'factory': return '🏭 Usine';
        case 'port': return '⚓ Port';
        case 'military_airport': return '✈️ Aéroport Mil.';
        case 'airbase': return '🛫 Base Aérienne';
        case 'defense': return '🛡️ Défense';
        default: return type;
    }
}

// Color mapping for entity types
const getEntityColor = (type: string) => {
    switch(type) {
        case 'factory': return '#f59e0b'; // Amber (Usine)
        case 'port': return '#0ea5e9'; // Sky Blue (Port)
        case 'military_airport': return '#6366f1'; // Indigo (Aéroport Mil)
        case 'airbase': return '#dc2626'; // Red (Base Aérienne)
        case 'defense': return '#10b981'; // Emerald (Défense)
        default: return '#64748b';
    }
};

// --- DATASET: CAPITAL DATA ---
interface CapitalInfo {
    coords: [number, number];
    city: string;
}

const CAPITAL_DATA: Record<string, CapitalInfo> = {
    // Amerique du Nord & Centrale
    "États-Unis": { coords: [38.9072, -77.0369], city: "Washington D.C." },
    "Canada": { coords: [45.4215, -75.6972], city: "Ottawa" },
    "Mexique": { coords: [19.4326, -99.1332], city: "Mexico" },
    "Cuba": { coords: [23.1136, -82.3666], city: "La Havane" },
    "Guatemala": { coords: [14.6349, -90.5069], city: "Guatemala" },
    "Honduras": { coords: [14.0723, -87.1921], city: "Tegucigalpa" },
    "Nicaragua": { coords: [12.1150, -86.2362], city: "Managua" },
    "Costa Rica": { coords: [9.9281, -84.0907], city: "San José" },
    "Panama": { coords: [8.9824, -79.5199], city: "Panama" },
    "Haïti": { coords: [18.5392, -72.3350], city: "Port-au-Prince" },
    "République dominicaine": { coords: [18.4861, -69.9312], city: "Saint-Domingue" },
    "Jamaïque": { coords: [17.9712, -76.7928], city: "Kingston" },

    // Amerique du Sud
    "Brésil": { coords: [-15.8267, -47.9218], city: "Brasília" },
    "Argentine": { coords: [-34.6037, -58.3816], city: "Buenos Aires" },
    "Colombie": { coords: [4.7110, -74.0721], city: "Bogota" },
    "Pérou": { coords: [-12.0464, -77.0428], city: "Lima" },
    "Chili": { coords: [-33.4489, -70.6693], city: "Santiago" },
    "Venezuela": { coords: [10.4806, -66.9036], city: "Caracas" },
    "Équateur": { coords: [-0.1807, -78.4678], city: "Quito" },
    "Bolivie": { coords: [-16.5000, -68.1500], city: "La Paz" },
    "Paraguay": { coords: [-25.2637, -57.5759], city: "Asunción" },
    "Uruguay": { coords: [-34.9011, -56.1645], city: "Montevideo" },
    "Guyana": { coords: [6.8013, -58.1551], city: "Georgetown" },
    "Suriname": { coords: [5.8520, -55.2038], city: "Paramaribo" },

    // Europe
    "France": { coords: [48.8566, 2.3522], city: "Paris" },
    "Royaume-Uni": { coords: [51.5074, -0.1278], city: "Londres" },
    "Allemagne": { coords: [52.5200, 13.4050], city: "Berlin" },
    "Italie": { coords: [41.9028, 12.4964], city: "Rome" },
    "Espagne": { coords: [40.4168, -3.7038], city: "Madrid" },
    "Portugal": { coords: [38.7223, -9.1393], city: "Lisbonne" },
    "Pays-Bas": { coords: [52.3676, 4.9041], city: "Amsterdam" },
    "Belgique": { coords: [50.8503, 4.3517], city: "Bruxelles" },
    "Suisse": { coords: [46.9480, 7.4474], city: "Berne" },
    "Autriche": { coords: [48.2082, 16.3738], city: "Vienne" },
    "Pologne": { coords: [52.2297, 21.0122], city: "Varsovie" },
    "Tchéquie": { coords: [50.0755, 14.4378], city: "Prague" },
    "Slovaquie": { coords: [48.1486, 17.1077], city: "Bratislava" },
    "Hongrie": { coords: [47.4979, 19.0402], city: "Budapest" },
    "Roumanie": { coords: [44.4268, 26.1025], city: "Bucarest" },
    "Bulgarie": { coords: [42.6977, 23.3219], city: "Sofia" },
    "Grèce": { coords: [37.9838, 23.7275], city: "Athènes" },
    "Serbie": { coords: [44.7866, 20.4489], city: "Belgrade" },
    "Croatie": { coords: [45.8150, 15.9819], city: "Zagreb" },
    "Bosnie-Herzégovine": { coords: [43.8563, 18.4131], city: "Sarajevo" },
    "Suède": { coords: [59.3293, 18.0686], city: "Stockholm" },
    "Norvège": { coords: [59.9139, 10.7522], city: "Oslo" },
    "Finlande": { coords: [60.1699, 24.9384], city: "Helsinki" },
    "Danemark": { coords: [55.6761, 12.5683], city: "Copenhague" },
    "Irlande": { coords: [53.3498, -6.2603], city: "Dublin" },
    "Islande": { coords: [64.1265, -21.8174], city: "Reykjavik" },
    "Ukraine": { coords: [50.4501, 30.5234], city: "Kiev" },
    "Biélorussie": { coords: [53.9045, 27.5615], city: "Minsk" },
    "Moldavie": { coords: [47.0105, 28.8638], city: "Chisinau" },
    "Albanie": { coords: [41.3275, 19.8187], city: "Tirana" },
    "Macédoine du Nord": { coords: [41.9981, 21.4254], city: "Skopje" },
    "Monténégro": { coords: [42.4304, 19.2594], city: "Podgorica" },
    "Slovénie": { coords: [46.0569, 14.5058], city: "Ljubljana" },
    "Estonie": { coords: [59.4370, 24.7536], city: "Tallinn" },
    "Lettonie": { coords: [56.9496, 24.1052], city: "Riga" },
    "Lituanie": { coords: [54.6872, 25.2797], city: "Vilnius" },

    // Russie & Asie Centrale
    "Russie": { coords: [55.7558, 37.6173], city: "Moscou" },
    "Kazakhstan": { coords: [51.1694, 71.4491], city: "Astana" },
    "Ouzbékistan": { coords: [41.2995, 69.2401], city: "Tachkent" },
    "Turkménistan": { coords: [37.9601, 58.3261], city: "Achgabat" },
    "Kirghizistan": { coords: [42.8746, 74.5698], city: "Bichkek" },
    "Tadjikistan": { coords: [38.5598, 68.7870], city: "Douchanbé" },
    "Mongolie": { coords: [47.9181, 106.9173], city: "Oulan-Bator" },

    // Asie
    "Chine": { coords: [39.9042, 116.4074], city: "Pékin" },
    "Japon": { coords: [35.6762, 139.6503], city: "Tokyo" },
    "Inde": { coords: [28.6139, 77.2090], city: "New Delhi" },
    "Corée du Sud": { coords: [37.5665, 126.9780], city: "Séoul" },
    "Corée du Nord": { coords: [39.0392, 125.7625], city: "Pyongyang" },
    "Vietnam": { coords: [21.0285, 105.8542], city: "Hanoï" },
    "Thaïlande": { coords: [13.7563, 100.5018], city: "Bangkok" },
    "Indonésie": { coords: [-6.2088, 106.8456], city: "Jakarta" },
    "Pakistan": { coords: [33.6844, 73.0479], city: "Islamabad" },
    "Afghanistan": { coords: [34.5553, 69.2075], city: "Kaboul" },
    "Iran": { coords: [35.6892, 51.3890], city: "Téhéran" },
    "Irak": { coords: [33.3152, 44.3661], city: "Bagdad" },
    "Turquie": { coords: [39.9334, 32.8597], city: "Ankara" },
    "Syrie": { coords: [33.5138, 36.2765], city: "Damas" },
    "Liban": { coords: [33.8886, 35.4955], city: "Beyrouth" },
    "Israël": { coords: [31.7683, 35.2137], city: "Jérusalem" },
    "Jordanie": { coords: [31.9454, 35.9284], city: "Amman" },
    "Arabie saoudite": { coords: [24.7136, 46.6753], city: "Riyad" },
    "Émirats arabes unis": { coords: [24.4539, 54.3773], city: "Abou Dabi" },
    "Qatar": { coords: [25.2854, 51.5310], city: "Doha" },
    "Koweït": { coords: [29.3759, 47.9774], city: "Koweït" },
    "Oman": { coords: [23.5880, 58.3829], city: "Mascate" },
    "Yémen": { coords: [15.3694, 44.1910], city: "Sanaa" },
    "Malaisie": { coords: [3.1390, 101.6869], city: "Kuala Lumpur" },
    "Singapour": { coords: [1.3521, 103.8198], city: "Singapour" },
    "Philippines": { coords: [14.5995, 120.9842], city: "Manille" },
    "Birmanie": { coords: [19.7633, 96.0785], city: "Naypyidaw" },
    "Cambodge": { coords: [11.5564, 104.9282], city: "Phnom Penh" },
    "Laos": { coords: [17.9757, 102.6331], city: "Vientiane" },
    "Bangladesh": { coords: [23.8103, 90.4125], city: "Dacca" },
    "Népal": { coords: [27.7172, 85.3240], city: "Katmandou" },
    "Sri Lanka": { coords: [6.9271, 79.8612], city: "Colombo" },
    "Taïwan": { coords: [25.0330, 121.5654], city: "Taipei" },

    // Afrique
    "Égypte": { coords: [30.0444, 31.2357], city: "Le Caire" },
    "Afrique du Sud": { coords: [-25.7479, 28.2293], city: "Pretoria" },
    "Nigéria": { coords: [9.0765, 7.3986], city: "Abuja" },
    "Maroc": { coords: [34.0209, -6.8416], city: "Rabat" },
    "Algérie": { coords: [36.7372, 3.0863], city: "Alger" },
    "Tunisie": { coords: [36.8065, 10.1815], city: "Tunis" },
    "Libye": { coords: [32.8872, 13.1913], city: "Tripoli" },
    "Soudan": { coords: [15.5007, 32.5599], city: "Khartoum" },
    "Éthiopie": { coords: [9.0192, 38.7525], city: "Addis-Abeba" },
    "Kenya": { coords: [-1.2921, 36.8219], city: "Nairobi" },
    "République démocratique du Congo": { coords: [-4.4419, 15.2663], city: "Kinshasa" },
    "Tanzanie": { coords: [-6.1629, 35.7423], city: "Dodoma" },
    "Ouganda": { coords: [0.3476, 32.5825], city: "Kampala" },
    "Ghana": { coords: [5.6037, -0.1870], city: "Accra" },
    "Côte d'Ivoire": { coords: [6.8276, -5.2577], city: "Yamoussoukro" },
    "Sénégal": { coords: [14.7167, -17.4677], city: "Dakar" },
    "Cameroun": { coords: [3.8480, 11.5021], city: "Yaoundé" },
    "Angola": { coords: [-8.8390, 13.2894], city: "Luanda" },
    "Madagascar": { coords: [-18.8792, 47.5079], city: "Antananarivo" },
    "Mali": { coords: [12.6392, -8.0029], city: "Bamako" },
    "Niger": { coords: [13.5116, 2.1254], city: "Niamey" },
    "Tchad": { coords: [12.1348, 15.0557], city: "N'Djaména" },
    "Burkina Faso": { coords: [12.3714, -1.5197], city: "Ouagadougou" },
    "Zimbabwe": { coords: [-17.8216, 31.0492], city: "Harare" },
    "Zambie": { coords: [-15.3875, 28.3228], city: "Lusaka" },

    // Océanie
    "Australie": { coords: [-35.2809, 149.1300], city: "Canberra" },
    "Nouvelle-Zélande": { coords: [-41.2865, 174.7762], city: "Wellington" },
    "Papouasie-Nouvelle-Guinée": { coords: [-9.4438, 147.1803], city: "Port Moresby" },
    "Fidji": { coords: [-18.1248, 178.4501], city: "Suva" }
};

const LABEL_OVERRIDES: Record<string, [number, number]> = {
    "Croatie": [44.6, 15.6], "Norvège": [62.5, 9.0], "Vietnam": [16.0, 107.5], 
    "Chili": [-32.0, -71.0], "Japon": [36.0, 138.0], "Israël": [31.3, 35.0],
    "Italie": [42.5, 12.8], "États-Unis": [39.5, -98.5], "France": [46.5, 2.5],
    "Indonésie": [-4.0, 115.0], "Philippines": [13.0, 122.0], "Grèce": [39.0, 22.0],
    "Canada": [56.0, -100.0], "Russie": [60.0, 95.0]
};

// --- COMPONENT: LABEL RENDERER ---
const MapLabels = ({ zoom, visibleCountries, ownedTerritories, playerCountry }: { zoom: number, visibleCountries: any[], ownedTerritories: string[], playerCountry: string | null }) => {
    if (zoom < 3) return null;

    return (
        <>
            {visibleCountries.map((c, idx) => {
                const name = c.name;
                if (ownedTerritories.includes(name) && name !== playerCountry) return null;

                const center = LABEL_OVERRIDES[name] || c.center;
                const capitalInfo = CAPITAL_DATA[name];
                // Afficher plus de capitales: Si zoom >= 5 pour tout le monde, ou zoom >= 4 pour pays importants
                const isCapitalVisible = capitalInfo && zoom >= 4;
                
                if (!center) return null;

                return (
                    <React.Fragment key={`label-${name}-${idx}`}>
                        <Marker 
                            position={center} 
                            zIndexOffset={100}
                            icon={L.divIcon({
                                className: 'bg-transparent',
                                html: `<div style="
                                    color: rgba(255,255,255,0.9); 
                                    text-shadow: 1px 1px 1px black; 
                                    font-weight: bold; 
                                    font-size: ${zoom < 4 ? '10px' : '13px'};
                                    text-transform: uppercase;
                                    text-align: center;
                                    width: 200px;
                                    margin-left: -100px;
                                    pointer-events: none;
                                    letter-spacing: 1px;
                                    font-family: sans-serif;
                                ">${name}</div>`
                            })}
                        />
                        {isCapitalVisible && (
                             <Marker 
                                position={capitalInfo.coords}
                                zIndexOffset={1000}
                                icon={L.divIcon({
                                    className: 'bg-transparent',
                                    html: `<div style="display: flex; flex-direction: column; align-items: center; pointer-events: none;">
                                        <div style="width: 5px; height: 5px; background: black; border: 1px solid white; border-radius: 50%; box-shadow: 0 0 2px black;"></div>
                                        <div style="color: #fcd34d; text-shadow: 1px 1px 0 #000, -1px -1px 0 #000; font-size: 8px; font-weight: bold; margin-top: 1px; white-space: nowrap;">${capitalInfo.city}</div>
                                    </div>`
                                })}
                            />
                        )}
                    </React.Fragment>
                );
            })}
        </>
    );
};

// ... (MapController, FlyToCountry inchangés)

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
            if (LABEL_OVERRIDES[targetCountry]) {
                map.flyTo(LABEL_OVERRIDES[targetCountry], 5, { duration: 2 });
                return;
            }
            const centerObj = centers.find(c => c.name === targetCountry);
            if (centerObj) {
                map.flyTo(centerObj.center, 5, { duration: 2 });
                return;
            }
            if (CAPITAL_DATA[targetCountry]) {
                map.flyTo(CAPITAL_DATA[targetCountry].coords, 5, { duration: 2 });
            }
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

const CACHE_KEY = 'GEOSIM_MAP_DATA';

const WorldMap: React.FC<WorldMapProps> = ({ onRegionClick, playerCountry, ownedTerritories, mapEntities, focusCountry }) => {
  const [geoData, setGeoData] = useState<any>(null);
  const [zoom, setZoom] = useState(3);
  const [centers, setCenters] = useState<{name: string, center: [number, number]}[]>([]);

  // ... (Chargement des données inchangé)
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
            const response = await fetch('https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json');
            if (!response.ok) throw new Error('Network response was not ok');
            const data = await response.json();
            try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (e) {}
            processGeoData(data);
        } catch (err) {
            console.error("Failed to load map data", err);
        }
    };
    loadData();
  }, []);

  const processGeoData = (data: any) => {
        setGeoData(data);
        const newCenters: {name: string, center: [number, number]}[] = [];
        data.features.forEach((f: any) => {
                const frenchName = getFrenchName(f.properties.name);
                let bestCenter: [number, number] | null = null;
                const geometry = f.geometry;
                if (geometry.type === "Polygon") {
                    // @ts-ignore
                    const layer = L.polygon(geometry.coordinates.map(ring => ring.map(c => [c[1], c[0]])));
                    bestCenter = [layer.getBounds().getCenter().lat, layer.getBounds().getCenter().lng];
                } else if (geometry.type === "MultiPolygon") {
                    let maxArea = 0;
                    geometry.coordinates.forEach((polyCoords: any[]) => {
                        const latLngs = polyCoords[0].map((c: number[]) => [c[1], c[0]]);
                        const layer = L.polygon(latLngs);
                        const bounds = layer.getBounds();
                        const area = (bounds.getEast() - bounds.getWest()) * (bounds.getNorth() - bounds.getSouth());
                        if (area > maxArea) {
                            maxArea = area;
                            bestCenter = [bounds.getCenter().lat, bounds.getCenter().lng];
                        }
                    });
                }
                if (bestCenter) newCenters.push({ name: frenchName, center: bestCenter });
        });
        setCenters(newCenters);
  };

  const onEachFeature = (feature: any, layer: L.Layer) => {
    const frenchName = getFrenchName(feature.properties.name);
    layer.on({ click: (e) => { L.DomEvent.stopPropagation(e); onRegionClick(frenchName); } });
  };

  const style = (feature: any) => {
    const frenchName = getFrenchName(feature.properties.name);
    const isOwned = ownedTerritories.includes(frenchName);
    return {
        fillColor: isOwned ? '#10b981' : 'transparent',
        fillOpacity: isOwned ? 0.3 : 0, 
        weight: isOwned ? 0 : 1, 
        color: isOwned ? '#34d399' : 'rgba(255, 255, 255, 0.4)', 
        dashArray: isOwned ? '' : '4',
    };
  };

  const showMarkerLabels = zoom > 5;

  return (
    <div className="w-full h-full absolute inset-0 z-0 bg-stone-900">
      <MapContainer 
        center={[20, 0]} zoom={3} scrollWheelZoom={true} minZoom={2} maxZoom={8}
        maxBounds={[[-90, -180], [90, 180]]} zoomControl={false} attributionControl={false}
        className="outline-none bg-stone-900 h-full w-full"
      >
        <MapController onZoomChange={setZoom} />
        <FlyToCountry targetCountry={focusCountry} centers={centers} />
        
        <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />

        {geoData && <GeoJSON key={`geo-${ownedTerritories.length}`} data={geoData} style={style} onEachFeature={onEachFeature} />}

        <MapLabels zoom={zoom} visibleCountries={centers} ownedTerritories={ownedTerritories} playerCountry={playerCountry} />

        {mapEntities
          .filter(entity => ['port', 'military_airport', 'airbase', 'defense'].includes(entity.type))
          .map((entity) => {
            let pos: [number, number] = [entity.lat, entity.lng];
            if (pos[0] === 0 && pos[1] === 0) {
                const override = LABEL_OVERRIDES[entity.country];
                if (override) pos = override;
                else {
                    const c = centers.find(x => x.name === entity.country);
                    if (c) pos = c.center;
                    else if (CAPITAL_DATA[entity.country]) pos = CAPITAL_DATA[entity.country].coords;
                }
            }
            
            const color = getEntityColor(entity.type);
            const icon = createDotIcon(color, entity.label, entity.type, showMarkerLabels);

            return (
                <Marker key={entity.id} position={pos} icon={icon} zIndexOffset={500}>
                    {!showMarkerLabels && (
                        <Popup>
                            <div className="text-center">
                                <strong className="uppercase text-xs block mb-1" style={{color: color}}>{getEntityLabel(entity.type)}</strong>
                                <span className="text-xs text-stone-600">{entity.country}</span>
                            </div>
                        </Popup>
                    )}
                </Marker>
            );
        })}

      </MapContainer>
    </div>
  );
};

export default WorldMap;